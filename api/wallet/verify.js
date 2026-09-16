import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address, signature } = req.body || {};
  if (!address || !signature) {
    return res.status(400).json({ error: 'Missing address or signature' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes('your-project')) {
    return res.status(200).json({ success: true, verified: true, mock: true });
  }

  const supabase = createClient(url, key);

  // Fetch active nonce
  const { data: nonceRow } = await supabase
    .from('wallet_nonces')
    .select('nonce')
    .eq('wallet_address', address.toLowerCase())
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!nonceRow) {
    return res.status(400).json({ error: 'Nonce expired or not found' });
  }

  const message = `Sign this message to verify ownership of your wallet for Zapify: ${nonceRow.nonce}`;
  const recovered = ethers.verifyMessage(message, signature);

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Delete used nonce
  await supabase.from('wallet_nonces').delete().eq('wallet_address', address.toLowerCase());

  return res.status(200).json({ success: true, verified: true, address: address.toLowerCase() });
}
