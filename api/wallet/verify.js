import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { lc } from '../../lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address, signature } = req.body || {};

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!signature) {
    return res.status(400).json({ error: 'Signature required' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. Fetch the latest unexpired nonce for this wallet
  const { data: nonceRow, error: nonceErr } = await supabase
    .from('wallet_nonces')
    .select('nonce, expires_at')
    .eq('wallet_address', lc(address))
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (nonceErr || !nonceRow) {
    return res.status(401).json({ error: 'No nonce found. Request a new one from /api/wallet/nonce.' });
  }

  if (new Date(nonceRow.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Nonce has expired. Request a new one.' });
  }

  // 2. Verify the signature
  const message = `Sign in to Zapify\n\nNonce: ${nonceRow.nonce}`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  if (lc(recovered) !== lc(address)) {
    return res.status(401).json({ error: 'Signature does not match wallet address' });
  }

  // 3. Consume the nonce (delete it so it cannot be replayed)
  await supabase
    .from('wallet_nonces')
    .delete()
    .eq('wallet_address', lc(address))
    .eq('nonce', nonceRow.nonce);

  // 4. Upsert the wallet into `wallets` table and return a session token
  //    (In a real app you'd issue a JWT; here we return a simple signed token)
  await supabase
    .from('wallets')
    .upsert({ address: lc(address), last_login: new Date().toISOString() }, { onConflict: 'address' });

  // Simple session: base64(address + ":" + timestamp + ":" + nonce)
  // For production replace with a proper JWT or Supabase Auth session
  const sessionToken = Buffer.from(`${lc(address)}:${Date.now()}:${nonceRow.nonce}`).toString('base64');

  return res.status(200).json({ success: true, address: lc(address), sessionToken });
}
