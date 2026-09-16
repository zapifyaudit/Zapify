import { validateAddress } from '../lib/validation.js';

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

console.log('Testing Address Validation...');

// 1. Empty
const r1 = validateAddress('');
assert(!r1.valid && r1.type === 'empty', 'Empty address should be invalid type empty');

// 2. Solana
const r2 = validateAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
assert(!r2.valid && r2.type === 'solana', 'Solana address should be invalid type solana');

// 3. Zero address
const r3 = validateAddress('0x0000000000000000000000000000000000000000');
assert(!r3.valid && r3.type === 'zero', 'Zero address should be invalid type zero');

// 4. Valid EVM
const r4 = validateAddress('0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
assert(r4.valid && r4.type === 'evm', 'Valid EVM address should pass');

// 5. Invalid format
const r5 = validateAddress('0x1234');
assert(!r5.valid && r5.type === 'invalid', 'Short hex address should be invalid');

console.log('✅ Validation tests passed!');
