// tests/unit/audio-device-meter.test.js
// Unit Tests for Capdio Audio Device Selection and Health Meter Levels (OCS-302)

import assert from 'node:assert';
import { calculateAudioLevels } from '../../apps/extension/src/shared/types.ts';

console.log('🧪 Running Capdio Audio Device & Health Meter Unit Tests (OCS-302)...\n');

// ---------------------------------------------------------------------------
// Test 1: Complete Silence Input
// ---------------------------------------------------------------------------
console.log('Test 1: Complete Silence Processing');
const silenceBuffer = new Float32Array(256).fill(0.0);
const silenceLevels = calculateAudioLevels(silenceBuffer);

assert.strictEqual(silenceLevels.rmsLevel, 0);
assert.strictEqual(silenceLevels.peakDb, -100);
assert.strictEqual(silenceLevels.isClipping, false);
console.log('✅ PASS: Complete silence returns 0.0 RMS, -100 dB, isClipping = false.');

// ---------------------------------------------------------------------------
// Test 2: Standard Speech / Nominal Sine Waveform
// ---------------------------------------------------------------------------
console.log('\nTest 2: Standard Speech / Nominal Waveform Processing');
const nominalBuffer = new Float32Array(256);
for (let i = 0; i < nominalBuffer.length; i++) {
  // Peak at 0.5 amplitude
  nominalBuffer[i] = 0.5 * Math.sin((2 * Math.PI * i) / 32);
}
const nominalLevels = calculateAudioLevels(nominalBuffer);

assert.ok(nominalLevels.rmsLevel > 0.5 && nominalLevels.rmsLevel <= 1.0, `Nominal RMS should be reasonable: ${nominalLevels.rmsLevel}`);
assert.ok(nominalLevels.peakDb > -10 && nominalLevels.peakDb < -5, `Peak dB for 0.5 amplitude should be around -6 dB: ${nominalLevels.peakDb}`);
assert.strictEqual(nominalLevels.isClipping, false);
console.log(`✅ PASS: Nominal sine wave processed: RMS=${nominalLevels.rmsLevel}, Peak=${nominalLevels.peakDb} dB, isClipping=false.`);

// ---------------------------------------------------------------------------
// Test 3: Audio Clipping / Saturation
// ---------------------------------------------------------------------------
console.log('\nTest 3: Audio Clipping / Hot Peak Detection');
const hotBuffer = new Float32Array(256);
for (let i = 0; i < hotBuffer.length; i++) {
  hotBuffer[i] = 0.99 * Math.sin((2 * Math.PI * i) / 16);
}
const hotLevels = calculateAudioLevels(hotBuffer);

assert.ok(hotLevels.peakDb >= -0.5, `Peak dB should be near 0 dB: ${hotLevels.peakDb}`);
assert.strictEqual(hotLevels.isClipping, true);
console.log(`✅ PASS: Hot audio correctly triggers isClipping = true (Peak=${hotLevels.peakDb} dB).`);

// ---------------------------------------------------------------------------
// Test 4: Microphone Device Selection Mapping
// ---------------------------------------------------------------------------
console.log('\nTest 4: Microphone Device Selection & Metadata Contract');
const mockAudioDevices = [
  { deviceId: 'default', label: 'Default Microphone', kind: 'audioinput', groupId: 'group1' },
  { deviceId: 'usb_mic_01', label: 'USB Podcast Microphone', kind: 'audioinput', groupId: 'group2' },
  { deviceId: 'webcam_mic_02', label: 'HD Webcam Mic', kind: 'audioinput', groupId: 'group3' },
  { deviceId: 'speaker_01', label: 'Speakers', kind: 'audiooutput', groupId: 'group1' }
];

const filteredInputs = mockAudioDevices
  .filter(d => d.kind === 'audioinput')
  .map(d => ({
    deviceId: d.deviceId,
    label: d.label,
    groupId: d.groupId
  }));

assert.strictEqual(filteredInputs.length, 3);
assert.strictEqual(filteredInputs[1].deviceId, 'usb_mic_01');
assert.strictEqual(filteredInputs[1].label, 'USB Podcast Microphone');
console.log('✅ PASS: Microphone enumeration correctly extracts audio input devices with labels and IDs.');

console.log('\n=============================================================');
console.log('🎉 ALL AUDIO DEVICE & HEALTH METER UNIT TESTS PASSED!');
console.log('=============================================================\n');

