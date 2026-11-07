// apps/extension/src/background/index.ts
// Capdio MV3 Service Worker Entrypoint & State Coordinator (OCS-101 / OCS-102 / OCS-103)

import { registerMessageListener, sendTypedMessage, MessageBusError } from '../shared/message-bus.ts';
import { RecordingStateMachine } from './state-machine.ts';
import { SessionRegistry } from './session-registry.ts';
import type {
  StartCaptureMessage,
  PauseCaptureMessage,
  ResumeCaptureMessage,
  StopCaptureMessage,
  GetSessionMessage,
  RecordStatus
} from '../shared/types.ts';

console.log('[Capdio SW] Service Worker script evaluating...');

const OFFSCREEN_PATH = 'offscreen.html';

export const stateMachine = new RecordingStateMachine();
export const sessionRegistry = new SessionRegistry();

// Action Badge Synchronization
function updateActionBadge(status: RecordStatus): void {
  try {
    if (!chrome.action) return;

    switch (status) {
      case 'recording':
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
        break;
      case 'paused':
        chrome.action.setBadgeText({ text: 'PAUS' });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Amber
        break;
      case 'requesting_permission':
      case 'preparing':
        chrome.action.setBadgeText({ text: '...' });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); // Blue
        break;
      case 'finalizing':
        chrome.action.setBadgeText({ text: 'FIN' });
        chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' }); // Purple
        break;
      case 'error':
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // Dark Red
        break;
      case 'ready':
      case 'idle':
      default:
        chrome.action.setBadgeText({ text: '' });
        break;
    }
  } catch (err) {
    console.warn('[Capdio SW] Could not update action badge:', err);
  }
}

// Subscribe badge updater to FSM transitions
stateMachine.onStateChange((newStatus, prevStatus, reason) => {
  console.log(`[Capdio FSM] Transition: ${prevStatus} -> ${newStatus} (${reason || 'no reason'})`);
  updateActionBadge(newStatus);
});

// Helper: Resolve the target tab to capture
async function resolveTargetTabId(requestedTabId?: number): Promise<number | undefined> {
  if (typeof requestedTabId === 'number') {
    return requestedTabId;
  }
  const tabs = await chrome.tabs.query({ active: true });
  const webTab = tabs.find(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('chrome-extension'));
  return webTab?.id ?? tabs[0]?.id;
}

// Helper: Acquire ephemeral stream ID via chrome.tabCapture
async function getTabMediaStreamId(targetTabId?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: chrome.tabCapture.GetMediaStreamOptions = {};
    if (typeof targetTabId === 'number') {
      options.targetTabId = targetTabId;
    }
    chrome.tabCapture.getMediaStreamId(options, (streamId) => {
      if (chrome.runtime.lastError) {
        return reject(new MessageBusError('E_CAPTURE_DENIED', chrome.runtime.lastError.message || 'tabCapture failed'));
      }
      if (!streamId) {
        return reject(new MessageBusError('E_CAPTURE_DENIED', 'No streamId returned by tabCapture'));
      }
      resolve(streamId);
    });
  });
}

// Ensure offscreen document exists
export async function ensureOffscreenDocument(): Promise<void> {
  if ('hasDocument' in chrome.offscreen) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  } else {
    // Fallback for older Chromium versions
    const clients = await (self as any).clients.matchAll();
    const exists = clients.some((c: any) => c.url.endsWith(OFFSCREEN_PATH));
    if (exists) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: 'Hosting Web Audio mixing, MediaRecorder, and display media capture for screen/tab recording'
  });
  console.log('[Capdio SW] Offscreen document created');
}

// Close offscreen document
export async function closeOffscreenDocument(): Promise<void> {
  if ('hasDocument' in chrome.offscreen) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      await chrome.offscreen.closeDocument();
      console.log('[Capdio SW] Offscreen document closed');
    }
  }
}

// Register typed message handlers for 'background' target
registerMessageListener('background', {
  PING: async () => {
    return {
      appName: 'Capdio',
      version: '0.1.0',
      timestamp: Date.now(),
      status: stateMachine.currentStatus,
      activeSessionId: stateMachine.activeSessionId,
      serviceWorkerActive: true
    };
  },

  GET_STATUS: async () => {
    return {
      status: stateMachine.currentStatus,
      activeSessionId: stateMachine.activeSessionId,
      activeSession: sessionRegistry.activeSession,
      lastError: stateMachine.lastError
    };
  },

  PROBE_CAPABILITIES: async () => {
    await ensureOffscreenDocument();
    const offscreenRes = await sendTypedMessage<any>('offscreen', 'PROBE_CAPABILITIES');
    if (!offscreenRes.success) {
      throw new MessageBusError(
        offscreenRes.errorCode || 'E_CODEC_UNSUPPORTED',
        offscreenRes.error || 'Failed to probe capabilities in offscreen host'
      );
    }
    return offscreenRes.data;
  },

  START_CAPTURE: async (msg: StartCaptureMessage) => {
    if (stateMachine.isActive()) {
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `A capture session is already active in state '${stateMachine.currentStatus}'`
      );
    }

    const targetKind = (msg.payload?.targetKind || 'tab') as 'tab' | 'screen' | 'window';
    const profile = msg.payload?.profile || {
      width: 1920,
      height: 1080,
      fps: 30,
      mimePreference: 'webm',
      tabAudio: true,
      microphone: false
    };

    const session = await sessionRegistry.createSession(profile);
    stateMachine.requestStart(session.sessionId);
    stateMachine.markPreparing();

    try {
      let streamId: string | undefined = undefined;
      let targetTabId: number | undefined = undefined;

      if (targetKind === 'tab') {
        targetTabId = await resolveTargetTabId(msg.payload?.targetTabId);
        streamId = msg.payload?.streamId || (await getTabMediaStreamId(targetTabId));
      }

      // Ensure Offscreen Host exists with USER_MEDIA and DISPLAY_MEDIA
      await ensureOffscreenDocument();

      // Delegate to Offscreen Document for Web Audio & MediaRecorder
      const offscreenRes = await sendTypedMessage<any>('offscreen', 'OFFSCREEN_START', {
        sessionId: session.sessionId,
        streamId,
        kind: targetKind,
        profile
      });

      if (!offscreenRes.success) {
        throw new MessageBusError(
          offscreenRes.errorCode || 'E_CAPTURE_DENIED',
          offscreenRes.error || 'Offscreen capture failed to start'
        );
      }

      stateMachine.markRecording();
      await sessionRegistry.updateSessionStatus(session.sessionId, 'recording');
      await sessionRegistry.addSource(session.sessionId, {
        sourceId: streamId ? streamId.substring(0, 12) : `${targetKind}_${Date.now()}`,
        kind: targetKind,
        tabId: targetKind === 'tab' ? targetTabId : undefined,
        displayLabel: msg.payload?.displayLabel || (targetKind === 'tab' ? 'Active Tab' : 'Screen / Window'),
        authorizedAt: new Date().toISOString(),
        actualWidth: offscreenRes.data?.videoSettings?.width || profile.width,
        actualHeight: offscreenRes.data?.videoSettings?.height || profile.height,
        actualFps: offscreenRes.data?.videoSettings?.frameRate || profile.fps,
        audioMetadata: offscreenRes.data?.audioMetadata
      });

      return {
        sessionId: session.sessionId,
        status: stateMachine.currentStatus,
        offscreenResult: offscreenRes.data
      };
    } catch (err: any) {
      const code = typeof err.code === 'string' ? err.code : 'E_CAPTURE_DENIED';
      stateMachine.markError(code, err.message);
      await sessionRegistry.updateSessionStatus(session.sessionId, 'error', code);
      // Reset state machine back to idle so user can retry immediately after denial/cancellation
      stateMachine.reset();
      throw new MessageBusError(code, err.message);
    }
  },

  PAUSE_CAPTURE: async (_msg: PauseCaptureMessage) => {
    if (!stateMachine.isRecording()) {
      if (stateMachine.isPaused()) {
        return { status: 'paused', sessionId: stateMachine.activeSessionId };
      }
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `Cannot pause: Session is in '${stateMachine.currentStatus}', not 'recording'`
      );
    }

    stateMachine.pause();
    await sendTypedMessage('offscreen', 'OFFSCREEN_PAUSE');
    if (stateMachine.activeSessionId) {
      await sessionRegistry.updateSessionStatus(stateMachine.activeSessionId, 'paused');
    }

    return {
      status: stateMachine.currentStatus,
      sessionId: stateMachine.activeSessionId
    };
  },

  RESUME_CAPTURE: async (_msg: ResumeCaptureMessage) => {
    if (!stateMachine.isPaused()) {
      if (stateMachine.isRecording()) {
        return { status: 'recording', sessionId: stateMachine.activeSessionId };
      }
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `Cannot resume: Session is in '${stateMachine.currentStatus}', not 'paused'`
      );
    }

    stateMachine.resume();
    await sendTypedMessage('offscreen', 'OFFSCREEN_RESUME');
    if (stateMachine.activeSessionId) {
      await sessionRegistry.updateSessionStatus(stateMachine.activeSessionId, 'recording');
    }

    return {
      status: stateMachine.currentStatus,
      sessionId: stateMachine.activeSessionId
    };
  },

  STOP_CAPTURE: async (msg: StopCaptureMessage) => {
    if (stateMachine.isIdle() || stateMachine.currentStatus === 'ready') {
      return {
        status: stateMachine.currentStatus,
        sessionId: stateMachine.activeSessionId
      };
    }

    const sessionId = stateMachine.activeSessionId || msg.payload?.sessionId;
    stateMachine.stop();

    let offscreenRes: any = null;
    try {
      offscreenRes = await sendTypedMessage<any>('offscreen', 'OFFSCREEN_STOP');
    } catch (stopErr) {
      console.warn('[Capdio SW] offscreen stop warning:', stopErr);
    }

    if (sessionId) {
      await sessionRegistry.updateSessionStatus(sessionId, 'finalizing');
      if (offscreenRes?.data) {
        await sessionRegistry.addSegment(sessionId, {
          partId: 'part_001',
          sourceId: 'tab',
          startMs: 0,
          bytes: offscreenRes.data.totalBytes || 0
        });
      }
      stateMachine.markReady();
      await sessionRegistry.updateSessionStatus(sessionId, 'ready');
    } else {
      stateMachine.markReady();
    }

    return {
      status: stateMachine.currentStatus,
      sessionId,
      session: sessionId ? await sessionRegistry.getSession(sessionId) : null,
      recordingResult: offscreenRes?.data
    };
  },

  RESET_CAPTURE: async () => {
    stateMachine.reset();
    sessionRegistry.clearActiveSession();
    return {
      status: stateMachine.currentStatus
    };
  },

  GET_SESSION: async (msg: GetSessionMessage) => {
    const session = await sessionRegistry.getSession(msg.payload.sessionId);
    return { session };
  },

  ENSURE_OFFSCREEN: async () => {
    await ensureOffscreenDocument();
    return { hasDocument: true };
  },

  CLOSE_OFFSCREEN: async () => {
    await closeOffscreenDocument();
    return { hasDocument: false };
  },

  SET_AUDIO_MONITOR: async (msg: any) => {
    await ensureOffscreenDocument();
    const res = await sendTypedMessage<any>('offscreen', 'SET_AUDIO_MONITOR', msg.payload);
    return res.data;
  },

  SET_MIC_MUTE: async (msg: any) => {
    await ensureOffscreenDocument();
    const res = await sendTypedMessage<any>('offscreen', 'SET_MIC_MUTE', msg.payload);
    return res.data;
  },

  GET_AUDIO_STATUS: async () => {
    await ensureOffscreenDocument();
    const res = await sendTypedMessage<any>('offscreen', 'GET_AUDIO_STATUS');
    return res.data;
  }
});

// Action Click Fallback (for testing / direct invocation)
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Capdio SW] Action clicked on tab:', tab.id, tab.url);
  try {
    if (stateMachine.isRecording()) {
      await sendTypedMessage('background', 'STOP_CAPTURE');
    } else if (stateMachine.isIdle()) {
      await sendTypedMessage('background', 'START_CAPTURE', {
        targetTabId: tab.id,
        profile: {
          width: 1920,
          height: 1080,
          fps: 30,
          mimePreference: 'webm',
          tabAudio: true,
          microphone: false
        }
      });
    }
  } catch (err) {
    console.error('[Capdio SW] Action click error:', err);
  }
});

// Extension Lifecycle Handlers
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  console.log('[Capdio SW] onInstalled fired with reason:', details.reason);
  updateActionBadge('idle');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Capdio SW] onStartup fired; FSM reset to IDLE');
  stateMachine.reset();
  sessionRegistry.clearActiveSession();
  updateActionBadge('idle');
});

console.log('[Capdio SW] Service Worker & FSM Coordinator initialized successfully');
