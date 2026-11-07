// apps/extension/src/popup/index.ts
// Capdio Popup Interface Logic with State Synchronization (OCS-101 - OCS-105)

import { sendTypedMessage } from '../shared/message-bus.ts';
import type { RecordStatus, CaptureProfile, QualityPresetName } from '../shared/types.ts';
import { QUALITY_PRESETS } from '../shared/types.ts';

console.log('[Capdio Popup] Initializing UI...');

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const configSection = document.getElementById('configSection');
  const activeSection = document.getElementById('activeSection');
  const readySection = document.getElementById('readySection');
  const activeSessionInfo = document.getElementById('activeSessionInfo');
  const recordingTimer = document.getElementById('recordingTimer');
  const readyInfo = document.getElementById('readyInfo');
  const noticeBanner = document.getElementById('noticeBanner');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeMessage = document.getElementById('noticeMessage');
  const noticeDismiss = document.getElementById('noticeDismiss');

  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const pauseResumeButton = document.getElementById('pauseResumeButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const resetButton = document.getElementById('resetButton') as HTMLButtonElement;

  const captureTarget = document.getElementById('captureTarget') as HTMLSelectElement;
  const qualityPreset = document.getElementById('qualityPreset') as HTMLSelectElement;
  const formatPreference = document.getElementById('formatPreference') as HTMLSelectElement;
  const mp4Option = document.getElementById('mp4Option') as HTMLOptionElement;
  const tabAudioToggle = document.getElementById('tabAudioToggle') as HTMLInputElement;
  const micToggle = document.getElementById('micToggle') as HTMLInputElement;

  let currentStatus: RecordStatus = 'idle';
  let activeSessionId: string | null = null;
  let timerInterval: any = null;
  let elapsedSeconds = 0;
  let lastRecordingBase64: string | null = null;
  let lastRecordingMimeType = 'video/webm';
  let lastRecordingIsFallback = false;

  function showNotice(title: string, message: string) {
    if (noticeBanner && noticeTitle && noticeMessage) {
      noticeTitle.textContent = title;
      noticeMessage.textContent = message;
      noticeBanner.classList.remove('hidden');
    }
  }

  function hideNotice() {
    noticeBanner?.classList.add('hidden');
  }

  if (noticeDismiss) {
    noticeDismiss.addEventListener('click', () => {
      hideNotice();
    });
  }

  function updateTimerDisplay() {
    if (!recordingTimer) return;
    const mins = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const secs = (elapsedSeconds % 60).toString().padStart(2, '0');
    recordingTimer.textContent = `${mins}:${secs}`;
  }

  function startTimer(reset = true) {
    clearInterval(timerInterval);
    if (reset) {
      elapsedSeconds = 0;
    }
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      if (currentStatus === 'recording') {
        elapsedSeconds++;
        updateTimerDisplay();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  function renderState(status: RecordStatus, sessionId?: string | null) {
    currentStatus = status;
    activeSessionId = sessionId || null;

    if (statusText) {
      statusText.textContent = status.toUpperCase();
    }

    if (statusBadge) {
      statusBadge.className = 'status-badge';
      if (status === 'recording') statusBadge.classList.add('recording');
      if (status === 'paused') statusBadge.classList.add('paused');
    }

    if (activeSessionInfo && activeSessionId) {
      activeSessionInfo.textContent = `ID: ${activeSessionId.substring(0, 16)}...`;
    }

    // Toggle visible sections
    if (status === 'idle') {
      stopTimer();
      configSection?.classList.remove('hidden');
      activeSection?.classList.add('hidden');
      readySection?.classList.add('hidden');
      if (recordButton) {
        recordButton.disabled = false;
        recordButton.textContent = 'Start Recording';
      }
    } else if (status === 'recording' || status === 'paused' || status === 'preparing') {
      configSection?.classList.add('hidden');
      activeSection?.classList.remove('hidden');
      readySection?.classList.add('hidden');

      if (pauseResumeButton) {
        pauseResumeButton.textContent = status === 'paused' ? 'Resume' : 'Pause';
      }
    } else if (status === 'ready') {
      stopTimer();
      configSection?.classList.add('hidden');
      activeSection?.classList.add('hidden');
      readySection?.classList.remove('hidden');
    }
  }

  // Fetch initial status on load (OCS-107: State & Timer Rehydration, OCS-108: Result Rehydration)
  try {
    const statusRes = await sendTypedMessage<any>('background', 'GET_STATUS');
    console.log('[Capdio Popup] Initial status response:', statusRes);
    if (statusRes.success && statusRes.data) {
      if (typeof statusRes.data.timing?.elapsedSeconds === 'number') {
        elapsedSeconds = statusRes.data.timing.elapsedSeconds;
        updateTimerDisplay();
      }

      // Rehydrate completed recording if status is ready (OCS-108)
      if (statusRes.data.status === 'ready' && statusRes.data.lastRecordingResult) {
        const recResult = statusRes.data.lastRecordingResult;
        if (recResult.base64Data) {
          lastRecordingBase64 = recResult.base64Data;
          lastRecordingMimeType = recResult.mimeType || recResult.negotiatedMimeType || 'video/webm';
          lastRecordingIsFallback = !!recResult.isFallback;
          (window as any).__lastRecordingBase64 = recResult.base64Data;
          (window as any).__lastResult = statusRes.data;

          const isMp4 = lastRecordingMimeType.includes('mp4');
          if (downloadButton) {
            downloadButton.textContent = isMp4 ? 'Download MP4' : 'Download WebM';
          }

          if (readyInfo) {
            const mb = (recResult.totalBytes / (1024 * 1024)).toFixed(2);
            let detail = `Size: ${mb} MB (${recResult.chunksCount} chunks) • ${isMp4 ? 'MP4' : 'WebM'}`;
            if (lastRecordingIsFallback) {
              detail += ' (fallback from MP4)';
            }
            readyInfo.textContent = detail;
          }
        }
      }

      // Surface termination notice if source closed or capture ended externally (OCS-108)
      if (statusRes.data.lastTerminationReason === 'source_tab_closed') {
        showNotice(
          'Captured Tab Closed',
          'The captured browser tab was closed. Your recording was safely saved up to that moment and is ready to download.'
        );
      } else if (statusRes.data.lastTerminationReason === 'track_ended') {
        showNotice(
          'Capture Ended',
          'Screen or window sharing was ended. Your recording was safely saved and is ready to download.'
        );
      } else if (statusRes.data.lastError?.code === 'E_SOURCE_CLOSED') {
        showNotice(
          'Source Closed',
          statusRes.data.lastError.message || 'Captured source was closed before recording data was produced.'
        );
      }

      renderState(statusRes.data.status, statusRes.data.activeSessionId);
      if (statusRes.data.status === 'recording') {
        startTimer(false);
      }
    }
  } catch (err) {
    console.error('[Capdio Popup] Failed to get initial status:', err);
    renderState('idle');
  }

  // Probe codec capabilities (OCS-105)
  try {
    const capRes = await sendTypedMessage<any>('background', 'PROBE_CAPABILITIES');
    console.log('[Capdio Popup] Capabilities response:', capRes);
    if (capRes.success && capRes.data?.report) {
      const report = capRes.data.report;
      if (!report.canRecordMp4 && mp4Option) {
        mp4Option.disabled = true;
        mp4Option.textContent = 'MP4 (Unsupported on this browser)';
      }
    }
  } catch (capErr) {
    console.warn('[Capdio Popup] Failed to probe capabilities:', capErr);
  }

  // Start Recording
  if (recordButton) {
    recordButton.addEventListener('click', async () => {
      recordButton.disabled = true;
      recordButton.textContent = 'Starting...';

      const presetKey = (qualityPreset?.value || 'balanced') as QualityPresetName;
      const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS.balanced;
      const formatPref = ((formatPreference?.value || 'webm') as 'webm' | 'mp4');

      const profile: CaptureProfile = {
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        videoBitrate: preset.videoBitrate,
        mimePreference: formatPref,
        tabAudio: tabAudioToggle?.checked ?? true,
        microphone: micToggle?.checked ?? false
      };

      const selectedKind = captureTarget?.value || 'tab';
      hideNotice();

      if (selectedKind === 'screen' || selectedKind === 'window') {
        // Native Screen or Window Capture via Offscreen getDisplayMedia (OCS-104)
        try {
          const res = await sendTypedMessage<any>('background', 'START_CAPTURE', {
            profile,
            targetKind: selectedKind,
            displayLabel: selectedKind === 'screen' ? 'Entire Screen' : 'Application Window'
          });

          console.log('[Capdio Popup] START_CAPTURE (screen/window) response:', res);
          if (res.success && res.data) {
            startTimer();
            renderState(res.data.status, res.data.sessionId);
          } else {
            showNotice('Permission Refusal / Cancellation', res.error || 'Screen capture was cancelled or denied.');
            renderState('idle');
          }
        } catch (err: any) {
          console.warn('[Capdio Popup] Screen capture cancelled or denied:', err);
          showNotice('Permission Refusal / Cancellation', err.message || 'Screen capture was cancelled or denied.');
          renderState('idle');
        }
      } else {
        // Single Tab Capture (OCS-103)
        try {
          // 1. Resolve target tab
          const allTabs = await chrome.tabs.query({});
          let tabToCapture = allTabs.find(t => t.active && t.url && !t.url.startsWith('chrome') && !t.url.includes('popup.html'));
          if (!tabToCapture) {
            tabToCapture = allTabs.find(t => t.url && !t.url.startsWith('chrome') && !t.url.includes('popup.html'));
          }
          if (!tabToCapture || !tabToCapture.id) {
            throw new Error('No capturable web tab found');
          }

          // 2. Acquire ephemeral streamId directly inside user click gesture
          const streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabToCapture!.id }, (id) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              if (!id) {
                return reject(new Error('No streamId returned by tabCapture.getMediaStreamId'));
              }
              resolve(id);
            });
          });

          const res = await sendTypedMessage<any>('background', 'START_CAPTURE', {
            profile,
            streamId,
            targetTabId: tabToCapture.id,
            targetKind: 'tab',
            displayLabel: tabToCapture.title || tabToCapture.url || 'Active Tab'
          });

          console.log('[Capdio Popup] START_CAPTURE (tab) response:', res);
          if (res.success && res.data) {
            startTimer();
            renderState(res.data.status, res.data.sessionId);
          } else {
            showNotice('Capture Failed', res.error || 'Unknown error');
            renderState('idle');
          }
        } catch (err: any) {
          console.error('[Capdio Popup] Tab capture start failed:', err);
          showNotice('Capture Failed', err.message || 'Tab capture failed');
          renderState('idle');
        }
      }
    });
  }

  // Pause / Resume (OCS-107)
  if (pauseResumeButton) {
    pauseResumeButton.addEventListener('click', async () => {
      pauseResumeButton.disabled = true;
      try {
        if (currentStatus === 'paused') {
          const res = await sendTypedMessage<any>('background', 'RESUME_CAPTURE', {
            sessionId: activeSessionId
          });
          if (res.success && res.data) {
            if (typeof res.data.timing?.elapsedSeconds === 'number') {
              elapsedSeconds = res.data.timing.elapsedSeconds;
            }
            renderState(res.data.status, activeSessionId);
            startTimer(false);
          }
        } else if (currentStatus === 'recording') {
          const res = await sendTypedMessage<any>('background', 'PAUSE_CAPTURE', {
            sessionId: activeSessionId
          });
          if (res.success && res.data) {
            if (typeof res.data.timing?.elapsedSeconds === 'number') {
              elapsedSeconds = res.data.timing.elapsedSeconds;
              updateTimerDisplay();
            }
            renderState(res.data.status, activeSessionId);
            stopTimer();
          }
        }
      } finally {
        pauseResumeButton.disabled = false;
      }
    });
  }

  // Stop Recording
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      stopButton.disabled = true;
      stopButton.textContent = 'Stopping...';

      const res = await sendTypedMessage<any>('background', 'STOP_CAPTURE', {
        sessionId: activeSessionId
      });

      stopButton.disabled = false;
      stopButton.textContent = 'Stop';

      console.log('[Capdio Popup] STOP_CAPTURE response:', res);
      if (res.success && res.data) {
        const recResult = res.data.recordingResult;
        if (recResult?.base64Data) {
          lastRecordingBase64 = recResult.base64Data;
          lastRecordingMimeType = recResult.mimeType || recResult.negotiatedMimeType || 'video/webm';
          lastRecordingIsFallback = !!recResult.isFallback;
          (window as any).__lastRecordingBase64 = recResult.base64Data;
          (window as any).__lastResult = res.data;

          const isMp4 = lastRecordingMimeType.includes('mp4');
          if (downloadButton) {
            downloadButton.textContent = isMp4 ? 'Download MP4' : 'Download WebM';
          }

          if (readyInfo) {
            const mb = (recResult.totalBytes / (1024 * 1024)).toFixed(2);
            let detail = `Size: ${mb} MB (${recResult.chunksCount} chunks) • ${isMp4 ? 'MP4' : 'WebM'}`;
            if (lastRecordingIsFallback) {
              detail += ' (fallback from MP4)';
            }
            readyInfo.textContent = detail;
          }
        }
        renderState(res.data.status, activeSessionId);
      }
    });
  }

  // Download Recording
  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      if (!lastRecordingBase64) {
        alert('No recording data available to download');
        return;
      }

      const isMp4 = lastRecordingMimeType.includes('mp4');
      const ext = isMp4 ? 'mp4' : 'webm';
      const mime = isMp4 ? 'video/mp4' : 'video/webm';

      const byteChars = atob(lastRecordingBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capdio-recording-${activeSessionId || Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Reset to New Recording
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      hideNotice();
      await sendTypedMessage('background', 'RESET_CAPTURE');
      lastRecordingBase64 = null;
      renderState('idle');
    });
  }
});
