// tests/unit/state-machine.test.js
// Unit tests for Capdio Recording State Machine & Session Registry (OCS-102)

import assert from 'assert';
import { RecordingStateMachine } from '../../apps/extension/src/background/state-machine.ts';
import { SessionRegistry } from '../../apps/extension/src/background/session-registry.ts';
import { MessageBusError } from '../../apps/extension/src/shared/message-bus.ts';

console.log('🧪 Running Capdio State Machine & Session Registry Unit Tests...\n');

// -------------------------------------------------------------
// Part 1: Recording State Machine Tests
// -------------------------------------------------------------
console.log('Test 1: FSM Initial State and Lifecycle Transitions');
const fsm = new RecordingStateMachine();
assert.strictEqual(fsm.currentStatus, 'idle', 'Initial state must be idle');
assert.strictEqual(fsm.isIdle(), true);
assert.strictEqual(fsm.isActive(), false);

// Transition: idle -> requesting_permission
fsm.requestStart('test-session-123');
assert.strictEqual(fsm.currentStatus, 'requesting_permission');
assert.strictEqual(fsm.activeSessionId, 'test-session-123');
assert.strictEqual(fsm.isActive(), true);

// Transition: requesting_permission -> preparing
fsm.markPreparing();
assert.strictEqual(fsm.currentStatus, 'preparing');

// Transition: preparing -> recording
fsm.markRecording();
assert.strictEqual(fsm.currentStatus, 'recording');
assert.strictEqual(fsm.isRecording(), true);

// Transition: recording -> paused
fsm.pause();
assert.strictEqual(fsm.currentStatus, 'paused');
assert.strictEqual(fsm.isPaused(), true);

// Transition: paused -> recording (resume)
fsm.resume();
assert.strictEqual(fsm.currentStatus, 'recording');

// Transition: recording -> finalizing (stop)
fsm.stop();
assert.strictEqual(fsm.currentStatus, 'finalizing');

// Transition: finalizing -> ready
fsm.markReady();
assert.strictEqual(fsm.currentStatus, 'ready');

// Transition: ready -> idle
fsm.reset();
assert.strictEqual(fsm.currentStatus, 'idle');
assert.strictEqual(fsm.activeSessionId, null);
console.log('✅ PASS: Complete standard lifecycle transitions succeed');

// Test 2: Invalid State Transitions & Conflict Rejection
console.log('\nTest 2: Invalid State Transitions & Conflict Rejection');
const conflictFsm = new RecordingStateMachine();
assert.throws(
  () => conflictFsm.transitionTo('paused'),
  (err) => err instanceof MessageBusError && err.code === 'E_SESSION_CONFLICT',
  'Must reject transition from idle to paused'
);

conflictFsm.requestStart('sess-active');
conflictFsm.markPreparing();
conflictFsm.markRecording();

assert.throws(
  () => conflictFsm.requestStart('sess-another'),
  (err) => err instanceof MessageBusError && err.code === 'E_SESSION_CONFLICT',
  'Must reject starting another session while recording is active'
);

assert.throws(
  () => conflictFsm.transitionTo('preparing'),
  (err) => err instanceof MessageBusError && err.code === 'E_SESSION_CONFLICT',
  'Must reject transitioning backwards from recording to preparing'
);
console.log('✅ PASS: Illegal transitions rejected with E_SESSION_CONFLICT');

// Test 3: Idempotency Guards
console.log('\nTest 3: Idempotency Guards');
const idempFsm = new RecordingStateMachine();
// Calling stop when already idle should be safe
idempFsm.stop();
assert.strictEqual(idempFsm.currentStatus, 'idle', 'Stop when idle is safe no-op');

idempFsm.requestStart('sess-idemp');
idempFsm.markPreparing();
idempFsm.markRecording();
idempFsm.pause();
// Calling pause when already paused should be safe no-op
idempFsm.pause();
assert.strictEqual(idempFsm.currentStatus, 'paused', 'Pause when paused is safe no-op');

idempFsm.resume();
// Calling resume when already recording should be safe no-op
idempFsm.resume();
assert.strictEqual(idempFsm.currentStatus, 'recording', 'Resume when recording is safe no-op');
console.log('✅ PASS: Idempotent operations behave safely without error');

// Test 4: Failure & Recovery Paths
console.log('\nTest 4: Interruption and Error Recovery');
const errorFsm = new RecordingStateMachine();
errorFsm.requestStart('sess-err');
errorFsm.markPreparing();
errorFsm.markRecording();

// Mark source interrupted
errorFsm.markInterrupted('Source tab was closed');
assert.strictEqual(errorFsm.currentStatus, 'interrupted');
errorFsm.reset();
assert.strictEqual(errorFsm.currentStatus, 'idle');

// Mark error
errorFsm.requestStart('sess-err-2');
errorFsm.markError('E_ENCODER_FAILED', 'Hardware encoder crashed');
assert.strictEqual(errorFsm.currentStatus, 'error');
assert.strictEqual(errorFsm.lastError?.code, 'E_ENCODER_FAILED');
errorFsm.reset();
assert.strictEqual(errorFsm.currentStatus, 'idle');
assert.strictEqual(errorFsm.lastError, null);
console.log('✅ PASS: Interrupted and Error failure paths handled safely');

// -------------------------------------------------------------
// Part 2: Session Registry Tests
// -------------------------------------------------------------
console.log('\nTest 5: Session Registry Manifest Management');
const registry = new SessionRegistry();

const profile = {
  width: 1920,
  height: 1080,
  fps: 30,
  mimePreference: 'webm',
  tabAudio: true,
  microphone: false
};

const session1 = await registry.createSession(profile);
assert.strictEqual(session1.schemaVersion, 1);
assert.ok(session1.sessionId && session1.sessionId.length > 5);
assert.strictEqual(session1.status, 'idle');
assert.strictEqual(session1.segments.length, 0);
assert.strictEqual(registry.activeSession?.sessionId, session1.sessionId);

// Add Source Info
await registry.addSource(session1.sessionId, {
  sourceId: 'tab_src_1',
  kind: 'tab',
  tabId: 101,
  displayLabel: 'Google Search Tab',
  authorizedAt: new Date().toISOString()
});

// Update Status
await registry.updateSessionStatus(session1.sessionId, 'recording');
assert.strictEqual(registry.activeSession?.status, 'recording');

// Add Segments
await registry.addSegment(session1.sessionId, {
  partId: 'part_001',
  sourceId: 'tab_src_1',
  startMs: 0,
  durationMs: 3000,
  bytes: 1054000
});

const fetched = await registry.getSession(session1.sessionId);
assert.strictEqual(fetched?.status, 'recording');
assert.strictEqual(fetched?.sources.length, 1);
assert.strictEqual(fetched?.sources[0]?.displayLabel, 'Google Search Tab');
assert.strictEqual(fetched?.segments.length, 1);
assert.strictEqual(fetched?.segments[0]?.bytes, 1054000);

// Create Second Session
const session2 = await registry.createSession(profile);
const sessionsList = await registry.listSessions();
assert.strictEqual(sessionsList.length, 2);
assert.strictEqual(sessionsList[0]?.sessionId, session2.sessionId, 'List must return reverse chronological order');

registry.clearActiveSession();
assert.strictEqual(registry.activeSession, null);
console.log('✅ PASS: Session Registry creates, updates, and persists manifests accurately');

console.log('\n=============================================');
console.log('🎉 ALL STATE MACHINE & REGISTRY TESTS PASSED!');
console.log('=============================================\n');
