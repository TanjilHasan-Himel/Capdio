// tests/unit/crash-recovery.test.js
// Unit tests for Capdio Crash Recovery & Interruption Auditing (OCS-204)

import assert from 'assert';
import { RecordingStateMachine } from '../../apps/extension/src/background/state-machine.ts';
import { SessionRegistry } from '../../apps/extension/src/background/session-registry.ts';

console.log('🧪 Running Capdio Crash Recovery & Interruption Unit Tests (OCS-204)...\n');

// -------------------------------------------------------------
// Test 1: FSM Interruption & Recovery Lifecycle Transitions
// -------------------------------------------------------------
console.log('Test 1: FSM Interruption & Recovery Lifecycle Transitions');
const fsm = new RecordingStateMachine();

// IDLE -> REQUESTING -> PREPARING -> RECORDING
fsm.requestStart('crash-sess-1');
fsm.markPreparing();
fsm.markRecording();
assert.strictEqual(fsm.currentStatus, 'recording');

// Mid-recording unexpected interruption
fsm.markInterrupted('Simulated browser crash');
assert.strictEqual(fsm.currentStatus, 'interrupted');
assert.strictEqual(fsm.isActive(), false);

// Recovering from interrupted directly transitions to READY
fsm.markRecovered('crash-sess-1');
assert.strictEqual(fsm.currentStatus, 'ready');
assert.strictEqual(fsm.activeSessionId, 'crash-sess-1');

// Reset to IDLE
fsm.reset();
assert.strictEqual(fsm.currentStatus, 'idle');
console.log('✅ PASS: FSM interrupted -> ready -> idle transition verified.');

// -------------------------------------------------------------
// Test 2: Auditing Abruptly Terminated Sessions in SessionRegistry
// -------------------------------------------------------------
console.log('\nTest 2: Auditing Abruptly Terminated Sessions in SessionRegistry');
const registry = new SessionRegistry();

// Create 3 sessions:
// 1. Properly finalized session (ready)
// 2. Crashed session 1 (left in recording state)
// 3. Crashed session 2 (left in paused state)
const sessionReady = await registry.createSession(
  { width: 1920, height: 1080, fps: 30, mimePreference: 'webm' },
  [{ sourceId: 'tab_1', kind: 'tab', displayLabel: 'Active Tab', authorizedAt: new Date().toISOString() }],
  'Completed Recording'
);
await registry.updateSessionStatus(sessionReady.sessionId, 'ready');

const sessionCrashed1 = await registry.createSession(
  { width: 1920, height: 1080, fps: 30, mimePreference: 'webm' },
  [{ sourceId: 'tab_2', kind: 'tab', displayLabel: 'Google Meet', authorizedAt: new Date().toISOString() }],
  'Google Meet Call'
);
await registry.updateSessionStatus(sessionCrashed1.sessionId, 'recording');

const sessionCrashed2 = await registry.createSession(
  { width: 1920, height: 1080, fps: 30, mimePreference: 'webm' },
  [{ sourceId: 'tab_3', kind: 'tab', displayLabel: 'Code Review', authorizedAt: new Date().toISOString() }],
  'Code Review Tab'
);
await registry.updateSessionStatus(sessionCrashed2.sessionId, 'paused');

// Run startup audit
const updated = await registry.auditUnfinalizedSessions();
assert.strictEqual(updated.length, 2, 'Must detect exactly 2 unfinalized crashed sessions');

// Verify session 1 updated
const s1 = await registry.getSession(sessionCrashed1.sessionId);
assert.strictEqual(s1?.status, 'interrupted');
assert.strictEqual(s1?.isRecoverable, true);
assert.strictEqual(s1?.errorCode, 'E_RECOVERY_PARTIAL');

// Verify session 2 updated
const s2 = await registry.getSession(sessionCrashed2.sessionId);
assert.strictEqual(s2?.status, 'interrupted');
assert.strictEqual(s2?.isRecoverable, true);
assert.strictEqual(s2?.errorCode, 'E_RECOVERY_PARTIAL');

// Verify ready session was not touched
const sReady = await registry.getSession(sessionReady.sessionId);
assert.strictEqual(sReady?.status, 'ready');
assert.strictEqual(sReady?.isRecoverable, false);

console.log('✅ PASS: Startup audit successfully detected and marked unfinalized sessions as interrupted/recoverable.');

// -------------------------------------------------------------
// Test 3: Listing Recoverable Sessions
// -------------------------------------------------------------
console.log('\nTest 3: Listing Recoverable Sessions');
const recoverableList = await registry.getRecoverableSessions();
assert.strictEqual(recoverableList.length, 2, 'Must return both recoverable sessions');
const ids = recoverableList.map(s => s.sessionId);
assert.ok(ids.includes(sessionCrashed1.sessionId));
assert.ok(ids.includes(sessionCrashed2.sessionId));
console.log('✅ PASS: getRecoverableSessions returns only interrupted recoverable sessions.');

// -------------------------------------------------------------
// Test 4: Marking Session Recovered & Title Prefixing
// -------------------------------------------------------------
console.log('\nTest 4: Marking Session Recovered & Title Prefixing');
const recovered = await registry.markSessionRecovered(sessionCrashed1.sessionId, {
  totalBytes: 4500000,
  durationMs: 45000
});

assert.strictEqual(recovered.status, 'ready');
assert.strictEqual(recovered.isRecoverable, false);
assert.strictEqual(recovered.totalBytes, 4500000);
assert.strictEqual(recovered.durationMs, 45000);
assert.ok(recovered.title?.startsWith('[Partial]'), 'Recovered title must have [Partial] prefix');
assert.ok(recovered.finalizedAt, 'Must set finalizedAt timestamp');

// Check that recoverable list now has only 1 left
const remainingRecoverable = await registry.getRecoverableSessions();
assert.strictEqual(remainingRecoverable.length, 1);
assert.strictEqual(remainingRecoverable[0]?.sessionId, sessionCrashed2.sessionId);

console.log(`✅ PASS: Session successfully marked recovered: title="${recovered.title}", status="${recovered.status}".`);

// -------------------------------------------------------------
// Test 5: Clean Discard of Interrupted Session
// -------------------------------------------------------------
console.log('\nTest 5: Clean Discard of Interrupted Session');
await registry.deleteSession(sessionCrashed2.sessionId);
const afterDiscard = await registry.getRecoverableSessions();
assert.strictEqual(afterDiscard.length, 0, 'No recoverable sessions should remain after discard');
const s2Check = await registry.getSession(sessionCrashed2.sessionId);
assert.strictEqual(s2Check, null, 'Discarded session must be removed from registry');
console.log('✅ PASS: Interrupted session cleanly discarded and purged.');

console.log('\n=============================================================');
console.log('🎉 ALL CRASH RECOVERY & INTERRUPTION UNIT TESTS PASSED!');
console.log('=============================================================');
