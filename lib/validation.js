/**
 * Zapify — Address Validator
 * 5 scenarios: empty, solana, evm-valid, invalid-format, zero-address
 */

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * @typedef {{ valid: boolean, type: string, message: string }} ValidationResult
 */

/**
 * Validate a token contract address.
 * @param {string} address
 * @returns {ValidationResult}
 */
export function validateAddress(address) {
  const a = (address || '').trim();

  // Scenario 1: Empty
  if (!a) {
    return { valid: false, type: 'empty', message: 'Paste a contract address first.' };
  }

  // Scenario 2: Solana (base58, 32–44 chars, no 0x prefix)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
    return {
      valid: false,
      type: 'solana',
      message: "That looks like a Solana address. Zapify reads Robinhood Chain (0x addresses)."
    };
  }

  // Scenario 3: Zero address (valid EVM format but useless)
  if (a.toLowerCase() === ZERO) {
    return {
      valid: false,
      type: 'zero',
      message: 'That is the zero address. Paste the token contract address instead.'
    };
  }

  // Scenario 4: Valid EVM address
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) {
    return { valid: true, type: 'evm', message: '' };
  }

  // Scenario 5: Invalid format (starts with 0x but wrong length, or garbage)
  if (/^0x/i.test(a)) {
    return {
      valid: false,
      type: 'invalid',
      message: "That isn't a valid address. It should be 0x followed by exactly 40 hex characters."
    };
  }

  return {
    valid: false,
    type: 'invalid',
    message: "That isn't a valid address. It should be 0x followed by 40 characters."
  };
}
