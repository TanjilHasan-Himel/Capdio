// tests/unit/chunk-storage.test.js
// Unit Test Suite for Chunk Storage Engine (OCS-202)

import assert from 'assert';
import { ChunkStorageEngine } from '../../apps/extension/src/shared/chunk-storage.ts';

console.log('🧪 Running Capdio Chunk Storage Engine Unit Tests (OCS-202)...');

// In-Memory IDB Mock for Node.js unit environment
class MockIDBRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = null;
    this.error = null;
  }
}

class MockIDBTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
    this.oncomplete = null;
    this.onerror = null;
  }

  objectStore(name) {
    return this.db._stores[name];
  }
}

class MockIDBIndex {
  constructor(store, indexName, keyPath) {
    this.store = store;
    this.indexName = indexName;
    this.keyPath = keyPath;
  }

  getAll(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const items = Array.from(this.store._data.values()).filter(item => item[this.keyPath] === key);
      req.result = items;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  count(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const count = Array.from(this.store._data.values()).filter(item => item[this.keyPath] === key).length;
      req.result = count;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

class MockIDBObjectStore {
  constructor(name, options) {
    this.name = name;
    this.keyPath = options.keyPath;
    this._data = new Map();
    this._indexes = {};
  }

  createIndex(name, keyPath, options) {
    const index = new MockIDBIndex(this, name, keyPath);
    this._indexes[name] = index;
    return index;
  }

  index(name) {
    return this._indexes[name];
  }

  put(value) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      let key;
      if (Array.isArray(this.keyPath)) {
        key = this.keyPath.map(k => value[k]).join('__');
      } else {
        key = value[this.keyPath];
      }
      this._data.set(key, value);
      req.result = key;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  get(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = this._data.get(key) || null;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  delete(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const keyStr = Array.isArray(key) ? key.join('__') : key;
      this._data.delete(keyStr);
      req.result = undefined;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._stores = {};
    this.objectStoreNames = {
      contains: (n) => !!this._stores[n]
    };
  }

  createObjectStore(name, options) {
    const store = new MockIDBObjectStore(name, options);
    this._stores[name] = store;
    return store;
  }

  transaction(storeNames, mode) {
    const tx = new MockIDBTransaction(this, storeNames, mode);
    setTimeout(() => {
      if (tx.oncomplete) tx.oncomplete();
    }, 10);
    return tx;
  }

  close() {}
}

const mockIndexedDB = {
  open(name, version) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const db = new MockIDBDatabase(name, version);
      if (req.onupgradeneeded) {
        req.result = db;
        req.onupgradeneeded({ oldVersion: 0, newVersion: version });
      }
      req.result = db;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
};

// Polyfill global environment for unit testing
globalThis.indexedDB = mockIndexedDB;
if (typeof Blob === 'undefined') {
  globalThis.Blob = class {
    constructor(parts = [], options = {}) {
      this.parts = parts;
      this.type = options.type || '';
      this.size = parts.reduce((acc, p) => acc + (p?.byteLength || p?.size || (typeof p === 'string' ? p.length : 0)), 0);
    }
  };
}

// ============================================================================
// Tests
// ============================================================================
async function runUnitTests() {
  const engine = new ChunkStorageEngine();

  // Test 1: Initialization
  console.log('Test 1: ChunkStorageEngine Initialization');
  const db = await engine.init();
  assert.ok(db, 'Database should be initialized');
  assert.ok(db.objectStoreNames.contains('chunks'), 'Chunks store created');
  assert.ok(db.objectStoreNames.contains('finalized_recordings'), 'Finalized store created');
  console.log('✅ PASS: IndexedDB database and object stores initialized successfully.');

  // Test 2: Persist Chunks in Sequence
  console.log('\nTest 2: Chunk Persistence & Indexing');
  const sessionId = 'test-sess-001';

  const chunk0 = {
    sessionId,
    sequenceNumber: 0,
    partId: 'part_0',
    timestamp: 1000,
    startMs: 0,
    durationMs: 250,
    bytes: 50000,
    data: new Uint8Array(50000).buffer
  };

  const chunk1 = {
    sessionId,
    sequenceNumber: 1,
    partId: 'part_1',
    timestamp: 1250,
    startMs: 250,
    durationMs: 250,
    bytes: 60000,
    data: new Uint8Array(60000).buffer
  };

  const chunk2 = {
    sessionId,
    sequenceNumber: 2,
    partId: 'part_2',
    timestamp: 1500,
    startMs: 500,
    durationMs: 250,
    bytes: 55000,
    data: new Uint8Array(55000).buffer
  };

  await engine.persistChunk(chunk0);
  await engine.persistChunk(chunk1);
  await engine.persistChunk(chunk2);

  const count = await engine.getChunkCount(sessionId);
  assert.strictEqual(count, 3, `Expected 3 chunks, got ${count}`);

  const totalBytes = await engine.getTotalBytes(sessionId);
  assert.strictEqual(totalBytes, 165000, `Expected 165000 bytes, got ${totalBytes}`);

  const retrievedChunks = await engine.getChunks(sessionId);
  assert.strictEqual(retrievedChunks.length, 3);
  assert.strictEqual(retrievedChunks[0].sequenceNumber, 0);
  assert.strictEqual(retrievedChunks[1].sequenceNumber, 1);
  assert.strictEqual(retrievedChunks[2].sequenceNumber, 2);
  console.log(`✅ PASS: 3 chunks persisted, ordered by sequence, total bytes = ${totalBytes}`);

  // Test 3: Assembly & Finalization
  console.log('\nTest 3: Finalized Recording Assembly & Persistence');
  const finalized = await engine.assembleAndSaveFinalized(sessionId, 'video/webm;codecs=vp9,opus');
  assert.strictEqual(finalized.sessionId, sessionId);
  assert.strictEqual(finalized.mimeType, 'video/webm;codecs=vp9,opus');
  assert.strictEqual(finalized.totalBytes, 165000);
  assert.strictEqual(finalized.durationMs, 750); // 500 + 250
  assert.ok(finalized.blob, 'Consolidated blob created');

  const retrievedFinal = await engine.getFinalizedRecording(sessionId);
  assert.ok(retrievedFinal, 'Finalized recording retrieved from store');
  assert.strictEqual(retrievedFinal?.totalBytes, 165000);
  assert.strictEqual(retrievedFinal?.durationMs, 750);
  console.log('✅ PASS: Consolidated recording assembled and retrieved from finalized store.');

  // Test 4: Chunk Cleanup & Session Deletion
  console.log('\nTest 4: Chunk Cleanup & Session Deletion');
  await engine.deleteChunks(sessionId);
  const countAfterDelete = await engine.getChunkCount(sessionId);
  assert.strictEqual(countAfterDelete, 0, 'Chunks should be removed after deleteChunks');

  // Finalized recording should still exist
  const stillFinalized = await engine.getFinalizedRecording(sessionId);
  assert.ok(stillFinalized, 'Finalized recording preserved when intermediate chunks deleted');

  // Full session deletion
  await engine.deleteSessionData(sessionId);
  const afterFullDelete = await engine.getFinalizedRecording(sessionId);
  assert.strictEqual(afterFullDelete, null, 'Finalized recording removed after deleteSessionData');
  console.log('✅ PASS: Chunks and finalized recordings cleanly purged on demand.');

  engine.close();
}

await runUnitTests();

console.log('\n=============================================================');
console.log('🎉 ALL CHUNK STORAGE ENGINE UNIT TESTS PASSED!');
console.log('=============================================================\n');
