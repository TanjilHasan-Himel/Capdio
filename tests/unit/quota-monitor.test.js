// tests/unit/quota-monitor.test.js
// Unit Test Suite for Storage Quota Monitor & Low-Storage Manager (OCS-203)

import assert from 'assert';
import { StorageQuotaMonitor } from '../../apps/extension/src/shared/quota-monitor.ts';

console.log('🧪 Running Capdio Storage Quota Monitor Unit Tests (OCS-203)...');

// Test 1: Normal Storage Conditions
console.log('\nTest 1: Normal Storage Estimation');
const monitor = new StorageQuotaMonitor();

monitor.setMockEstimate({
  quota: 10 * 1024 * 1024 * 1024, // 10 GB
  usage: 1 * 1024 * 1024 * 1024   // 1 GB
});

const report1 = await monitor.getEstimate();
assert.strictEqual(report1.level, 'ok');
assert.strictEqual(report1.canRecord, true);
assert.strictEqual(report1.percentageUsed, 10);
assert.strictEqual(report1.availableBytes, 9 * 1024 * 1024 * 1024);

const preflight1 = await monitor.canStartRecording();
assert.strictEqual(preflight1.ok, true);
console.log('✅ PASS: Normal storage correctly classified as OK, pre-flight passes.');

// Test 2: Warning Threshold (Below 50 MB available)
console.log('\nTest 2: Warning Storage Threshold');
monitor.setMockEstimate({
  quota: 100 * 1024 * 1024, // 100 MB
  usage: 65 * 1024 * 1024    // 65 MB used -> 35 MB remaining (< 50MB warning, 65% used)
});

const report2 = await monitor.getEstimate();
assert.strictEqual(report2.level, 'warning');
assert.strictEqual(report2.canRecord, true);

const preflight2 = await monitor.canStartRecording();
assert.strictEqual(preflight2.ok, true);
console.log('✅ PASS: 35 MB available correctly classified as WARNING, still allows recording.');

// Test 3: Critical Threshold (Below 20 MB available)
console.log('\nTest 3: Critical Storage Threshold & Pre-Flight Rejection');
monitor.setMockEstimate({
  quota: 10 * 1024 * 1024 * 1024,
  usage: (10 * 1024 * 1024 * 1024) - (12 * 1024 * 1024) // 12 MB remaining
});

const report3 = await monitor.getEstimate();
assert.strictEqual(report3.level, 'critical');
assert.strictEqual(report3.canRecord, false);

const preflight3 = await monitor.canStartRecording();
assert.strictEqual(preflight3.ok, false);
assert.ok(preflight3.reason?.includes('Insufficient storage space'));
console.log(`✅ PASS: 12 MB remaining rejected pre-flight with reason: "${preflight3.reason}"`);

// Test 4: Percentage-based Critical Threshold (96% used)
console.log('\nTest 4: Percentage-Based Quota Depletion');
monitor.setMockEstimate({
  quota: 100 * 1024 * 1024, // 100 MB quota
  usage: 96 * 1024 * 1024   // 96% used
});

const report4 = await monitor.getEstimate();
assert.strictEqual(report4.level, 'critical');
assert.strictEqual(report4.canRecord, false);
console.log('✅ PASS: 96% quota utilization flagged as CRITICAL.');

// Test 5: Custom Thresholds Configuration
console.log('\nTest 5: Custom Thresholds Configuration');
const customMonitor = new StorageQuotaMonitor({
  criticalBytes: 100 * 1024 * 1024, // 100 MB critical
  warningBytes: 200 * 1024 * 1024   // 200 MB warning
});

customMonitor.setMockEstimate({
  quota: 10 * 1024 * 1024 * 1024,
  usage: (10 * 1024 * 1024 * 1024) - (80 * 1024 * 1024) // 80 MB remaining
});

const customReport = await customMonitor.getEstimate();
assert.strictEqual(customReport.level, 'critical');
console.log('✅ PASS: Custom thresholds correctly respected.');

console.log('\n=============================================================');
console.log('🎉 ALL QUOTA MONITOR UNIT TESTS PASSED!');
console.log('=============================================================\n');
