import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { address } = req.query;

  const nonce = Math.floor(Math.random() * 1000000).toString();
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 mins

  await supabase.from('wallet_nonces').insert({ wallet_address: address, nonce, expires_at });

  return res.status(200).json({ nonce });
}