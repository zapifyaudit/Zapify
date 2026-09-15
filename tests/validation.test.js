/**
 * tests/validation.test.js
 * Unit tests for lib/validation.js — 5 address input scenarios from §9.
 */

import { validateAddress } from '../lib/validation.js';

test('empty string → invalid, type empty', () => {
  const r = validateAddress('');
  expect(r.valid).toBe(false);
  expect(r.type).toBe('empty');
});

test('whitespace only → invalid, type empty', () => {
  const r = validateAddress('   ');
  expect(r.valid).toBe(false);
  expect(r.type).toBe('empty');
});

test('Solana-like base58 → invalid, type solana', () => {
  const r = validateAddress('So11111111111111111111111111111111111111112');
  expect(r.valid).toBe(false);
  expect(r.type).toBe('solana');
});

test('0x prefix but too short → invalid, type too_short', () => {
  const r = validateAddress('0x1234abc');
  expect(r.valid).toBe(false);
  expect(r.type).toBe('too_short');
});

test('random non-address string → invalid, type invalid', () => {
  const r = validateAddress('hello-world');
  expect(r.valid).toBe(false);
  expect(r.type).toBe('invalid');
});

test('valid EVM address (lowercase) → valid', () => {
  const r = validateAddress('0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
  expect(r.valid).toBe(true);
  expect(r.type).toBe('evm');
  expect(r.normalized).toBe('0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
});

test('valid EVM address (mixed case checksum) → valid, normalised to lowercase', () => {
  const r = validateAddress('0x7E57A1B2C3D4E5F60718293A4B5C6D7E8F901234');
  expect(r.valid).toBe(true);
  expect(r.normalized).toBe('0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
});
