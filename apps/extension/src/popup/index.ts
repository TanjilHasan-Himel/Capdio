// apps/extension/src/popup/index.ts
// Capdio Popup Interface Logic with State Synchronization (OCS-101 / OCS-102)

import { sendTypedMessage } from '../shared/message-bus';
import type { RecordStatus, CaptureProfile } from '../shared/types';

console.log('[Capdio Popup] Initializing UI...');

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const configSection = document.getElementById('configSection');
  const activeSection = document.getElementById('activeSection');
  const readySection = document.getElementById('readySection');
  const activeSessionInfo = document.getElementById('activeSessionInfo');

  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const pauseResumeButton = document.getElementById('pauseResumeButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const resetButton = document.getElementById('resetButton') as HTMLButtonElement;

  const captureTarget = document.getElementById('captureTarget') as HTMLSelectElement;
  const qualityPreset = document.getElementById('qualityPreset') as HTMLSelectElement;
  const tabAudioToggle = document.getElementById('tabAudioToggle') as HTMLInputElement;
  const micToggle = document.getElementById('micToggle') as HTMLInputElement;

  let currentStatus: RecordStatus = 'idle';
  let activeSessionId: string | null = null;

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

      const res = await sendTypedMessage<any>('background', 'START_CAPTURE', {
        profile,
        targetKind: captureTarget?.value || 'tab'
      });

      console.log('[Capdio Popup] START_CAPTURE response:', res);
      if (res.success && res.data) {
        renderState(res.data.status, res.data.sessionId);
      } else {
        alert(`Failed to start capture: ${res.error || 'Unknown error'}`);
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
        renderState(res.data.status, activeSessionId);
      }
    });
  }

  // Reset to New Recording
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      await sendTypedMessage('background', 'RESET_CAPTURE');
      renderState('idle');
    });
  }
});
