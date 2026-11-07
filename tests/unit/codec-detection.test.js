// tests/unit/codec-detection.test.js
// Unit Tests for Capdio Codec Detection and Settings Fallback Engine (OCS-105)

import assert from 'node:assert';
import {
  isMimeSupported,
  getCodecCapabilityReport,
  selectBestCodec,
  WEBM_CANDIDATES,
  MP4_CANDIDATES
} from '../../apps/extension/src/shared/codec-detector.ts';
import { QUALITY_PRESETS } from '../../apps/extension/src/shared/types.ts';
import { MessageBusError } from '../../apps/extension/src/shared/message-bus.ts';

console.log('🧪 Running Capdio Codec Detection & Settings Fallback Unit Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: Quality Presets Structure & Validity
// ---------------------------------------------------------------------------
console.log('Test 1: Quality Presets Structure & Bitrate Targets');
const presetKeys = ['economy', 'balanced', 'high', 'ultra'];
for (const key of presetKeys) {
  const preset = QUALITY_PRESETS[key];
  assert.ok(preset, `Preset '${key}' should exist`);
  assert.ok(preset.width > 0, `Preset '${key}' width must be > 0`);
  assert.ok(preset.height > 0, `Preset '${key}' height must be > 0`);
  assert.ok([24, 30, 60].includes(preset.fps), `Preset '${key}' fps must be 24, 30, or 60`);
  assert.ok(preset.videoBitrate >= 1_000_000, `Preset '${key}' bitrate must be >= 1 Mbps`);
}
console.log('✅ PASS: All 4 quality presets (economy, balanced, high, ultra) verified.');

// ---------------------------------------------------------------------------
// Test 2: Codec Capability Matrix Reporting
// ---------------------------------------------------------------------------
console.log('\nTest 2: Codec Capability Matrix Reporting');

// Scenario A: Standard Chrome desktop (VP9, VP8, and MP4 supported)
const mockChromeSupported = (mime) => {
  const allowed = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4'
  ];
  return allowed.includes(mime);
};

const reportA = getCodecCapabilityReport(mockChromeSupported);
assert.strictEqual(reportA.canRecordWebM, true);
assert.strictEqual(reportA.canRecordMp4, true);
assert.strictEqual(reportA.bestWebM, 'video/webm;codecs=vp9,opus');
assert.strictEqual(reportA.bestMp4, 'video/mp4;codecs=avc1,mp4a.40.2');
console.log('✅ PASS: Full capability report accurately identifies best WebM and MP4 codecs.');

// Scenario B: Environment without MP4 support (e.g. some Linux builds)
const mockWebmOnly = (mime) => {
  return mime.startsWith('video/webm');
};

const reportB = getCodecCapabilityReport(mockWebmOnly);
assert.strictEqual(reportB.canRecordWebM, true);
assert.strictEqual(reportB.canRecordMp4, false);
assert.strictEqual(reportB.bestMp4, null);
assert.strictEqual(reportB.bestWebM, 'video/webm;codecs=vp9,opus');
console.log('✅ PASS: WebM-only environment correctly reports canRecordMp4 = false.');

// ---------------------------------------------------------------------------
// Test 3: Preference Negotiation and Graceful Fallback
// ---------------------------------------------------------------------------
console.log('\nTest 3: Preference Negotiation & Graceful Fallback');

// User requests MP4, and browser supports MP4
const resMp4Direct = selectBestCodec('mp4', mockChromeSupported);
assert.strictEqual(resMp4Direct.mimeType, 'video/mp4;codecs=avc1,mp4a.40.2');
assert.strictEqual(resMp4Direct.isFallback, false);
console.log('✅ PASS: MP4 requested and supported -> uses MP4 directly without fallback.');

// User requests MP4, but browser ONLY supports WebM -> Graceful fallback
const resMp4Fallback = selectBestCodec('mp4', mockWebmOnly);
assert.strictEqual(resMp4Fallback.mimeType, 'video/webm;codecs=vp9,opus');
assert.strictEqual(resMp4Fallback.isFallback, true);
console.log('✅ PASS: MP4 requested on WebM-only browser -> gracefully falls back to best WebM.');

// User requests WebM on standard browser
const resWebmDirect = selectBestCodec('webm', mockChromeSupported);
assert.strictEqual(resWebmDirect.mimeType, 'video/webm;codecs=vp9,opus');
assert.strictEqual(resWebmDirect.isFallback, false);
console.log('✅ PASS: WebM requested and supported -> uses WebM directly.');

// Browser only supports VP8 WebM (VP9 unavailable)
const mockVp8Only = (mime) => mime === 'video/webm;codecs=vp8,opus' || mime === 'video/webm';
const resVp8Fallback = selectBestCodec('webm', mockVp8Only);
assert.strictEqual(resVp8Fallback.mimeType, 'video/webm;codecs=vp8,opus');
console.log('✅ PASS: VP9 unavailable -> falls back to VP8 baseline.');

// ---------------------------------------------------------------------------
// Test 4: Unsupported Environment Error Recovery
// ---------------------------------------------------------------------------
console.log('\nTest 4: Total Unsupported Codec Error Recovery');
const mockNoneSupported = () => false;

assert.throws(
  () => selectBestCodec('webm', mockNoneSupported),
  (err) => {
    return err instanceof MessageBusError && err.code === 'E_CODEC_UNSUPPORTED';
  },
  'Should throw E_CODEC_UNSUPPORTED when no candidate codecs are available'
);
console.log('✅ PASS: Total codec absence safely throws E_CODEC_UNSUPPORTED.');

console.log('\n=============================================');
console.log('🎉 ALL CODEC DETECTION & FALLBACK TESTS PASSED!');
console.log('=============================================\n');
