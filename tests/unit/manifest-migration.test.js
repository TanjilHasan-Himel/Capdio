// tests/unit/manifest-migration.test.js
// Unit Test Suite for Session Manifest Schema & Migration Strategy (OCS-201)

import assert from 'assert';
import {
  sanitizeTitle,
  formatDefaultTitle,
  validateSessionManifest,
  migrateV0ToV1,
  migrateV1ToV2,
  migrateSessionManifest
} from '../../apps/extension/src/shared/manifest-migrator.ts';
import { SessionRegistry } from '../../apps/extension/src/background/session-registry.ts';
import { CURRENT_MANIFEST_SCHEMA_VERSION } from '../../apps/extension/src/shared/types.ts';

console.log('🧪 Running Capdio Manifest Schema & Migration Strategy Unit Tests (OCS-201)...');

// ============================================================================
// Test 1: Title Sanitization & Safe Formatting
// ============================================================================
console.log('\nTest 1: Title Sanitization & Default Formatting');

const testCases = [
  {
    input: '<script>alert("xss")</script> My Meeting',
    expected: 'alert(-xss-) My Meeting',
    desc: 'Strips HTML script tags and filesystem reserved quotes'
  },
  {
    input: '../../../../etc/passwd',
    expected: 'etc-passwd',
    desc: 'Neutralizes directory traversal and slashes'
  },
  {
    input: 'Recording: "Q3 Review" *Final*?',
    expected: 'Recording- -Q3 Review- -Final',
    desc: 'Replaces illegal filesystem chars with hyphens and trims trailing separators'
  },
  {
    input: '   Multiple    Spaces    Here   ',
    expected: 'Multiple Spaces Here',
    desc: 'Collapses extraneous whitespace'
  },
  {
    input: 'A'.repeat(150),
    expected: 'A'.repeat(100),
    desc: 'Truncates titles exceeding 100 characters'
  },
  {
    input: '',
    expected: 'Untitled Recording',
    desc: 'Falls back on empty string'
  }
];

for (const tc of testCases) {
  const result = sanitizeTitle(tc.input);
  assert.strictEqual(result, tc.expected, `Failed: ${tc.desc}`);
}
console.log('✅ PASS: Title sanitization correctly neutralizes injections, traversals, and bounds length.');

const defaultTitle1 = formatDefaultTitle('2026-11-07T10:30:00.000Z', 'Google Meet');
assert(defaultTitle1.includes('Google Meet'), 'Title should include displayLabel');
assert(defaultTitle1.includes('2026-11-07'), 'Title should include formatted date');
console.log(`✅ PASS: formatDefaultTitle generated: "${defaultTitle1}"`);

// ============================================================================
// Test 2: Structural Validation of SessionManifest
// ============================================================================
console.log('\nTest 2: Structural Validation of SessionManifest');

const validV2Manifest = {
  schemaVersion: 2,
  sessionId: 'test-session-uuid-1234',
  createdAt: '2026-11-07T10:00:00.000Z',
  status: 'ready',
  profile: {
    width: 1920,
    height: 1080,
    fps: 30,
    mimePreference: 'webm',
    tabAudio: true,
    microphone: true
  },
  sources: [
    {
      sourceId: 'src_1',
      kind: 'tab',
      displayLabel: 'Chrome Tab',
      authorizedAt: '2026-11-07T10:00:01.000Z'
    }
  ],
  segments: [
    {
      partId: 'part_0',
      sourceId: 'src_1',
      startMs: 0,
      durationMs: 5000,
      bytes: 250000
    }
  ],
  title: 'Test Session',
  durationMs: 5000,
  totalBytes: 250000,
  storageBackend: 'memory',
  isRecoverable: false
};

const validRes = validateSessionManifest(validV2Manifest);
assert.strictEqual(validRes.valid, true, `Expected valid manifest, got errors: ${validRes.errors?.join(', ')}`);
console.log('✅ PASS: Valid Schema V2 manifest passed validation without errors.');

// Negative checks
const invalid1 = validateSessionManifest(null);
assert.strictEqual(invalid1.valid, false);

const invalid2 = validateSessionManifest({ ...validV2Manifest, schemaVersion: 0 });
assert.strictEqual(invalid2.valid, false);
assert(invalid2.errors.some(e => e.includes('schemaVersion')));

const invalid3 = validateSessionManifest({ ...validV2Manifest, status: 'unknown_status' });
assert.strictEqual(invalid3.valid, false);
assert(invalid3.errors.some(e => e.includes('status')));

const invalid4 = validateSessionManifest({ ...validV2Manifest, profile: { width: -10 } });
assert.strictEqual(invalid4.valid, false);
console.log('✅ PASS: Structural validator rejected malformed schema versions, statuses, and profiles.');

// ============================================================================
// Test 3: Legacy Schema V0 to V1 Migration
// ============================================================================
console.log('\nTest 3: Legacy Schema V0 to V1 Migration');

const legacyV0 = {
  sessionId: 'legacy-sess-001',
  createdAt: '2026-11-06T15:20:00.000Z',
  status: 'ready',
  profile: {
    width: 1280,
    height: 720,
    fps: 30
    // missing mimePreference, tabAudio, microphone
  },
  sources: [],
  segments: []
};

const migratedV1 = migrateV0ToV1(legacyV0);
assert.strictEqual(migratedV1.schemaVersion, 1);
assert.strictEqual(migratedV1.sessionId, 'legacy-sess-001');
assert.strictEqual(migratedV1.profile.mimePreference, 'webm');
assert.strictEqual(migratedV1.profile.tabAudio, true);
assert.strictEqual(migratedV1.profile.microphone, false);
console.log('✅ PASS: Unversioned legacy V0 manifest cleanly normalized to V1 with safe defaults.');

// ============================================================================
// Test 4: Schema V1 to V2 Migration
// ============================================================================
console.log('\nTest 4: Schema V1 to V2 Migration');

const standardV1 = {
  schemaVersion: 1,
  sessionId: 'v1-sess-002',
  createdAt: '2026-11-07T08:00:00.000Z',
  status: 'interrupted',
  profile: {
    width: 1920,
    height: 1080,
    fps: 30,
    mimePreference: 'webm',
    tabAudio: true,
    microphone: true
  },
  sources: [
    {
      sourceId: 'src_tab',
      kind: 'tab',
      displayLabel: 'Dashboard Tab',
      authorizedAt: '2026-11-07T08:00:01.000Z'
    }
  ],
  segments: [
    { partId: 'part_0', sourceId: 'src_tab', startMs: 0, durationMs: 2500, bytes: 100000 },
    { partId: 'part_1', sourceId: 'src_tab', startMs: 2500, durationMs: 2500, bytes: 120000 }
  ]
};

const migratedV2 = migrateV1ToV2(standardV1);
assert.strictEqual(migratedV2.schemaVersion, 2);
assert.strictEqual(migratedV2.totalBytes, 220000, `Expected totalBytes=220000, got ${migratedV2.totalBytes}`);
assert.strictEqual(migratedV2.durationMs, 5000, `Expected durationMs=5000, got ${migratedV2.durationMs}`);
assert(migratedV2.title?.includes('Dashboard Tab'), 'Expected title to derive from primary source label');
assert.strictEqual(migratedV2.isRecoverable, true, 'Interrupted session with segments must be marked isRecoverable=true');
assert.strictEqual(migratedV2.storageBackend, 'memory');
console.log('✅ PASS: Schema V1 successfully migrated to V2 with accurate metric rollups and recoverability.');

// Ready session check
const readyV1 = { ...standardV1, status: 'ready' };
const readyV2 = migrateV1ToV2(readyV1);
assert.strictEqual(readyV2.isRecoverable, false, 'Finalized ready session must not be marked recoverable');
assert.strictEqual(typeof readyV2.finalizedAt, 'string');
console.log('✅ PASS: Ready session finalized timestamp and non-recoverable flag verified.');

// ============================================================================
// Test 5: End-to-End Multi-Step Migration (V0 -> V1 -> V2 Pipeline)
// ============================================================================
console.log('\nTest 5: End-to-End Multi-Step Migration Pipeline');

const rawOldRecord = {
  sessionId: 'ancient-001',
  status: 'recording',
  segments: [
    { partId: 'seg_1', sourceId: 'src_1', startMs: 0, durationMs: 1000, bytes: 50000 }
  ]
};

const fullMigrated = migrateSessionManifest(rawOldRecord);
assert.strictEqual(fullMigrated.schemaVersion, CURRENT_MANIFEST_SCHEMA_VERSION);
assert.strictEqual(fullMigrated.totalBytes, 50000);
assert.strictEqual(fullMigrated.durationMs, 1000);
assert.strictEqual(fullMigrated.isRecoverable, true);
assert(typeof fullMigrated.title === 'string');

// Idempotency: Running on already migrated object produces same result
const reMigrated = migrateSessionManifest(fullMigrated);
assert.strictEqual(reMigrated.schemaVersion, CURRENT_MANIFEST_SCHEMA_VERSION);
assert.strictEqual(reMigrated.totalBytes, 50000);
console.log('✅ PASS: End-to-end multi-step migration executed seamlessly and is strictly idempotent.');

// ============================================================================
// Test 6: SessionRegistry Manifest Management & Auto-Migration
// ============================================================================
console.log('\nTest 6: SessionRegistry Operations in Schema V2');

async function testSessionRegistry() {
  const registry = new SessionRegistry();

  // 1. Create Session
  const profile = {
    width: 1920,
    height: 1080,
    fps: 30,
    mimePreference: 'webm',
    tabAudio: true,
    microphone: true
  };
  const session = await registry.createSession(profile, [
    { sourceId: 'src_test', kind: 'tab', displayLabel: 'My Web App', authorizedAt: new Date().toISOString() }
  ], '<img src=x onerror=alert(1)> Custom Title');

  assert.strictEqual(session.schemaVersion, 2);
  assert.strictEqual(session.title, 'Custom Title', 'Title should be sanitized upon creation');
  assert.strictEqual(session.totalBytes, 0);
  assert.strictEqual(session.durationMs, 0);

  // 2. Add segments and verify automated metric aggregation
  await registry.addSegment(session.sessionId, {
    partId: 'p0',
    sourceId: 'src_test',
    startMs: 0,
    durationMs: 3000,
    bytes: 150000
  });

  await registry.addSegment(session.sessionId, {
    partId: 'p1',
    sourceId: 'src_test',
    startMs: 3000,
    durationMs: 3000,
    bytes: 180000
  });

  const updatedSession = await registry.getSession(session.sessionId);
  assert.strictEqual(updatedSession?.totalBytes, 330000);
  assert.strictEqual(updatedSession?.durationMs, 6000);
  console.log(`✅ PASS: Automated metric recalculation: totalBytes=${updatedSession?.totalBytes}, durationMs=${updatedSession?.durationMs}`);

  // 3. Update session metadata (rename)
  const renamedSession = await registry.updateSessionMetadata(session.sessionId, {
    title: '<b>Renamed Meeting</b>'
  });
  assert.strictEqual(renamedSession.title, 'Renamed Meeting');
  console.log('✅ PASS: Session title safely updated and sanitized in registry.');

  // 4. Update status to ready
  await registry.updateSessionStatus(session.sessionId, 'ready');
  const readySession = await registry.getSession(session.sessionId);
  assert.strictEqual(readySession?.status, 'ready');
  assert.strictEqual(typeof readySession?.finalizedAt, 'string');
  assert.strictEqual(readySession?.isRecoverable, false);

  // 5. Test auto-migration of legacy item in memory store
  const legacyInStore = {
    schemaVersion: 1,
    sessionId: 'legacy-mem-session',
    createdAt: new Date().toISOString(),
    status: 'ready',
    profile,
    sources: [],
    segments: [{ partId: 'p_leg', sourceId: 'src_1', startMs: 0, durationMs: 4000, bytes: 200000 }]
  };
  registry._memoryStore.set('legacy-mem-session', legacyInStore);

  const autoMigrated = await registry.getSession('legacy-mem-session');
  assert.strictEqual(autoMigrated?.schemaVersion, 2);
  assert.strictEqual(autoMigrated?.totalBytes, 200000);
  assert.strictEqual(autoMigrated?.durationMs, 4000);
  console.log('✅ PASS: Legacy session in storage automatically migrated upon retrieval.');

  // 6. Delete session
  const deleted = await registry.deleteSession(session.sessionId);
  assert.strictEqual(deleted, true);
  const afterDelete = await registry.getSession(session.sessionId);
  assert.strictEqual(afterDelete, null);
  console.log('✅ PASS: Session successfully deleted from registry.');
}

await testSessionRegistry();

console.log('\n=============================================================');
console.log('🎉 ALL MANIFEST SCHEMA & MIGRATION UNIT TESTS PASSED!');
console.log('=============================================================\n');
