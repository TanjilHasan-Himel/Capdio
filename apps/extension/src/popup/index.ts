// apps/extension/src/popup/index.ts
// Capdio Popup Interface Logic

import { sendTypedMessage } from '../shared/message-bus';

console.log('[Capdio Popup] Initializing UI...');

document.addEventListener('DOMContentLoaded', async () => {
  const statusText = document.getElementById('statusText');
  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const captureTarget = document.getElementById('captureTarget') as HTMLSelectElement;
  const qualityPreset = document.getElementById('qualityPreset') as HTMLSelectElement;
  const tabAudioToggle = document.getElementById('tabAudioToggle') as HTMLInputElement;
  const micToggle = document.getElementById('micToggle') as HTMLInputElement;

  try {
    // Ping background service worker to confirm connectivity
    const pingResponse = await sendTypedMessage('background', 'PING');
    console.log('[Capdio Popup] SW Ping response:', pingResponse);

    if (pingResponse.success && pingResponse.data) {
      const data = pingResponse.data as any;
      if (statusText) {
        statusText.textContent = data.status === 'recording' ? 'Recording' : 'Ready';
      }
    }
  } catch (err) {
    console.error('[Capdio Popup] Failed to connect to background SW:', err);
    if (statusText) {
      statusText.textContent = 'Offline';
    }
  }

  if (recordButton) {
    recordButton.addEventListener('click', async () => {
      console.log('[Capdio Popup] Record button clicked with settings:', {
        target: captureTarget?.value,
        preset: qualityPreset?.value,
        tabAudio: tabAudioToggle?.checked,
        mic: micToggle?.checked
      });

      // Dispatch status check or capture command via message bus
      recordButton.disabled = true;
      recordButton.textContent = 'Connecting...';

      const statusRes = await sendTypedMessage('background', 'GET_STATUS');
      console.log('[Capdio Popup] Status result:', statusRes);

      recordButton.disabled = false;
      recordButton.textContent = 'Start Recording';
    });
  }
});
