// apps/extension/src/shared/chunk-storage.ts
// Capdio Chunk Persistence & IndexedDB Storage Engine (OCS-202)
// Provides bounded-memory chunk streaming, transactional persistence,
// and finalized recording assembly for offline-first media management.

export interface PersistedChunk {
  sessionId: string;
  sequenceNumber: number;
  partId: string;
  timestamp: number;
  startMs: number;
  durationMs?: number;
  bytes: number;
  data: Blob | ArrayBuffer;
}

export interface FinalizedRecording {
  sessionId: string;
  mimeType: string;
  totalBytes: number;
  durationMs: number;
  blob: Blob;
  createdAt: string;
  finalizedAt: string;
}

const DB_NAME = 'capdio_recordings_db';
const DB_VERSION = 1;
const STORE_CHUNKS = 'chunks';
const STORE_FINALIZED = 'finalized_recordings';
const INDEX_SESSION = 'by_session';

export class ChunkStorageEngine {
  private _db: IDBDatabase | null = null;
  private _initPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initializes the IndexedDB database schema.
   */
  public async init(): Promise<IDBDatabase> {
    if (this._db) return this._db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not available in this environment'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        console.log(`[ChunkStorage] Upgrading IndexedDB from v${event.oldVersion} to v${event.newVersion}`);

        // 1. Chunks Store (stores individual slices during recording)
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const chunkStore = db.createObjectStore(STORE_CHUNKS, {
            keyPath: ['sessionId', 'sequenceNumber']
          });
          chunkStore.createIndex(INDEX_SESSION, 'sessionId', { unique: false });
        }

        // 2. Finalized Recordings Store (stores consolidated recordings)
        if (!db.objectStoreNames.contains(STORE_FINALIZED)) {
          db.createObjectStore(STORE_FINALIZED, { keyPath: 'sessionId' });
        }
      };

      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onerror = () => {
        console.error('[ChunkStorage] Failed to open IndexedDB:', request.error);
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    });

    return this._initPromise;
  }

  /**
   * Closes the active database connection.
   */
  public close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._initPromise = null;
    }
  }

  /**
   * Persists an incremental chunk slice to IndexedDB.
   */
  public async persistChunk(chunk: PersistedChunk): Promise<void> {
    const db = await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      const req = store.put(chunk);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to put chunk in IndexedDB'));
    });
  }

  /**
   * Retrieves all chunks for a session ordered by sequenceNumber.
   */
  public async getChunks(sessionId: string): Promise<PersistedChunk[]> {
    const db = await this.init();
    return new Promise<PersistedChunk[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_CHUNKS);
      const index = store.index(INDEX_SESSION);
      const req = index.getAll(sessionId);

      req.onsuccess = () => {
        const chunks = (req.result as PersistedChunk[]) || [];
        chunks.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
        resolve(chunks);
      };

      req.onerror = () => reject(req.error || new Error('Failed to get chunks from IndexedDB'));
    });
  }

  /**
   * Returns the count of chunks persisted for a session.
   */
  public async getChunkCount(sessionId: string): Promise<number> {
    const db = await this.init();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_CHUNKS);
      const index = store.index(INDEX_SESSION);
      const req = index.count(sessionId);

      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error || new Error('Failed to count chunks'));
    });
  }

  /**
   * Computes the total byte size of all persisted chunks for a session.
   */
  public async getTotalBytes(sessionId: string): Promise<number> {
    const chunks = await this.getChunks(sessionId);
    return chunks.reduce((acc, c) => acc + (c.bytes || 0), 0);
  }

  /**
   * Assembles chunks into a consolidated final Blob, saves to finalized store,
   * and optionally cleans up intermediate chunks to free space.
   */
  public async assembleAndSaveFinalized(
    sessionId: string,
    mimeType: string,
    cleanupChunks = false
  ): Promise<FinalizedRecording> {
    const chunks = await this.getChunks(sessionId);
    if (chunks.length === 0) {
      throw new Error(`Cannot assemble recording: no chunks found for session '${sessionId}'`);
    }

    const dataParts: (Blob | ArrayBuffer)[] = chunks.map(c => c.data);
    const finalBlob = new Blob(dataParts, { type: mimeType });

    let durationMs = 0;
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk) {
      durationMs = (lastChunk.startMs || 0) + (lastChunk.durationMs || 0);
    }

    const finalized: FinalizedRecording = {
      sessionId,
      mimeType,
      totalBytes: finalBlob.size,
      durationMs,
      blob: finalBlob,
      createdAt: new Date(chunks[0]?.timestamp || Date.now()).toISOString(),
      finalizedAt: new Date().toISOString()
    };

    const db = await this.init();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FINALIZED, 'readwrite');
      const store = tx.objectStore(STORE_FINALIZED);
      const req = store.put(finalized);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to save finalized recording'));
    });

    if (cleanupChunks) {
      await this.deleteChunks(sessionId);
    }

    return finalized;
  }

  /**
   * Retrieves a finalized recording by session ID.
   */
  public async getFinalizedRecording(sessionId: string): Promise<FinalizedRecording | null> {
    const db = await this.init();
    return new Promise<FinalizedRecording | null>((resolve, reject) => {
      const tx = db.transaction(STORE_FINALIZED, 'readonly');
      const store = tx.objectStore(STORE_FINALIZED);
      const req = store.get(sessionId);

      req.onsuccess = () => resolve((req.result as FinalizedRecording) || null);
      req.onerror = () => reject(req.error || new Error('Failed to get finalized recording'));
    });
  }

  /**
   * Deletes all intermediate chunks for a session.
   */
  public async deleteChunks(sessionId: string): Promise<void> {
    const db = await this.init();
    const chunks = await this.getChunks(sessionId);
    if (chunks.length === 0) return;

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      for (const c of chunks) {
        store.delete([c.sessionId, c.sequenceNumber]);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to delete chunks'));
    });
  }

  /**
   * Deletes all data for a session (both chunks and finalized recording).
   */
  public async deleteSessionData(sessionId: string): Promise<void> {
    const db = await this.init();
    await this.deleteChunks(sessionId);

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FINALIZED, 'readwrite');
      const store = tx.objectStore(STORE_FINALIZED);
      const req = store.delete(sessionId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to delete finalized recording'));
    });
  }
}

// Default singleton instance
export const chunkStorage = new ChunkStorageEngine();
