// tests/unit/quality-presets.test.js
// Unit Tests for Capdio Quality Presets & Measured Quality Reporting (OCS-301)

import assert from 'node:assert';
import {
  QUALITY_PRESETS,
  getPreset,
  formatQualityDisplay
} from '../../apps/extension/src/shared/types.ts';
import { validateSessionManifest } from '../../apps/extension/src/shared/manifest-migrator.ts';

console.log('🧪 Running Capdio Quality Presets & Measured Resolution/FPS Unit Tests (OCS-301)...\n');

// ---------------------------------------------------------------------------
// Test 1: Quality Presets Structure & Bitrate Targets (FR-006, FR-007)
// ---------------------------------------------------------------------------
console.log('Test 1: Preset Definitions & Starting Bitrate Targets');
const presets = ['economy', 'balanced', 'high', 'ultra'];

assert.strictEqual(QUALITY_PRESETS.economy.width, 1280);
assert.strictEqual(QUALITY_PRESETS.economy.height, 720);
assert.strictEqual(QUALITY_PRESETS.economy.fps, 30);
assert.strictEqual(QUALITY_PRESETS.economy.videoBitrate, 2_500_000);

assert.strictEqual(QUALITY_PRESETS.balanced.width, 1920);
assert.strictEqual(QUALITY_PRESETS.balanced.height, 1080);
assert.strictEqual(QUALITY_PRESETS.balanced.fps, 30);
assert.strictEqual(QUALITY_PRESETS.balanced.videoBitrate, 5_000_000);

assert.strictEqual(QUALITY_PRESETS.high.width, 2560);
assert.strictEqual(QUALITY_PRESETS.high.height, 1440);
assert.strictEqual(QUALITY_PRESETS.high.fps, 60);
assert.strictEqual(QUALITY_PRESETS.high.videoBitrate, 10_000_000);

assert.strictEqual(QUALITY_PRESETS.ultra.width, 3840);
assert.strictEqual(QUALITY_PRESETS.ultra.height, 2160);
assert.strictEqual(QUALITY_PRESETS.ultra.fps, 60);
assert.strictEqual(QUALITY_PRESETS.ultra.videoBitrate, 20_000_000);

console.log('✅ PASS: All 4 quality presets (economy, balanced, high, ultra) verified with exact spec values.');

// ---------------------------------------------------------------------------
// Test 2: Helper getPreset Fallbacks
// ---------------------------------------------------------------------------
console.log('\nTest 2: getPreset Fallback Behavior');
assert.strictEqual(getPreset('ultra').width, 3840);
assert.strictEqual(getPreset('economy').width, 1280);
// Unknown name should fall back to balanced
assert.strictEqual(getPreset('nonexistent').name, 'balanced');
assert.strictEqual(getPreset('nonexistent').height, 1080);
console.log('✅ PASS: getPreset safely returns requested preset or falls back to balanced.');

// ---------------------------------------------------------------------------
// Test 3: formatQualityDisplay Honest Reporting (FR-006 & FR-007)
// ---------------------------------------------------------------------------
console.log('\nTest 3: Honest Requested vs Actual Comparison Display');

// Scenario A: Native Match (User asked for 1080p @ 30fps, got 1080p @ 30fps)
const nativeMatch = formatQualityDisplay(
  { presetName: 'balanced', width: 1920, height: 1080, fps: 30 },
  { width: 1920, height: 1080, fps: 30 }
);
assert.strictEqual(nativeMatch.isConstrained, false);
assert.strictEqual(nativeMatch.badgeLabel, '1080p @ 30fps');
assert.ok(nativeMatch.detailLabel.includes('1920×1080 @ 30 FPS'));
assert.ok(!nativeMatch.detailLabel.includes('Constrained'));
console.log('✅ PASS: Native match accurately indicates unconstrained stream.');

// Scenario B: Display Constrained (User asked for 4K @ 60fps, display/tab gave 1080p @ 30fps)
const constrainedMatch = formatQualityDisplay(
  { presetName: 'ultra', width: 3840, height: 2160, fps: 60 },
  { width: 1920, height: 1080, fps: 30 }
);
assert.strictEqual(constrainedMatch.isConstrained, true);
assert.strictEqual(constrainedMatch.badgeLabel, '1080p @ 30fps (Constrained)');
assert.ok(constrainedMatch.detailLabel.includes('Requested: Ultra 3840×2160 @ 60 FPS'));
assert.ok(constrainedMatch.detailLabel.includes('Actual: 1920×1080 @ 30 FPS (Display Constrained)'));
console.log('✅ PASS: Display constrained capture clearly separates requested 4K from actual 1080p.');

// Scenario C: FPS Constrained (User asked for 60fps, encoder delivered 30fps)
const fpsConstrained = formatQualityDisplay(
  { presetName: 'high', width: 2560, height: 1440, fps: 60 },
  { width: 2560, height: 1440, fps: 30 }
);
assert.strictEqual(fpsConstrained.isConstrained, true);
assert.strictEqual(fpsConstrained.badgeLabel, '1440p @ 30fps (Constrained)');
console.log('✅ PASS: FPS bottleneck correctly flagged as constrained.');

// ---------------------------------------------------------------------------
// Test 4: Manifest Schema Structural Validation with Quality Presets
// ---------------------------------------------------------------------------
console.log('\nTest 4: Session Manifest Schema Validation with Presets & Measurements');
const testManifest = {
  schemaVersion: 2,
  sessionId: 'sess_preset_test_001',
  createdAt: new Date().toISOString(),
  status: 'ready',
  profile: {
    presetName: 'ultra',
    width: 3840,
    height: 2160,
    fps: 60,
    mimePreference: 'webm',
    videoBitrate: 20_000_000,
    tabAudio: true,
    microphone: false
  },
  sources: [
    {
      sourceId: 'tab_source_1',
      kind: 'tab',
      displayLabel: 'Active Tab',
      authorizedAt: new Date().toISOString(),
      requestedWidth: 3840,
      requestedHeight: 2160,
      requestedFps: 60,
      actualWidth: 1920,
      actualHeight: 1080,
      actualFps: 30
    }
  ],
  segments: [
    {
      partId: 'part_001',
      sourceId: 'tab_source_1',
      startMs: 0,
      bytes: 2500000
    }
  ],
  totalBytes: 2500000,
  durationMs: 5000
};

const validation = validateSessionManifest(testManifest);
assert.strictEqual(validation.valid, true, `Manifest should be valid: ${validation.errors.join(', ')}`);
console.log('✅ PASS: Manifest with presetName and requested/actual dimensions passes schema validation.');

console.log('\n=============================================================');
console.log('🎉 ALL QUALITY PRESETS & MEASURED QUALITY TESTS PASSED!');
console.log('=============================================================\n');
