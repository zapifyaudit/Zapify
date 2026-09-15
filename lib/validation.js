import { resolveAddressType } from '../lib/utils.js';

/**
 * Validates the 5 input scenarios described in §9 of the brief.
 *
 * Returns: { valid: boolean, type: string, error?: string }
 *
 * Types:
 *   'evm'     — valid 0x address
 *   'solana'  — looks like a Solana address
 *   'empty'   — blank / missing
 *   'too_short' — 0x prefix present but < 42 chars
 *   'invalid' — anything else
 */
export function validateAddress(raw) {
  const v = (raw || '').trim();

  if (!v) {
    return { valid: false, type: 'empty', error: 'Paste a contract address first.' };
  }

  // Solana-style base58
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
    return {
      valid: false,
      type: 'solana',
      error: 'That looks like a Solana address. Zapify only reads Robinhood Chain (0x addresses).'
    };
  }

  // Has 0x prefix but wrong length
  if (/^0x/i.test(v) && v.length < 42) {
    return {
      valid: false,
      type: 'too_short',
      error: `Address is too short (${v.length} chars). A valid EVM address is 0x + 40 hex characters.`
    };
  }

  // Full EVM address check
  const addrType = resolveAddressType(v);
  if (addrType === 'evm') {
    return { valid: true, type: 'evm', normalized: v.toLowerCase() };
  }

  return {
    valid: false,
    type: 'invalid',
    error: "That isn't a valid address. It should be 0x followed by exactly 40 hex characters."
  };
}

/**
 * Express/Vercel middleware: validates req.body.address for POST handlers.
 * On failure, sends a 400 JSON error and calls next(false) to halt.
 * On success, sets req.validatedAddress and calls next().
 */
export function validateAddressMiddleware(req, res, next) {
  const result = validateAddress(req.body?.address);
  if (!result.valid) {
    res.status(400).json({ error: result.error, type: result.type });
    return;
  }
  req.validatedAddress = result.normalized;
  next?.();
}
