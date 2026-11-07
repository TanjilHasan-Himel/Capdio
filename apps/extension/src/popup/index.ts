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

  // Recovery Center Elements (OCS-204)
  const recoveryCenter = document.getElementById('recoveryCenter');
  const recoveryMessage = document.getElementById('recoveryMessage');
  const recoveryMeta = document.getElementById('recoveryMeta');
  const recoverButton = document.getElementById('recoverButton') as HTMLButtonElement;
  const discardRecoveryButton = document.getElementById('discardRecoveryButton') as HTMLButtonElement;

  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const pauseResumeButton = document.getElementById('pauseResumeButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const resetButton = document.getElementById('resetButton') as HTMLButtonElement;
  const openLibraryBtn = document.getElementById('openLibraryBtn') as HTMLButtonElement;
  const viewInLibraryBtn = document.getElementById('viewInLibraryBtn') as HTMLButtonElement;

  const captureTarget = document.getElementById('captureTarget') as HTMLSelectElement;
  const qualityPreset = document.getElementById('qualityPreset') as HTMLSelectElement;
  const fpsSelect = document.getElementById('fpsSelect') as HTMLSelectElement;
  const presetHint = document.getElementById('presetHint');
  const liveQualityBadge = document.getElementById('liveQualityBadge');
  const formatPreference = document.getElementById('formatPreference') as HTMLSelectElement;
  const mp4Option = document.getElementById('mp4Option') as HTMLOptionElement;
  const tabAudioToggle = document.getElementById('tabAudioToggle') as HTMLInputElement;
  const micToggle = document.getElementById('micToggle') as HTMLInputElement;
  const micDeviceGroup = document.getElementById('micDeviceGroup');
  const micSelect = document.getElementById('micSelect') as HTMLSelectElement;
  const audioMeterBar = document.getElementById('audioMeterBar');
  const audioLevelText = document.getElementById('audioLevelText');

  let currentStatus: RecordStatus = 'idle';
  let activeSessionId: string | null = null;
  let timerInterval: any = null;
  let elapsedSeconds = 0;
  let lastRecordingBase64: string | null = null;
  let lastRecordingMimeType = 'video/webm';
  let recoverableSession: any = null;

  function updatePresetHint() {
    if (!presetHint || !qualityPreset) return;
    const presetKey = (qualityPreset.value || 'balanced') as QualityPresetName;
    const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS.balanced;
    const selectedFps = fpsSelect ? parseInt(fpsSelect.value, 10) || preset.fps : preset.fps;
    const mbps = (preset.videoBitrate / 1_000_000).toFixed(1);
    presetHint.textContent = `Requested: ${preset.height}p @ ${selectedFps} FPS (${mbps} Mbps)`;
  }

  if (qualityPreset) {
    qualityPreset.addEventListener('change', () => {
      const presetKey = (qualityPreset.value || 'balanced') as QualityPresetName;
      const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS.balanced;
      if (fpsSelect) {
        fpsSelect.value = String(preset.fps);
      }
      updatePresetHint();
    });
  }

  if (fpsSelect) {
    fpsSelect.addEventListener('change', () => {
      updatePresetHint();
    });
  }

  updatePresetHint();

  function updateLiveQualityDisplay(session?: any, videoSettings?: any) {
    if (!liveQualityBadge) return;
    const src = session?.sources?.[0];
    const actualW = videoSettings?.width || src?.actualWidth;
    const actualH = videoSettings?.height || src?.actualHeight;
    const actualFps = videoSettings?.frameRate || src?.actualFps || 30;
    const reqW = src?.requestedWidth || session?.profile?.width;
    const reqH = src?.requestedHeight || session?.profile?.height;

    if (actualW && actualH) {
      const isConstrained = reqW && (actualW < reqW || (reqH && actualH < reqH));
      liveQualityBadge.textContent = `${actualW}×${actualH} @ ${actualFps}fps${isConstrained ? ' (Constrained)' : ''}`;
      liveQualityBadge.style.color = isConstrained ? '#fbbf24' : '#60a5fa';
      liveQualityBadge.title = isConstrained
        ? `Requested ${reqW}×${reqH}, display viewport constrained to ${actualW}×${actualH}`
        : `Actual measured stream: ${actualW}×${actualH} @ ${actualFps} FPS`;
    } else {
      liveQualityBadge.textContent = 'Measuring...';
      liveQualityBadge.style.color = 'var(--text-muted)';
    }
  }

  function formatReadyQualityText(recResult: any, session?: any): string {
    const isMp4 = (recResult.mimeType || recResult.negotiatedMimeType || '').includes('mp4');
    const mb = ((recResult.totalBytes || 0) / (1024 * 1024)).toFixed(2);
    let detail = `Size: ${mb} MB (${recResult.chunksCount || 0} chunks) • ${isMp4 ? 'MP4' : 'WebM'}`;
    if (recResult.isFallback) {
      detail += ' (fallback from MP4)';
    }

    const src = session?.sources?.[0];
    const profile = session?.profile;
    const actualW = recResult.videoSettings?.width || src?.actualWidth;
    const actualH = recResult.videoSettings?.height || src?.actualHeight;
    const actualFps = recResult.videoSettings?.frameRate || src?.actualFps;
    const reqW = src?.requestedWidth || profile?.width;
    const reqH = src?.requestedHeight || profile?.height;
    const reqFps = src?.requestedFps || profile?.fps;
    const presetName = profile?.presetName;

    if (actualW && actualH) {
      const isConstrained = reqW && (actualW < reqW || (reqH && actualH < reqH));
      const presetLabel = presetName ? `${presetName.toUpperCase()} ` : '';
      detail += `\nActual: ${actualW}×${actualH} @ ${actualFps || 30} FPS${isConstrained ? ' (Display Constrained)' : ' (Native Match)'}`;
      if (reqW && reqH) {
        detail += ` • Requested: ${presetLabel}${reqW}×${reqH} @ ${reqFps || 30} FPS`;
      }
    }
    return detail;
  }

  async function updateMicDeviceList() {
    if (!micToggle?.checked) {
      micDeviceGroup?.classList.add('hidden');
      return;
    }
    micDeviceGroup?.classList.remove('hidden');
    try {
      const res = await sendTypedMessage<any>('background', 'ENUMERATE_AUDIO_DEVICES');
      if (res.success && Array.isArray(res.data?.devices) && res.data.devices.length > 0 && micSelect) {
        micSelect.innerHTML = '<option value="default">Default System Microphone</option>';
        res.data.devices.forEach((d: any) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `Microphone ${d.deviceId.slice(0, 5)}`;
          micSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('[Capdio Popup] Failed to enumerate audio devices:', err);
    }
  }

  if (micToggle) {
    micToggle.addEventListener('change', updateMicDeviceList);
  }

  async function updateAudioHealthMeter() {
    if (currentStatus !== 'recording') return;
    try {
      const audioRes = await sendTypedMessage<any>('background', 'GET_AUDIO_STATUS');
      if (audioRes.success && audioRes.data) {
        const { rmsLevel = 0, peakDb = -100, isClipping = false } = audioRes.data;
        if (audioMeterBar) {
          const pct = Math.min(100, Math.round(rmsLevel * 100));
          audioMeterBar.style.width = `${pct}%`;
          audioMeterBar.style.backgroundColor = isClipping ? '#ef4444' : (peakDb > -6 ? '#f59e0b' : '#10b981');
        }
        if (audioLevelText) {
          audioLevelText.textContent = peakDb <= -60 ? '-inf dB' : `${peakDb} dB`;
        }
      }
    } catch (_) {}
  }

  async function checkRecoverableSessions() {
    if (currentStatus !== 'idle') {
      recoveryCenter?.classList.add('hidden');
      return;
    }
    try {
      const res = await sendTypedMessage<any>('background', 'LIST_RECOVERABLE_SESSIONS');
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        recoverableSession = res.data[0];
        if (recoveryCenter && recoveryMeta && recoveryMessage) {
          const mb = ((recoverableSession.totalBytes || 0) / (1024 * 1024)).toFixed(2);
          const title = recoverableSession.title || 'Previous recording';
          recoveryMessage.textContent = `"${title}" was interrupted unexpectedly. Intact chunks are available.`;
          recoveryMeta.textContent = `Session: ${recoverableSession.sessionId.substring(0, 16)}... • Size: ${mb} MB`;
          recoveryCenter.classList.remove('hidden');
        }
      } else {
        recoverableSession = null;
        recoveryCenter?.classList.add('hidden');
      }
    } catch (err) {
      console.warn('[Capdio Popup] Failed to check recoverable sessions:', err);
    }
  }

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
    timerInterval = setInterval(async () => {
      if (currentStatus === 'recording') {
        elapsedSeconds++;
        updateTimerDisplay();
        updateAudioHealthMeter();

        // Sync with background state for external events (low-storage auto-stop, tab closure)
        if (elapsedSeconds % 2 === 0) {
          try {
            const check = await sendTypedMessage<any>('background', 'GET_STATUS');
            if (check.success && check.data) {
              if (check.data.activeSession) {
                updateLiveQualityDisplay(check.data.activeSession);
              }
              if (check.data.status !== currentStatus) {
                if (check.data.status === 'ready') {
                  stopTimer();
                  renderState('ready', check.data.activeSessionId);
                  if (check.data.lastRecordingResult && readyInfo) {
                    readyInfo.textContent = formatReadyQualityText(check.data.lastRecordingResult, check.data.activeSession);
                  }
                  if (check.data.lastTerminationReason === 'low_storage') {
                    showNotice(
                      'Low Storage Auto-Stop',
                      'Recording stopped automatically because storage quota reached critical limits. Your recording was safely saved and is ready to download.'
                    );
                  } else if (check.data.lastTerminationReason === 'source_tab_closed') {
                    showNotice(
                      'Captured Tab Closed',
                      'The captured browser tab was closed. Your recording was safely saved up to that moment and is ready to download.'
                    );
                  } else if (check.data.lastTerminationReason === 'track_ended') {
                    showNotice(
                      'Capture Ended',
                      'Screen or window sharing was ended. Your recording was safely saved and is ready to download.'
                    );
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    if (audioMeterBar) audioMeterBar.style.width = '0%';
    if (audioLevelText) audioLevelText.textContent = '-inf dB';
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
      if (liveQualityBadge) {
        liveQualityBadge.textContent = '-';
        liveQualityBadge.style.color = '#60a5fa';
      }
      configSection?.classList.remove('hidden');
      activeSection?.classList.add('hidden');
      readySection?.classList.add('hidden');
      if (recordButton) {
        recordButton.disabled = false;
        recordButton.textContent = 'Start Recording';
      }
      checkRecoverableSessions();
    } else if (status === 'recording' || status === 'paused' || status === 'preparing') {
      recoveryCenter?.classList.add('hidden');
      configSection?.classList.add('hidden');
      activeSection?.classList.remove('hidden');
      readySection?.classList.add('hidden');

      if (pauseResumeButton) {
        pauseResumeButton.textContent = status === 'paused' ? 'Resume' : 'Pause';
      }
    } else if (status === 'ready') {
      stopTimer();
      recoveryCenter?.classList.add('hidden');
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
          (window as any).__lastRecordingBase64 = recResult.base64Data;
          (window as any).__lastResult = statusRes.data;

          const isMp4 = lastRecordingMimeType.includes('mp4');
          if (downloadButton) {
            downloadButton.textContent = isMp4 ? 'Download MP4' : 'Download WebM';
          }

          if (readyInfo) {
            readyInfo.textContent = formatReadyQualityText(recResult, statusRes.data.activeSession || statusRes.data.session);
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
      } else if (statusRes.data.lastTerminationReason === 'low_storage') {
        showNotice(
          'Low Storage Auto-Stop',
          'Recording stopped automatically because storage quota reached critical limits. Your recording was safely saved and is ready to download.'
        );
      } else if (statusRes.data.lastError?.code === 'E_SOURCE_CLOSED') {
        showNotice(
          'Source Closed',
          statusRes.data.lastError.message || 'Captured source was closed before recording data was produced.'
        );
      } else if (statusRes.data.lastError?.code === 'E_STORAGE_QUOTA') {
        showNotice(
          'Insufficient Storage',
          statusRes.data.lastError.message || 'Cannot record: local storage quota is critically low.'
        );
      }

      renderState(statusRes.data.status, statusRes.data.activeSessionId);
      if (statusRes.data.status === 'recording') {
        updateLiveQualityDisplay(statusRes.data.activeSession);
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
      const selectedFps = (fpsSelect ? parseInt(fpsSelect.value, 10) : preset.fps) || preset.fps;
      const formatPref = ((formatPreference?.value || 'webm') as 'webm' | 'mp4');

      const profile: CaptureProfile = {
        presetName: presetKey,
        width: preset.width,
        height: preset.height,
        fps: selectedFps as 24 | 30 | 60,
        videoBitrate: preset.videoBitrate,
        mimePreference: formatPref,
        tabAudio: tabAudioToggle?.checked ?? true,
        microphone: micToggle?.checked ?? false,
        micDeviceId: micSelect?.value || 'default'
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
            updateLiveQualityDisplay(res.data.session, res.data.videoSettings);
          } else {
            const title = res.errorCode === 'E_STORAGE_QUOTA' ? 'Insufficient Storage' : 'Permission Refusal / Cancellation';
            showNotice(title, res.error || 'Screen capture was cancelled or denied.');
            renderState('idle');
          }
        } catch (err: any) {
          console.warn('[Capdio Popup] Screen capture cancelled or denied:', err);
          const title = err.code === 'E_STORAGE_QUOTA' ? 'Insufficient Storage' : 'Permission Refusal / Cancellation';
          showNotice(title, err.message || 'Screen capture was cancelled or denied.');
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
            updateLiveQualityDisplay(res.data.session, res.data.videoSettings);
          } else {
            const title = res.errorCode === 'E_STORAGE_QUOTA' ? 'Insufficient Storage' : 'Capture Failed';
            showNotice(title, res.error || 'Unknown error');
            renderState('idle');
          }
        } catch (err: any) {
          console.error('[Capdio Popup] Tab capture start failed:', err);
          const title = err.code === 'E_STORAGE_QUOTA' ? 'Insufficient Storage' : 'Capture Failed';
          showNotice(title, err.message || 'Tab capture failed');
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
          (window as any).__lastRecordingBase64 = recResult.base64Data;
          (window as any).__lastResult = res.data;

          const isMp4 = lastRecordingMimeType.includes('mp4');
          if (downloadButton) {
            downloadButton.textContent = isMp4 ? 'Download MP4' : 'Download WebM';
          }

          if (readyInfo) {
            readyInfo.textContent = formatReadyQualityText(recResult, res.data.session || res.data.activeSession);
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

  // Recover Interrupted Session (OCS-204)
  if (recoverButton) {
    recoverButton.addEventListener('click', async () => {
      if (!recoverableSession) return;
      recoverButton.disabled = true;
      recoverButton.textContent = 'Recovering...';

      try {
        const res = await sendTypedMessage<any>('background', 'RECOVER_SESSION', {
          sessionId: recoverableSession.sessionId
        });

        if (res.success && res.data?.recordingResult) {
          const rec = res.data.recordingResult;
          lastRecordingBase64 = rec.base64Data;
          lastRecordingMimeType = rec.mimeType || 'video/webm';
          (window as any).__lastRecordingBase64 = rec.base64Data;
          (window as any).__lastResult = res.data;

          const isMp4 = lastRecordingMimeType.includes('mp4');
          if (downloadButton) {
            downloadButton.textContent = isMp4 ? 'Download MP4 [Partial]' : 'Download WebM [Partial]';
          }
          if (readyInfo) {
            const mb = (rec.totalBytes / (1024 * 1024)).toFixed(2);
            readyInfo.textContent = `Recovered Partial: ${mb} MB (${rec.chunksCount} chunks) • ${isMp4 ? 'MP4' : 'WebM'}`;
          }

          recoveryCenter?.classList.add('hidden');
          renderState('ready', recoverableSession.sessionId);
          showNotice(
            'Recovered Partial Recording',
            'Your recording was interrupted but intact chunks were successfully recovered and are ready to download.'
          );
        } else {
          showNotice('Recovery Failed', res.error || 'Could not assemble chunks from persistent storage.');
        }
      } catch (err: any) {
        showNotice('Recovery Failed', err.message || 'Error occurred while recovering recording.');
      } finally {
        recoverButton.disabled = false;
        recoverButton.textContent = 'Recover & Download';
      }
    });
  }

  // Discard Interrupted Session (OCS-204)
  if (discardRecoveryButton) {
    discardRecoveryButton.addEventListener('click', async () => {
      if (!recoverableSession) return;
      discardRecoveryButton.disabled = true;
      try {
        await sendTypedMessage('background', 'DISCARD_RECOVERABLE_SESSION', {
          sessionId: recoverableSession.sessionId
        });
        recoverableSession = null;
        recoveryCenter?.classList.add('hidden');
        showNotice('Session Discarded', 'The interrupted recording was discarded.');
      } catch (err: any) {
        showNotice('Discard Failed', err.message || 'Could not discard session.');
      } finally {
        discardRecoveryButton.disabled = false;
      }
    });
  }

  // Library Navigation (OCS-205)
  function openLibraryPage() {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    } else {
      window.open('library.html', '_blank');
    }
  }

  if (openLibraryBtn) {
    openLibraryBtn.addEventListener('click', openLibraryPage);
  }
  if (viewInLibraryBtn) {
    viewInLibraryBtn.addEventListener('click', openLibraryPage);
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
