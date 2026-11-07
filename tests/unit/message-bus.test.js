// tests/unit/message-bus.test.js
// Unit tests for Capdio Typed Message Bus (OCS-101)

import assert from 'assert';
import {
  isValidMessageSchema,
  isAuthorizedSender,
  MessageBusError,
  generateMessageId
} from '../../apps/extension/src/shared/message-bus.ts';

console.log('🧪 Running Capdio Message Bus Unit Tests...\n');

// 1. Schema Validation Tests
console.log('Test 1: Message Schema Validation');
assert.strictEqual(isValidMessageSchema(null), false, 'null is not valid');
assert.strictEqual(isValidMessageSchema(undefined), false, 'undefined is not valid');
assert.strictEqual(isValidMessageSchema('hello'), false, 'string is not valid');
assert.strictEqual(isValidMessageSchema(123), false, 'number is not valid');
assert.strictEqual(isValidMessageSchema({}), false, 'empty object is not valid');
assert.strictEqual(isValidMessageSchema({ id: '1', target: 'background' }), false, 'missing action is not valid');
assert.strictEqual(isValidMessageSchema({ id: '1', target: 'background', action: 'PING' }), false, 'missing timestamp is not valid');

const validMsg = {
  id: generateMessageId(),
  target: 'background',
  action: 'PING',
  timestamp: Date.now()
};
assert.strictEqual(isValidMessageSchema(validMsg), true, 'complete message schema must be valid');
console.log('✅ PASS: Schema validation accurately distinguishes valid from malformed messages');

// 2. Sender Authorization Tests
console.log('\nTest 2: Sender Origin Authorization');
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id-123'
  }
};

assert.strictEqual(isAuthorizedSender(null), false, 'null sender is unauthorized');
assert.strictEqual(isAuthorizedSender(undefined), false, 'undefined sender is unauthorized');
assert.strictEqual(isAuthorizedSender({ id: 'malicious-extension-id' }), false, 'different extension ID is unauthorized');
assert.strictEqual(isAuthorizedSender({ id: 'test-extension-id-123' }), true, 'matching extension ID is authorized');
console.log('✅ PASS: Sender origin verification strictly enforces runtime identity');

// 3. MessageBusError Class
console.log('\nTest 3: Error Code Taxonomy and Error Class');
const err = new MessageBusError('E_SESSION_CONFLICT', 'A recording session is already active');
assert.strictEqual(err.name, 'MessageBusError');
assert.strictEqual(err.code, 'E_SESSION_CONFLICT');
assert.strictEqual(err.message, 'A recording session is already active');
console.log('✅ PASS: MessageBusError correctly preserves error taxonomy codes');

// 4. UUID Token Generation
console.log('\nTest 4: Message ID Generation');
const id1 = generateMessageId();
const id2 = generateMessageId();
assert.ok(id1 && id1.length > 5, 'Message ID must be non-empty');
assert.notStrictEqual(id1, id2, 'Successive message IDs must be unique');
console.log('✅ PASS: Unique message IDs generated');

console.log('\n=============================================');
console.log('🎉 ALL UNIT TESTS PASSED!');
console.log('=============================================\n');
