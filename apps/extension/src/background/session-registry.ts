// apps/extension/src/background/session-registry.ts
// Capdio Source Session Registry & Manifest Persistence (MASTER_SPEC.md §02.5 & §02.8)
// Integrates Schema Version 2 and transparent upward migration (OCS-201)

import {
  CURRENT_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
  type CaptureProfile,
  type SourceInfo,
  type RecordingSegment,
  type RecordStatus,
  type ErrorCode
} from '../shared/types.ts';
import {
  migrateSessionManifest,
  sanitizeTitle,
  formatDefaultTitle
} from '../shared/manifest-migrator.ts';

const STORAGE_PREFIX = 'capdio_session_';
const INDEX_KEY = 'capdio_sessions_index';

export class SessionRegistry {
  private _activeSession: SessionManifest | null = null;
  private _memoryStore: Map<string, SessionManifest> = new Map();

  public get activeSession(): SessionManifest | null {
    return this._activeSession;
  }

  /**
   * Generates a new UUID v4 for the session.
   */
  public generateSessionId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Initializes and persists a new recording session manifest in Schema Version 2.
   */
  public async createSession(
    profile: CaptureProfile,
    sources: SourceInfo[] = [],
    customTitle?: string
  ): Promise<SessionManifest> {
    const sessionId = this.generateSessionId();
    const createdAt = new Date().toISOString();
    const primaryLabel = sources.length > 0 && sources[0] ? sources[0].displayLabel : undefined;
    const title = customTitle ? sanitizeTitle(customTitle) : formatDefaultTitle(createdAt, primaryLabel);

    const manifest: SessionManifest = {
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
      sessionId,
      createdAt,
      status: 'idle',
      profile,
      sources,
      segments: [],
      title,
      durationMs: 0,
      totalBytes: 0,
      storageBackend: 'memory',
      isRecoverable: false
    };

    this._activeSession = manifest;
    await this._persistSession(manifest);
    return manifest;
  }

  /**
   * Updates the status and optional error code of an active session.
   */
  public async updateSessionStatus(
    sessionId: string,
    status: RecordStatus,
    errorCode?: ErrorCode
  ): Promise<SessionManifest> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found in registry`);
    }

    session.status = status;
    if (errorCode) {
      session.errorCode = errorCode;
    }

    if (status === 'ready') {
      session.finalizedAt = new Date().toISOString();
      session.isRecoverable = false;
    } else if (status === 'recording' || status === 'paused' || status === 'interrupted') {
      session.isRecoverable = true;
    } else if (status === 'idle') {
      session.isRecoverable = false;
    }

    // Recalculate metrics
    this._recalculateMetrics(session);

    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      this._activeSession = session;
    }

    await this._persistSession(session);
    return session;
  }

  /**
   * Appends a recording segment metadata record to the session manifest.
   */
  public async addSegment(
    sessionId: string,
    segment: RecordingSegment
  ): Promise<SessionManifest> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found in registry`);
    }

    session.segments.push(segment);
    this._recalculateMetrics(session);

    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      this._activeSession = session;
    }

    await this._persistSession(session);
    return session;
  }

  /**
   * Updates or registers source metadata for a session.
   */
  public async addSource(
    sessionId: string,
    source: SourceInfo
  ): Promise<SessionManifest> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found in registry`);
    }

    session.sources.push(source);
    // If title was default, optionally update with source label
    if (!session.title || session.title.startsWith('Recording 20')) {
      session.title = formatDefaultTitle(session.createdAt, source.displayLabel);
    }

    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      this._activeSession = session;
    }

    await this._persistSession(session);
    return session;
  }

  /**
   * Updates user-editable metadata (e.g. title) for an existing session.
   */
  public async updateSessionMetadata(
    sessionId: string,
    updates: { title?: string }
  ): Promise<SessionManifest> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found in registry`);
    }

    if (typeof updates.title === 'string') {
      session.title = sanitizeTitle(updates.title);
    }

    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      this._activeSession = session;
    }

    await this._persistSession(session);
    return session;
  }

  /**
   * Retrieves a session manifest by ID, transparently applying schema migrations.
   */
  public async getSession(sessionId: string): Promise<SessionManifest | null> {
    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      return this._activeSession;
    }

    let rawManifest: unknown = null;

    // Check Chrome storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const key = `${STORAGE_PREFIX}${sessionId}`;
      const data = await chrome.storage.local.get(key);
      if (data && data[key]) {
        rawManifest = data[key];
      }
    }

    if (!rawManifest) {
      rawManifest = this._memoryStore.get(sessionId) || null;
    }

    if (!rawManifest) {
      return null;
    }

    // Apply schema migration
    const migrated = migrateSessionManifest(rawManifest);

    // If an upgrade occurred, save the upgraded schema back to storage
    const originalVersion = (rawManifest as any)?.schemaVersion || 0;
    if (originalVersion < CURRENT_MANIFEST_SCHEMA_VERSION) {
      await this._persistSession(migrated);
    }

    return migrated;
  }

  /**
   * Lists all recorded session manifests in reverse chronological order,
   * transparently migrating any legacy records.
   */
  public async listSessions(): Promise<SessionManifest[]> {
    const sessions: SessionManifest[] = [];

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const indexData = (await chrome.storage.local.get(INDEX_KEY)) as Record<string, string[]>;
      const sessionIds: string[] = Array.isArray(indexData[INDEX_KEY]) ? indexData[INDEX_KEY] : [];
      const keys = sessionIds.map(id => `${STORAGE_PREFIX}${id}`);
      const sessionsData = (await chrome.storage.local.get(keys)) as Record<string, unknown>;

      for (const id of sessionIds) {
        const raw = sessionsData[`${STORAGE_PREFIX}${id}`];
        if (raw) {
          try {
            const migrated = migrateSessionManifest(raw);
            const origVersion = (raw as any)?.schemaVersion || 0;
            if (origVersion < CURRENT_MANIFEST_SCHEMA_VERSION) {
              await this._persistSession(migrated);
            }
            sessions.push(migrated);
          } catch (err) {
            console.error(`[SessionRegistry] Failed to migrate session '${id}':`, err);
          }
        }
      }
    } else {
      for (const [id, raw] of this._memoryStore.entries()) {
        try {
          const migrated = migrateSessionManifest(raw);
          this._memoryStore.set(id, migrated);
          sessions.push(migrated);
        } catch (err) {
          console.error(`[SessionRegistry] Failed to migrate memory session '${id}':`, err);
        }
      }
    }

    // Sort newest first
    return sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Scans all stored sessions and transitions any unfinalized (recording/paused)
   * sessions to 'interrupted' with isRecoverable = true.
   * Call on extension startup or worker activation (OCS-204).
   */
  public async auditUnfinalizedSessions(): Promise<SessionManifest[]> {
    const all = await this.listSessions();
    const updated: SessionManifest[] = [];

    for (const session of all) {
      if (session.status === 'recording' || session.status === 'paused') {
        console.warn(`[SessionRegistry] Detected unfinalized session '${session.sessionId}' in state '${session.status}'. Transitioning to 'interrupted'.`);
        session.status = 'interrupted';
        session.isRecoverable = true;
        session.errorCode = 'E_RECOVERY_PARTIAL';
        await this._persistSession(session);
        updated.push(session);
      }
    }

    return updated;
  }

  /**
   * Returns all sessions currently eligible for crash recovery.
   */
  public async getRecoverableSessions(): Promise<SessionManifest[]> {
    await this.auditUnfinalizedSessions();
    const all = await this.listSessions();
    return all.filter(s => s.status === 'interrupted' && s.isRecoverable);
  }

  /**
   * Marks an interrupted session as recovered and ready for download/library view.
   */
  public async markSessionRecovered(
    sessionId: string,
    recoveredData?: { totalBytes?: number; durationMs?: number }
  ): Promise<SessionManifest> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    session.status = 'ready';
    session.isRecoverable = false;
    session.finalizedAt = new Date().toISOString();

    if (!session.title?.startsWith('[Partial]')) {
      session.title = `[Partial] ${session.title || 'Recording'}`;
    }

    if (typeof recoveredData?.totalBytes === 'number') {
      session.totalBytes = recoveredData.totalBytes;
    }
    if (typeof recoveredData?.durationMs === 'number') {
      session.durationMs = recoveredData.durationMs;
    }

    await this._persistSession(session);
    return session;
  }

  /**
   * Deletes a session manifest and its index entry from storage.
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    this._memoryStore.delete(sessionId);
    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      this._activeSession = null;
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const sessionKey = `${STORAGE_PREFIX}${sessionId}`;
      await chrome.storage.local.remove(sessionKey);

      // Update index
      const indexData = (await chrome.storage.local.get(INDEX_KEY)) as Record<string, string[]>;
      let sessionIds: string[] = Array.isArray(indexData[INDEX_KEY]) ? indexData[INDEX_KEY] : [];
      if (sessionIds.includes(sessionId)) {
        sessionIds = sessionIds.filter(id => id !== sessionId);
        await chrome.storage.local.set({ [INDEX_KEY]: sessionIds });
      }
    }

    return true;
  }

  /**
   * Clears the current active session reference.
   */
  public clearActiveSession(): void {
    this._activeSession = null;
  }

  /**
   * Internal persistence helper.
   */
  private async _persistSession(manifest: SessionManifest): Promise<void> {
    this._memoryStore.set(manifest.sessionId, manifest);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const sessionKey = `${STORAGE_PREFIX}${manifest.sessionId}`;
      await chrome.storage.local.set({ [sessionKey]: manifest });

      // Update index
      const indexData = (await chrome.storage.local.get(INDEX_KEY)) as Record<string, string[]>;
      const sessionIds: string[] = Array.isArray(indexData[INDEX_KEY]) ? indexData[INDEX_KEY] : [];
      if (!sessionIds.includes(manifest.sessionId)) {
        sessionIds.push(manifest.sessionId);
        await chrome.storage.local.set({ [INDEX_KEY]: sessionIds });
      }
    }
  }

  /**
   * Recalculates totalBytes and durationMs from manifest segments.
   */
  private _recalculateMetrics(session: SessionManifest): void {
    const segments = session.segments || [];
    session.totalBytes = segments.reduce((sum, seg) => sum + (seg.bytes || 0), 0);
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg) {
        session.durationMs = (lastSeg.startMs || 0) + (lastSeg.durationMs || 0);
      }
    }
  }
}
