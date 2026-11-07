// apps/extension/src/library/index.ts
// Capdio Local Library & Player Surface (OCS-205)
// Provides offline recording browsing, playback, title renaming, deletion, and file export.

import { sendTypedMessage } from '../shared/message-bus.ts';
import { type SessionManifest, validateTrimBounds } from '../shared/types.ts';

console.log('[Capdio Library] Initializing Local Library...');

interface LoadedMedia {
  sessionId: string;
  blobUrl: string;
  mimeType: string;
  totalBytes: number;
}

document.addEventListener('DOMContentLoaded', async () => {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const statusFilter = document.getElementById('statusFilter') as HTMLSelectElement;
  const sortOrder = document.getElementById('sortOrder') as HTMLSelectElement;
  const recordingCount = document.getElementById('recordingCount');
  const recordingsList = document.getElementById('recordingsList');
  const mainGrid = document.getElementById('mainGrid');
  const previewPanel = document.getElementById('previewPanel');
  const previewTitle = document.getElementById('previewTitle');
  const previewDetails = document.getElementById('previewDetails');
  const previewDownloadBtn = document.getElementById('previewDownloadBtn') as HTMLButtonElement;
  const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
  const closePreviewBtn = document.getElementById('closePreviewBtn');

  // Trim controls & indicators (OCS-303)
  const trimInInput = document.getElementById('trimInInput') as HTMLInputElement;
  const trimOutInput = document.getElementById('trimOutInput') as HTMLInputElement;
  const setTrimInBtn = document.getElementById('setTrimInBtn') as HTMLButtonElement;
  const setTrimOutBtn = document.getElementById('setTrimOutBtn') as HTMLButtonElement;
  const trimDurationLabel = document.getElementById('trimDurationLabel');
  const trimVisualRange = document.getElementById('trimVisualRange');
  const exportTrimBtn = document.getElementById('exportTrimBtn') as HTMLButtonElement;
  const trimProgressContainer = document.getElementById('trimProgressContainer');
  const trimProgressBar = document.getElementById('trimProgressBar');
  const trimProgressStatus = document.getElementById('trimProgressStatus');
  const trimProgressPercent = document.getElementById('trimProgressPercent');
  const trimErrorBanner = document.getElementById('trimErrorBanner');

  // Rename modal elements
  const renameModal = document.getElementById('renameModal');
  const renameInput = document.getElementById('renameInput') as HTMLInputElement;
  const cancelRenameBtn = document.getElementById('cancelRenameBtn');
  const saveRenameBtn = document.getElementById('saveRenameBtn') as HTMLButtonElement;

  let allSessions: SessionManifest[] = [];
  let filteredSessions: SessionManifest[] = [];
  let activePreviewSessionId: string | null = null;
  let activeLoadedMedia: LoadedMedia | null = null;
  let renameTargetSessionId: string | null = null;

  // Formatting helpers
  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(ms: number): string {
    if (!ms || ms === 0) return '00:00';
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
    const secs = (totalSecs % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function formatDate(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  function sanitizeFilename(title: string): string {
    return title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'recording';
  }

  // Load recording media blob
  async function loadRecordingBlob(sessionId: string): Promise<LoadedMedia> {
    if (activeLoadedMedia && activeLoadedMedia.sessionId === sessionId) {
      return activeLoadedMedia;
    }

    const res = await sendTypedMessage<any>('background', 'GET_RECORDING_DATA', { sessionId });
    if (!res.success || !res.data?.base64Data) {
      throw new Error(res.error || `Could not retrieve media for session '${sessionId}'`);
    }

    const mime = res.data.mimeType || 'video/webm';
    const byteChars = atob(res.data.base64Data);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mime });
    const blobUrl = URL.createObjectURL(blob);

    if (activeLoadedMedia) {
      URL.revokeObjectURL(activeLoadedMedia.blobUrl);
    }

    activeLoadedMedia = {
      sessionId,
      blobUrl,
      mimeType: mime,
      totalBytes: blob.size
    };

    return activeLoadedMedia;
  }

  // Open video preview panel
  async function openPreview(session: SessionManifest) {
    if (!videoPlayer || !previewPanel) return;

    try {
      activePreviewSessionId = session.sessionId;
      renderCards(); // update active card highlighting

      if (previewTitle) {
        previewTitle.textContent = session.title || 'Video Preview';
      }
      if (previewDetails) {
        previewDetails.textContent = 'Loading video stream from local storage...';
      }

      previewPanel.classList.remove('hidden');
      mainGrid?.classList.add('has-preview');

      const media = await loadRecordingBlob(session.sessionId);
      videoPlayer.src = media.blobUrl;
      await videoPlayer.play().catch(() => {});

      const isMp4 = media.mimeType.includes('mp4');
      const formatStr = isMp4 ? 'MP4 (H.264 / AAC)' : 'WebM (VP9 / Opus)';
      const sizeStr = formatBytes(media.totalBytes || session.totalBytes || 0);
      const durStr = formatDuration(session.durationMs || 0);

      const src = session.sources?.[0];
      const actualW = src?.actualWidth || session.profile?.width || 1920;
      const actualH = src?.actualHeight || session.profile?.height || 1080;
      const actualFps = src?.actualFps || session.profile?.fps || 30;
      const reqW = src?.requestedWidth || session.profile?.width;
      const reqH = src?.requestedHeight || session.profile?.height;
      const reqFps = src?.requestedFps || session.profile?.fps;
      const presetName = session.profile?.presetName;
      const isConstrained = reqW && (actualW < reqW || (reqH && actualH < reqH));
      const presetLabel = presetName ? `${presetName.toUpperCase()} ` : '';

      let qualitySummary = `Measured: ${actualW}×${actualH} @ ${actualFps} FPS`;
      if (isConstrained && reqW && reqH) {
        qualitySummary += ` (Display Constrained from ${presetLabel}${reqW}×${reqH} @ ${reqFps} FPS)`;
      } else if (presetName) {
        qualitySummary += ` (${presetLabel.trim()} Preset)`;
      }

      if (previewDetails) {
        previewDetails.textContent = `${formatStr} • ${qualitySummary} • ${durStr} • ${sizeStr}`;
      }
      if (previewDownloadBtn) {
        previewDownloadBtn.textContent = `Download ${isMp4 ? 'MP4' : 'WebM'} (${sizeStr})`;
      }

      // Initialize trim range based on duration (OCS-303)
      // NOTE: MediaRecorder WebM blobs report duration=Infinity since they lack a SeekHead.
      // Always prefer manifest durationMs; fall back to finite video.duration only if manifest is absent.
      const setupTrimRange = () => {
        const vidDur = videoPlayer?.duration;
        const isFiniteVideoDur = vidDur != null && !isNaN(vidDur) && isFinite(vidDur) && vidDur > 0;
        const manifestDurSec = session.durationMs ? session.durationMs / 1000 : 0;
        // Prefer manifest (always reliable) over Infinity from video element
        const totalDurationSec = manifestDurSec > 0 ? manifestDurSec : (isFiniteVideoDur ? vidDur : 0);

        const outStr = totalDurationSec > 0 ? totalDurationSec.toFixed(1) : '0.0';
        if (trimInInput) {
          trimInInput.value = '0.0';
          trimInInput.setAttribute('max', outStr);
        }
        if (trimOutInput) {
          trimOutInput.value = outStr;
          trimOutInput.setAttribute('max', outStr);
        }
        updateTrimUI();
      };

      // Always listen for loadedmetadata in case metadata arrives after play() is called
      videoPlayer.addEventListener('loadedmetadata', setupTrimRange, { once: true });

      // Also attempt immediately if metadata is already available (readyState >= HAVE_METADATA)
      if (videoPlayer.readyState >= 1) {
        setupTrimRange();
      }
    } catch (err: any) {
      console.error('[Capdio Library] Preview error:', err);
      if (previewDetails) {
        previewDetails.textContent = `Preview unavailable: ${err.message || 'Media not found'}`;
      }
    }
  }

  function getActiveTotalDuration(): number {
    const sess = allSessions.find(s => s.sessionId === activePreviewSessionId);
    if (videoPlayer && !isNaN(videoPlayer.duration) && isFinite(videoPlayer.duration) && videoPlayer.duration > 0) {
      return videoPlayer.duration;
    }
    if (sess?.durationMs && sess.durationMs > 0) {
      return sess.durationMs / 1000;
    }
    return 10.0;
  }

  function updateTrimUI() {
    if (!trimInInput || !trimOutInput) return;
    const totalDur = getActiveTotalDuration();
    const inVal = parseFloat(trimInInput.value);
    const outVal = parseFloat(trimOutInput.value);

    const validation = validateTrimBounds(inVal, outVal, totalDur);

    if (trimVisualRange) {
      if (!isNaN(inVal) && !isNaN(outVal) && totalDur > 0) {
        const safeIn = Math.max(0, Math.min(totalDur, inVal));
        const safeOut = Math.max(0, Math.min(totalDur, outVal));
        const leftPct = (Math.min(safeIn, safeOut) / totalDur) * 100;
        const widthPct = (Math.abs(safeOut - safeIn) / totalDur) * 100;
        trimVisualRange.style.left = `${leftPct.toFixed(1)}%`;
        trimVisualRange.style.width = `${widthPct.toFixed(1)}%`;
      }
    }

    if (!validation.valid) {
      if (trimErrorBanner) {
        trimErrorBanner.textContent = validation.error || 'Invalid trim range';
        trimErrorBanner.classList.remove('hidden');
      }
      if (trimDurationLabel) {
        trimDurationLabel.textContent = `${formatDuration((inVal || 0) * 1000)} - ${formatDuration((outVal || 0) * 1000)} (Invalid)`;
        trimDurationLabel.style.color = '#f87171';
      }
      if (exportTrimBtn) {
        exportTrimBtn.disabled = true;
        exportTrimBtn.style.opacity = '0.5';
        exportTrimBtn.style.cursor = 'not-allowed';
      }
    } else {
      if (trimErrorBanner) {
        trimErrorBanner.classList.add('hidden');
      }
      if (trimDurationLabel) {
        const durSec = validation.range!.durationSeconds;
        trimDurationLabel.textContent = `${formatDuration(validation.range!.inSeconds * 1000)} - ${formatDuration(validation.range!.outSeconds * 1000)} (${durSec.toFixed(1)}s)`;
        trimDurationLabel.style.color = '#60a5fa';
      }
      if (exportTrimBtn) {
        exportTrimBtn.disabled = false;
        exportTrimBtn.style.opacity = '1';
        exportTrimBtn.style.cursor = 'pointer';
      }
    }
  }

  if (setTrimInBtn) {
    setTrimInBtn.addEventListener('click', () => {
      if (trimInInput && videoPlayer) {
        trimInInput.value = Math.max(0, videoPlayer.currentTime).toFixed(1);
        updateTrimUI();
      }
    });
  }

  if (setTrimOutBtn) {
    setTrimOutBtn.addEventListener('click', () => {
      if (trimOutInput && videoPlayer) {
        const totalDur = getActiveTotalDuration();
        trimOutInput.value = Math.min(totalDur, videoPlayer.currentTime).toFixed(1);
        updateTrimUI();
      }
    });
  }

  trimInInput?.addEventListener('input', updateTrimUI);
  trimOutInput?.addEventListener('input', updateTrimUI);

  let isExportingTrim = false;

  async function exportTrimmedVideo(): Promise<{ success: boolean; filename?: string; sizeBytes?: number; error?: string }> {
    if (isExportingTrim) return { success: false, error: 'Export already in progress' };
    const sess = allSessions.find(s => s.sessionId === activePreviewSessionId);
    if (!sess) {
      alert('No active recording selected for trim export.');
      return { success: false, error: 'No active session' };
    }

    const totalDur = getActiveTotalDuration();
    const inVal = parseFloat(trimInInput?.value || '0');
    const outVal = parseFloat(trimOutInput?.value || '0');
    const validation = validateTrimBounds(inVal, outVal, totalDur);

    if (!validation.valid || !validation.range) {
      if (trimErrorBanner) {
        trimErrorBanner.textContent = validation.error || 'Please correct trim points before exporting.';
        trimErrorBanner.classList.remove('hidden');
      }
      return { success: false, error: validation.error };
    }

    const { inSeconds, outSeconds, durationSeconds } = validation.range;
    isExportingTrim = true;

    if (exportTrimBtn) {
      exportTrimBtn.disabled = true;
      exportTrimBtn.textContent = '⏳ Processing Video Slice...';
    }
    if (trimProgressContainer) trimProgressContainer.classList.remove('hidden');
    if (trimProgressBar) trimProgressBar.style.width = '0%';
    if (trimProgressPercent) trimProgressPercent.textContent = '0%';
    if (trimProgressStatus) trimProgressStatus.textContent = 'Preparing media stream...';
    if (trimErrorBanner) trimErrorBanner.classList.add('hidden');

    let sliceVideo: HTMLVideoElement | null = null;
    let recorder: MediaRecorder | null = null;
    let progressTimer: any = null;
    let timeoutGuard: any = null;

    try {
      const media = await loadRecordingBlob(sess.sessionId);

      // Create offscreen slice video element
      sliceVideo = document.createElement('video');
      sliceVideo.style.position = 'fixed';
      sliceVideo.style.top = '-9999px';
      sliceVideo.style.left = '-9999px';
      sliceVideo.style.width = '320px';
      sliceVideo.style.height = '180px';
      sliceVideo.muted = true;
      sliceVideo.playsInline = true;
      sliceVideo.src = media.blobUrl;
      document.body.appendChild(sliceVideo);

      await new Promise<void>((resolve, reject) => {
        if (!sliceVideo) return reject(new Error('Video element not found'));
        sliceVideo.onloadedmetadata = () => resolve();
        sliceVideo.onerror = () => reject(new Error('Failed to load video for slicing'));
        if (sliceVideo.readyState >= 1) resolve();
      });

      // Seek to inSeconds
      sliceVideo.currentTime = inSeconds;
      await new Promise<void>((resolve) => {
        if (!sliceVideo) return resolve();
        sliceVideo.onseeked = () => resolve();
        setTimeout(resolve, 300);
      });

      // Capture stream from slice video
      const stream: MediaStream = (sliceVideo as any).captureStream
        ? (sliceVideo as any).captureStream()
        : (sliceVideo as any).mozCaptureStream
        ? (sliceVideo as any).mozCaptureStream()
        : null;

      if (!stream) {
        throw new Error('Video stream capture is not supported in this browser.');
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : media.mimeType);

      recorder = new MediaRecorder(stream, { mimeType: mime });
      const recordedChunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      const exportPromise = new Promise<Blob>((resolve, reject) => {
        if (!recorder) return reject(new Error('Recorder not initialized'));
        recorder.onstop = () => {
          const finalBlob = new Blob(recordedChunks, { type: mime });
          resolve(finalBlob);
        };
        recorder.onerror = (e) => reject(new Error(`MediaRecorder error: ${(e as any).error?.message || 'Unknown'}`));
      });

      recorder.start(100);
      await sliceVideo.play().catch(e => console.warn('[Capdio Library] sliceVideo play warning:', e));

      if (trimProgressStatus) trimProgressStatus.textContent = 'Slicing video frames...';

      // Monitor playback progress
      await new Promise<void>((resolve) => {
        progressTimer = setInterval(() => {
          if (!sliceVideo) return;
          const current = sliceVideo.currentTime;
          const elapsed = Math.max(0, current - inSeconds);
          const pct = Math.min(99, Math.round((elapsed / durationSeconds) * 100));

          if (trimProgressBar) trimProgressBar.style.width = `${pct}%`;
          if (trimProgressPercent) trimProgressPercent.textContent = `${pct}%`;
          if (trimProgressStatus) trimProgressStatus.textContent = `Encoding slice (${pct}%)...`;

          if (current >= outSeconds || sliceVideo.ended) {
            clearInterval(progressTimer);
            resolve();
          }
        }, 100);

        // Safety guard: duration + 5s
        timeoutGuard = setTimeout(() => {
          clearInterval(progressTimer);
          resolve();
        }, Math.max(2000, (durationSeconds + 5) * 1000));
      });

      // Stop recorder and playback
      if (sliceVideo) sliceVideo.pause();
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }

      if (trimProgressStatus) trimProgressStatus.textContent = 'Packaging trimmed WebM file...';
      if (trimProgressBar) trimProgressBar.style.width = '100%';
      if (trimProgressPercent) trimProgressPercent.textContent = '100%';

      const trimmedBlob = await exportPromise;

      // Trigger automatic download
      const cleanName = sanitizeFilename(sess.title || `recording-${sess.sessionId}`);
      const filename = `${cleanName}-trim-${inSeconds.toFixed(1)}s-to-${outSeconds.toFixed(1)}s.webm`;

      const a = document.createElement('a');
      const exportUrl = URL.createObjectURL(trimmedBlob);
      a.href = exportUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(exportUrl), 15000);

      if (trimProgressStatus) trimProgressStatus.textContent = '✓ Trim exported successfully!';
      setTimeout(() => {
        if (trimProgressContainer) trimProgressContainer.classList.add('hidden');
      }, 3500);

      return { success: true, filename, sizeBytes: trimmedBlob.size };
    } catch (err: any) {
      console.error('[Capdio Library] Trim export failed:', err);
      if (trimProgressContainer) trimProgressContainer.classList.add('hidden');
      if (trimErrorBanner) {
        trimErrorBanner.textContent = `Export failed: ${err.message || 'Unknown export error'}`;
        trimErrorBanner.classList.remove('hidden');
      }
      return { success: false, error: err.message };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (timeoutGuard) clearTimeout(timeoutGuard);
      if (sliceVideo && sliceVideo.parentNode) {
        sliceVideo.pause();
        sliceVideo.removeAttribute('src');
        sliceVideo.parentNode.removeChild(sliceVideo);
      }
      isExportingTrim = false;
      if (exportTrimBtn) {
        exportTrimBtn.disabled = false;
        exportTrimBtn.textContent = '✂ Export Trimmed Video';
      }
      updateTrimUI();
    }
  }

  if (exportTrimBtn) {
    exportTrimBtn.addEventListener('click', () => {
      exportTrimmedVideo();
    });
  }

  function closePreview() {
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.removeAttribute('src');
      videoPlayer.load();
    }
    if (activeLoadedMedia) {
      URL.revokeObjectURL(activeLoadedMedia.blobUrl);
      activeLoadedMedia = null;
    }
    activePreviewSessionId = null;
    previewPanel?.classList.add('hidden');
    mainGrid?.classList.remove('has-preview');
    if (trimInInput) trimInInput.value = '0.0';
    if (trimOutInput) trimOutInput.value = '0.0';
    if (trimProgressContainer) trimProgressContainer.classList.add('hidden');
    if (trimErrorBanner) trimErrorBanner.classList.add('hidden');
    if (trimVisualRange) {
      trimVisualRange.style.left = '0%';
      trimVisualRange.style.width = '100%';
    }
    renderCards();
  }

  if (closePreviewBtn) {
    closePreviewBtn.addEventListener('click', closePreview);
  }

  // Download / Export recording
  async function exportRecording(session: SessionManifest) {
    try {
      const media = await loadRecordingBlob(session.sessionId);
      const isMp4 = media.mimeType.includes('mp4');
      const ext = isMp4 ? 'mp4' : 'webm';
      const cleanName = sanitizeFilename(session.title || `recording-${session.sessionId}`);

      const a = document.createElement('a');
      a.href = media.blobUrl;
      a.download = `${cleanName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Export failed: ${err.message || 'Could not export file'}`);
    }
  }

  if (previewDownloadBtn) {
    previewDownloadBtn.addEventListener('click', () => {
      const sess = allSessions.find(s => s.sessionId === activePreviewSessionId);
      if (sess) {
        exportRecording(sess);
      }
    });
  }

  // Delete recording
  async function deleteSession(session: SessionManifest) {
    const confirmMsg = `Are you sure you want to delete "${session.title || 'this recording'}"? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      if (activePreviewSessionId === session.sessionId) {
        closePreview();
      }

      await sendTypedMessage('background', 'DELETE_RECORDING_DATA', { sessionId: session.sessionId });
      await sendTypedMessage('background', 'DELETE_SESSION', { sessionId: session.sessionId });

      allSessions = allSessions.filter(s => s.sessionId !== session.sessionId);
      applyFiltersAndRender();
    } catch (err: any) {
      alert(`Deletion failed: ${err.message || 'Could not delete session'}`);
    }
  }

  // Rename recording
  function openRenameModal(session: SessionManifest) {
    renameTargetSessionId = session.sessionId;
    if (renameInput) {
      renameInput.value = session.title || '';
    }
    renameModal?.classList.remove('hidden');
    renameInput?.focus();
  }

  function closeRenameModal() {
    renameTargetSessionId = null;
    renameModal?.classList.add('hidden');
  }

  if (cancelRenameBtn) {
    cancelRenameBtn.addEventListener('click', closeRenameModal);
  }

  if (saveRenameBtn) {
    saveRenameBtn.addEventListener('click', async () => {
      if (!renameTargetSessionId || !renameInput) return;
      const newTitle = renameInput.value.trim();
      if (!newTitle) return;

      saveRenameBtn.disabled = true;
      saveRenameBtn.textContent = 'Saving...';

      try {
        const res = await sendTypedMessage<any>('background', 'UPDATE_SESSION_METADATA', {
          sessionId: renameTargetSessionId,
          title: newTitle
        });

        const updatedSession = res.data?.session || res.data;
        if (res.success && updatedSession) {
          const idx = allSessions.findIndex(s => s.sessionId === renameTargetSessionId);
          if (idx !== -1) {
            allSessions[idx] = updatedSession;
          }
          if (activePreviewSessionId === renameTargetSessionId && previewTitle) {
            previewTitle.textContent = updatedSession.title;
          }
          closeRenameModal();
          applyFiltersAndRender();
        } else {
          alert('Could not update title');
        }
      } catch (err: any) {
        alert(`Rename error: ${err.message}`);
      } finally {
        saveRenameBtn.disabled = false;
        saveRenameBtn.textContent = 'Save Title';
      }
    });
  }

  // Render cards
  function renderCards() {
    if (!recordingsList) return;

    if (filteredSessions.length === 0) {
      recordingsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <div class="empty-title">No recordings found</div>
          <div class="empty-subtitle">Record a tab or screen with the Capdio extension to build your local library.</div>
        </div>
      `;
      if (recordingCount) recordingCount.textContent = '0 recordings';
      return;
    }

    if (recordingCount) {
      recordingCount.textContent = `${filteredSessions.length} recording${filteredSessions.length === 1 ? '' : 's'}`;
    }

    recordingsList.innerHTML = '';

    for (const session of filteredSessions) {
      const card = document.createElement('div');
      card.className = 'recording-card';
      card.dataset.sessionId = session.sessionId;
      if (session.sessionId === activePreviewSessionId) {
        card.classList.add('active-preview');
      }

      const isPartial = session.status === 'interrupted' || session.title?.startsWith('[Partial]');
      const formatStr = session.profile?.mimePreference === 'mp4' ? 'MP4' : 'WEBM';
      const sizeStr = formatBytes(session.totalBytes || 0);
      const durStr = formatDuration(session.durationMs || 0);
      const dateStr = formatDate(session.createdAt);
      const sourceLabel = session.sources?.[0]?.displayLabel || 'Captured Source';

      const src = session.sources?.[0];
      const actualW = src?.actualWidth || session.profile?.width || 1920;
      const actualH = src?.actualHeight || session.profile?.height || 1080;
      const actualFps = src?.actualFps || session.profile?.fps || 30;
      const reqW = src?.requestedWidth || session.profile?.width;
      const reqH = src?.requestedHeight || session.profile?.height;
      const reqFps = src?.requestedFps || session.profile?.fps;
      const presetName = session.profile?.presetName;
      const isConstrained = reqW && (actualW < reqW || (reqH && actualH < reqH));

      const presetBadgeHtml = presetName ? `
        <span class="preset-badge" style="display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: ${isConstrained ? 'rgba(245, 158, 11, 0.15)' : '#0f172a'}; border: 1px solid ${isConstrained ? 'rgba(245, 158, 11, 0.4)' : '#334155'}; color: ${isConstrained ? '#fbbf24' : '#94a3b8'}; text-transform: uppercase;">
          ${presetName}${isConstrained ? ' (Constrained)' : ''}
        </span>
      ` : '';

      card.innerHTML = `
        <div>
          <div class="card-top">
            <div class="card-title-group">
              <h2 class="card-title">${session.title || 'Untitled Recording'}</h2>
              <div class="card-date">${dateStr} • ${sourceLabel}</div>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${presetBadgeHtml}
              <span class="format-badge ${isPartial ? 'partial' : ''}">${isPartial ? 'Partial' : formatStr}</span>
            </div>
          </div>

          <div class="card-metrics">
            <div class="metric-item">
              <span class="metric-label">Duration:</span>
              <span class="metric-value">${durStr}</span>
            </div>
            <div class="metric-item">
              <span class="metric-label">Size:</span>
              <span class="metric-value">${sizeStr}</span>
            </div>
            <div class="metric-item">
              <span class="metric-label">Quality:</span>
              <span class="metric-value" title="${isConstrained ? `Requested ${reqW}×${reqH} @ ${reqFps}fps, display constrained to ${actualW}×${actualH} @ ${actualFps}fps` : `Measured: ${actualW}×${actualH} @ ${actualFps}fps`}">${actualH}p @ ${actualFps}fps${isConstrained ? ' ⚠️' : ''}</span>
            </div>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn-preview" aria-label="Preview recording">▶ Preview</button>
          <button class="btn-download" aria-label="Download recording">⬇ Download</button>
          <button class="btn-rename" aria-label="Rename recording">✏ Rename</button>
          <button class="btn-delete" aria-label="Delete recording">🗑</button>
        </div>
      `;

      // Wire button listeners
      const previewBtn = card.querySelector('.btn-preview');
      const downloadBtn = card.querySelector('.btn-download');
      const renameBtn = card.querySelector('.btn-rename');
      const deleteBtn = card.querySelector('.btn-delete');

      previewBtn?.addEventListener('click', () => openPreview(session));
      downloadBtn?.addEventListener('click', () => exportRecording(session));
      renameBtn?.addEventListener('click', () => openRenameModal(session));
      deleteBtn?.addEventListener('click', () => deleteSession(session));

      recordingsList.appendChild(card);
    }
  }

  // Filter & Sort
  function applyFiltersAndRender() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const status = statusFilter ? statusFilter.value : 'all';
    const sort = sortOrder ? sortOrder.value : 'newest';

    filteredSessions = allSessions.filter(s => {
      // Search
      const matchesSearch =
        !query ||
        (s.title && s.title.toLowerCase().includes(query)) ||
        s.sessionId.toLowerCase().includes(query);

      // Status
      let matchesStatus = true;
      if (status === 'ready') {
        matchesStatus = s.status === 'ready' && !s.title?.startsWith('[Partial]');
      } else if (status === 'interrupted') {
        matchesStatus = s.status === 'interrupted' || !!s.title?.startsWith('[Partial]');
      }

      return matchesSearch && matchesStatus;
    });

    // Sort
    filteredSessions.sort((a, b) => {
      if (sort === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sort === 'largest') {
        return (b.totalBytes || 0) - (a.totalBytes || 0);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    renderCards();
  }

  searchInput?.addEventListener('input', applyFiltersAndRender);
  statusFilter?.addEventListener('change', applyFiltersAndRender);
  sortOrder?.addEventListener('change', applyFiltersAndRender);

  // Fetch all sessions from background service worker
  async function loadSessions() {
    try {
      const res = await sendTypedMessage<any>('background', 'LIST_SESSIONS');
      if (res.success && res.data) {
        if (Array.isArray(res.data)) {
          allSessions = res.data;
        } else if (Array.isArray(res.data.sessions)) {
          allSessions = res.data.sessions;
        } else {
          allSessions = [];
        }
      } else {
        allSessions = [];
      }
      applyFiltersAndRender();
    } catch (err) {
      console.error('[Capdio Library] Failed to load sessions:', err);
      if (recordingsList) {
        recordingsList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <div class="empty-title">Could not load recordings</div>
            <div class="empty-subtitle">Service Worker did not respond. Please reopen the library.</div>
          </div>
        `;
      }
    }
  }

  await loadSessions();

  // Expose diagnostics on window for automated test assertions
  (window as any).__capdio_library = {
    loadSessions,
    openPreview,
    closePreview,
    exportRecording,
    deleteSession,
    exportTrimmedVideo,
    updateTrimUI,
    getTrimState: () => {
      const inVal = parseFloat(trimInInput?.value || '0');
      const outVal = parseFloat(trimOutInput?.value || '0');
      const total = getActiveTotalDuration();
      return {
        inSec: inVal,
        outSec: outVal,
        totalDuration: total,
        validation: validateTrimBounds(inVal, outVal, total)
      };
    },
    getAllSessions: () => allSessions,
    getFilteredSessions: () => filteredSessions,
    getActivePreviewSessionId: () => activePreviewSessionId
  };
});

