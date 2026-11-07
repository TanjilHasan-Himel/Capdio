// apps/extension/src/popup/index.ts
// Capdio Popup Interface Logic with State Synchronization (OCS-101 / OCS-102 / OCS-103)

import { sendTypedMessage } from '../shared/message-bus.ts';
import type { RecordStatus, CaptureProfile } from '../shared/types.ts';

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

  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const pauseResumeButton = document.getElementById('pauseResumeButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const resetButton = document.getElementById('resetButton') as HTMLButtonElement;

  const captureTarget = document.getElementById('captureTarget') as HTMLSelectElement;
  const qualityPreset = document.getElementById('qualityPreset') as HTMLSelectElement;
  const tabAudioToggle = document.getElementById('tabAudioToggle') as HTMLInputElement;
  const micToggle = document.getElementById('micToggle') as HTMLInputElement;

  let currentStatus: RecordStatus = 'idle';
  let activeSessionId: string | null = null;
  let timerInterval: any = null;
  let elapsedSeconds = 0;
  let lastRecordingBase64: string | null = null;

  function updateTimerDisplay() {
    if (!recordingTimer) return;
    const mins = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const secs = (elapsedSeconds % 60).toString().padStart(2, '0');
    recordingTimer.textContent = `${mins}:${secs}`;
  }

  function startTimer() {
    clearInterval(timerInterval);
    elapsedSeconds = 0;
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

      if (status === 'recording' && !timerInterval) {
        startTimer();
      }

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

  // Fetch initial status on load
  try {
    const statusRes = await sendTypedMessage<any>('background', 'GET_STATUS');
    console.log('[Capdio Popup] Initial status response:', statusRes);
    if (statusRes.success && statusRes.data) {
      renderState(statusRes.data.status, statusRes.data.activeSessionId);
    }
  } catch (err) {
    console.error('[Capdio Popup] Failed to get initial status:', err);
    renderState('idle');
  }

  // Start Recording
  if (recordButton) {
    recordButton.addEventListener('click', async () => {
      recordButton.disabled = true;
      recordButton.textContent = 'Starting...';

      let width = 1920;
      let height = 1080;
      let fps: 24 | 30 | 60 = 30;

      if (qualityPreset?.value === '720p') {
        width = 1280;
        height = 720;
      } else if (qualityPreset?.value === '4k') {
        width = 3840;
        height = 2160;
        fps = 60;
      }

      const profile: CaptureProfile = {
        width,
        height,
        fps,
        mimePreference: 'webm',
        tabAudio: tabAudioToggle?.checked ?? true,
        microphone: micToggle?.checked ?? false
      };

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
          targetKind: captureTarget?.value || 'tab',
          displayLabel: tabToCapture.title || tabToCapture.url || 'Active Tab'
        });

        console.log('[Capdio Popup] START_CAPTURE response:', res);
        if (res.success && res.data) {
          startTimer();
          renderState(res.data.status, res.data.sessionId);
        } else {
          alert(`Failed to start capture: ${res.error || 'Unknown error'}`);
          renderState('idle');
        }
      } catch (err: any) {
        console.error('[Capdio Popup] Capture start failed:', err);
        alert(`Failed to start capture: ${err.message}`);
        renderState('idle');
      }
    });
  }

  // Pause / Resume
  if (pauseResumeButton) {
    pauseResumeButton.addEventListener('click', async () => {
      if (currentStatus === 'paused') {
        const res = await sendTypedMessage<any>('background', 'RESUME_CAPTURE', {
          sessionId: activeSessionId
        });
        if (res.success && res.data) {
          renderState(res.data.status, activeSessionId);
        }
      } else if (currentStatus === 'recording') {
        const res = await sendTypedMessage<any>('background', 'PAUSE_CAPTURE', {
          sessionId: activeSessionId
        });
        if (res.success && res.data) {
          renderState(res.data.status, activeSessionId);
        }
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
          (window as any).__lastRecordingBase64 = recResult.base64Data;
          (window as any).__lastResult = res.data;
          if (readyInfo) {
            const mb = (recResult.totalBytes / (1024 * 1024)).toFixed(2);
            readyInfo.textContent = `Size: ${mb} MB (${recResult.chunksCount} chunks)`;
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

      const byteChars = atob(lastRecordingBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capdio-recording-${activeSessionId || Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Reset to New Recording
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      await sendTypedMessage('background', 'RESET_CAPTURE');
      lastRecordingBase64 = null;
      renderState('idle');
    });
  }
});
