// apps/extension/src/background/index.ts
// Capdio MV3 Service Worker Entrypoint & State Coordinator (OCS-101 / OCS-102)

import { registerMessageListener, MessageBusError } from '../shared/message-bus';
import { RecordingStateMachine } from './state-machine';
import { SessionRegistry } from './session-registry';
import type {
  StartCaptureMessage,
  PauseCaptureMessage,
  ResumeCaptureMessage,
  StopCaptureMessage,
  GetSessionMessage,
  RecordStatus
} from '../shared/types';

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
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Hosting Web Audio mixing and MediaRecorder for screen/tab capture'
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

  START_CAPTURE: async (msg: StartCaptureMessage) => {
    if (stateMachine.isActive()) {
      throw new MessageBusError(
        'E_SESSION_CONFLICT',
        `A capture session is already active in state '${stateMachine.currentStatus}'`
      );
    }

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

    return {
      sessionId: session.sessionId,
      status: stateMachine.currentStatus,
      session
    };
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

    if (sessionId) {
      await sessionRegistry.updateSessionStatus(sessionId, 'finalizing');
      stateMachine.markReady();
      await sessionRegistry.updateSessionStatus(sessionId, 'ready');
    } else {
      stateMachine.markReady();
    }

    return {
      status: stateMachine.currentStatus,
      sessionId,
      session: sessionId ? await sessionRegistry.getSession(sessionId) : null
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
