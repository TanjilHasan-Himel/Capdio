// apps/extension/src/library/index.ts
// Capdio Local Library & Player Surface (OCS-205)
// Provides offline recording browsing, playback, title renaming, deletion, and file export.

import { sendTypedMessage } from '../shared/message-bus.ts';
import type { SessionManifest } from '../shared/types.ts';

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
    } catch (err: any) {
      console.error('[Capdio Library] Preview error:', err);
      if (previewDetails) {
        previewDetails.textContent = `Preview unavailable: ${err.message || 'Media not found'}`;
      }
    }
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
    getAllSessions: () => allSessions,
    getFilteredSessions: () => filteredSessions,
    getActivePreviewSessionId: () => activePreviewSessionId
  };
});

