// tests/unit/library-management.test.js
// Unit tests for Capdio Local Library Management (OCS-205)

import assert from 'assert';
import { SessionRegistry } from '../../apps/extension/src/background/session-registry.ts';

console.log('🧪 Running Capdio Local Library Management Unit Tests (OCS-205)...\n');

const registry = new SessionRegistry();

// -------------------------------------------------------------
// Test 1: Populate Sample Sessions
// -------------------------------------------------------------
console.log('Test 1: Populate Sample Sessions');

const s1 = await registry.createSession(
  { width: 1920, height: 1080, fps: 30, mimePreference: 'webm' },
  [{ sourceId: 'src_1', kind: 'tab', displayLabel: 'GitHub PR #42', authorizedAt: new Date(Date.now() - 60000).toISOString() }],
  'GitHub Code Review PR 42'
);
await registry.updateSessionStatus(s1.sessionId, 'ready');

const s2 = await registry.createSession(
  { width: 3840, height: 2160, fps: 60, mimePreference: 'webm' },
  [{ sourceId: 'src_2', kind: 'screen', displayLabel: 'Entire Screen', authorizedAt: new Date(Date.now() - 30000).toISOString() }],
  'Product Demo 4K UHD'
);
await registry.updateSessionStatus(s2.sessionId, 'ready');

const s3 = await registry.createSession(
  { width: 1280, height: 720, fps: 30, mimePreference: 'webm' },
  [{ sourceId: 'src_3', kind: 'tab', displayLabel: 'Google Meet', authorizedAt: new Date().toISOString() }],
  'Team Standup Call'
);
await registry.updateSessionStatus(s3.sessionId, 'interrupted');

const all = await registry.listSessions();
assert.strictEqual(all.length, 3, 'Must have 3 sessions registered');
console.log(`✅ PASS: 3 sample sessions populated in registry.`);

// -------------------------------------------------------------
// Test 2: Search Query Filtering
// -------------------------------------------------------------
console.log('\nTest 2: Search Query Filtering');

function filterSessions(sessions, query, status) {
  const q = (query || '').toLowerCase().trim();
  return sessions.filter(s => {
    const matchesSearch = !q || (s.title && s.title.toLowerCase().includes(q)) || s.sessionId.toLowerCase().includes(q);
    let matchesStatus = true;
    if (status === 'ready') {
      matchesStatus = s.status === 'ready';
    } else if (status === 'interrupted') {
      matchesStatus = s.status === 'interrupted';
    }
    return matchesSearch && matchesStatus;
  });
}

const matchPr = filterSessions(all, 'review', 'all');
assert.strictEqual(matchPr.length, 1);
assert.strictEqual(matchPr[0].sessionId, s1.sessionId);

const matchDemo = filterSessions(all, 'demo', 'all');
assert.strictEqual(matchDemo.length, 1);
assert.strictEqual(matchDemo[0].sessionId, s2.sessionId);

const matchNone = filterSessions(all, 'nonexistent', 'all');
assert.strictEqual(matchNone.length, 0);

console.log('✅ PASS: Search query filter matches accurately by substring.');

// -------------------------------------------------------------
// Test 3: Status Filtering
// -------------------------------------------------------------
console.log('\nTest 3: Status Filtering');
const readyOnly = filterSessions(all, '', 'ready');
assert.strictEqual(readyOnly.length, 2);

const interruptedOnly = filterSessions(all, '', 'interrupted');
assert.strictEqual(interruptedOnly.length, 1);
assert.strictEqual(interruptedOnly[0].sessionId, s3.sessionId);

console.log('✅ PASS: Status filtering correctly separates ready from interrupted sessions.');

// -------------------------------------------------------------
// Test 4: Renaming Session & Title Sanitization
// -------------------------------------------------------------
console.log('\nTest 4: Renaming Session & Title Sanitization');

const updated = await registry.updateSessionMetadata(s1.sessionId, {
  title: '   <script>alert("xss")</script> Sprint 23 Demo / Review   '
});

// Title must have script tags stripped, whitespace trimmed, path separators neutralized
assert.ok(!updated.title.includes('<script>'), 'Title must not contain script tags');
assert.ok(!updated.title.includes('/'), 'Path separators must be neutralized');
assert.strictEqual(updated.title, 'alert(-xss-) Sprint 23 Demo - Review');

const fetched = await registry.getSession(s1.sessionId);
assert.strictEqual(fetched.title, 'alert(-xss-) Sprint 23 Demo - Review');
console.log(`✅ PASS: Renaming safely updated manifest with sanitized title: "${updated.title}".`);

// -------------------------------------------------------------
// Test 5: Deleting Session from Library
// -------------------------------------------------------------
console.log('\nTest 5: Deleting Session from Library');

const delSuccess = await registry.deleteSession(s3.sessionId);
assert.strictEqual(delSuccess, true);

const remaining = await registry.listSessions();
assert.strictEqual(remaining.length, 2);
assert.ok(!remaining.some(s => s.sessionId === s3.sessionId));

const checkDeleted = await registry.getSession(s3.sessionId);
assert.strictEqual(checkDeleted, null);

console.log('✅ PASS: Session cleanly removed from library registry upon deletion.');

console.log('\n=============================================================');
console.log('🎉 ALL LOCAL LIBRARY MANAGEMENT UNIT TESTS PASSED!');
console.log('=============================================================\n');
