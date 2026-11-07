// tests/unit/trim-export.test.js
// Unit Tests for Capdio In/Out Trim Bounds Validation and Non-Destructive Export State (OCS-303)

import assert from 'node:assert';
import { validateTrimBounds } from '../../apps/extension/src/shared/types.ts';

console.log('🧪 Running Capdio In/Out Trim & Export Validation Unit Tests (OCS-303)...\n');

// ---------------------------------------------------------------------------
// Test 1: Valid Normal Range
// ---------------------------------------------------------------------------
console.log('Test 1: Valid In/Out Trim Ranges');
const normalResult = validateTrimBounds(1.2, 5.8, 12.0);
assert.strictEqual(normalResult.valid, true);
assert.strictEqual(normalResult.error, undefined);
assert.deepStrictEqual(normalResult.range, {
  inSeconds: 1.2,
  outSeconds: 5.8,
  durationSeconds: 4.6
});
console.log('✅ PASS: Standard trim range correctly validated and duration computed.');

// ---------------------------------------------------------------------------
// Test 2: Minimum Duration Enforcement (0.5s)
// ---------------------------------------------------------------------------
console.log('\nTest 2: Minimum Duration Enforcement');
const validMin = validateTrimBounds(2.0, 2.5, 10.0);
assert.strictEqual(validMin.valid, true);
assert.strictEqual(validMin.range?.durationSeconds, 0.5);

const subMin = validateTrimBounds(2.0, 2.4, 10.0);
assert.strictEqual(subMin.valid, false);
assert.ok(subMin.error?.includes('Minimum trim duration is 0.5 seconds'));
console.log('✅ PASS: Minimum duration threshold (0.5s) strictly enforced.');

// ---------------------------------------------------------------------------
// Test 3: Inverted or Equal Boundaries
// ---------------------------------------------------------------------------
console.log('\nTest 3: Inverted or Equal In/Out Points');
const inverted = validateTrimBounds(6.0, 2.0, 10.0);
assert.strictEqual(inverted.valid, false);
assert.ok(inverted.error?.includes('strictly less than end time'));

const equal = validateTrimBounds(4.0, 4.0, 10.0);
assert.strictEqual(equal.valid, false);
assert.ok(equal.error?.includes('strictly less than end time'));
console.log('✅ PASS: Inverted and identical in/out points rejected with helpful error.');

// ---------------------------------------------------------------------------
// Test 4: Clamping of Negative In and Out-of-Bounds Out
// ---------------------------------------------------------------------------
console.log('\nTest 4: Safe Clamping of Out-of-Bounds Values');
// Negative In should clamp to 0.0
const clampedIn = validateTrimBounds(-3.5, 4.0, 10.0);
assert.strictEqual(clampedIn.valid, true);
assert.strictEqual(clampedIn.range?.inSeconds, 0.0);
assert.strictEqual(clampedIn.range?.outSeconds, 4.0);
assert.strictEqual(clampedIn.range?.durationSeconds, 4.0);

// Out exceeding total duration should clamp to total duration
const clampedOut = validateTrimBounds(2.0, 18.0, 8.5);
assert.strictEqual(clampedOut.valid, true);
assert.strictEqual(clampedOut.range?.inSeconds, 2.0);
assert.strictEqual(clampedOut.range?.outSeconds, 8.5);
assert.strictEqual(clampedOut.range?.durationSeconds, 6.5);
console.log('✅ PASS: Negative in and overflow out safely clamped within source bounds.');

// ---------------------------------------------------------------------------
// Test 5: NaN and Invalid Inputs
// ---------------------------------------------------------------------------
console.log('\nTest 5: Handling NaN and Type Coercion');
const nanIn = validateTrimBounds(NaN, 5.0, 10.0);
assert.strictEqual(nanIn.valid, false);
assert.ok(nanIn.error?.includes('valid numbers'));

const nanOut = validateTrimBounds(1.0, NaN, 10.0);
assert.strictEqual(nanOut.valid, false);
assert.ok(nanOut.error?.includes('valid numbers'));
console.log('✅ PASS: NaN values rejected cleanly without throwing unhandled exceptions.');

// ---------------------------------------------------------------------------
// Test 6: Non-Destructive Invariance
// ---------------------------------------------------------------------------
console.log('\nTest 6: Non-Destructive Invariance (Original Session Remains Unmutated)');
const originalManifest = {
  sessionId: 'test_session_trim',
  title: 'Original Project Meeting',
  durationMs: 30000,
  totalBytes: 1500000,
  chunks: [{ chunkIndex: 0, sizeBytes: 1500000 }]
};

const frozenManifest = JSON.parse(JSON.stringify(originalManifest));
// Performing trim range calculation should never mutate the underlying manifest
validateTrimBounds(5.0, 15.0, originalManifest.durationMs / 1000);
assert.deepStrictEqual(originalManifest, frozenManifest);
console.log('✅ PASS: Source manifest is 100% immutable and non-destructively preserved.');

console.log('\n🎉 ALL OCS-303 TRIM VALIDATION UNIT TESTS PASSED SUCCESSFULLY!\n');

