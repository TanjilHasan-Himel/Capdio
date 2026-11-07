// apps/extension/src/background/session-registry.ts
// Capdio Source Session Registry & Manifest Persistence (MASTER_SPEC.md §02.5 & §02.8)

import type {
  SessionManifest,
  CaptureProfile,
  SourceInfo,
  RecordingSegment,
  RecordStatus,
  ErrorCode
} from '../shared/types.ts';

const SCHEMA_VERSION = 1;
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
   * Initializes and persists a new recording session manifest.
   */
  public async createSession(
    profile: CaptureProfile,
    sources: SourceInfo[] = []
  ): Promise<SessionManifest> {
    const sessionId = this.generateSessionId();
    const manifest: SessionManifest = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'idle',
      profile,
      sources,
      segments: []
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
    await this._persistSession(session);
    return session;
  }

  /**
   * Retrieves a session manifest by ID.
   */
  public async getSession(sessionId: string): Promise<SessionManifest | null> {
    if (this._activeSession && this._activeSession.sessionId === sessionId) {
      return this._activeSession;
    }

    // Check Chrome storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const key = `${STORAGE_PREFIX}${sessionId}`;
      const data = await chrome.storage.local.get(key);
      if (data && data[key]) {
        return data[key] as SessionManifest;
      }
    }

    return this._memoryStore.get(sessionId) || null;
  }

  /**
   * Lists all recorded session manifests in reverse chronological order.
   */
  public async listSessions(): Promise<SessionManifest[]> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const indexData = (await chrome.storage.local.get(INDEX_KEY)) as Record<string, string[]>;
      const sessionIds: string[] = Array.isArray(indexData[INDEX_KEY]) ? indexData[INDEX_KEY] : [];
      const keys = sessionIds.map(id => `${STORAGE_PREFIX}${id}`);
      const sessionsData = (await chrome.storage.local.get(keys)) as Record<string, unknown>;

      const sessions: SessionManifest[] = [];
      for (const id of sessionIds) {
        const item = sessionsData[`${STORAGE_PREFIX}${id}`];
        if (item) sessions.push(item as SessionManifest);
      }
      return sessions.reverse();
    }

    return Array.from(this._memoryStore.values()).reverse();
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
}
