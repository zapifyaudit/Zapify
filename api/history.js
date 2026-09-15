import { getWalletHistory } from '../lib/database.js';
import { lc } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const wallet = req.query.wallet;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Provide a valid wallet address via ?wallet=0x…' });
  }

  try {
    const history = await getWalletHistory(lc(wallet));
    return res.status(200).json({ wallet: lc(wallet), history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
}
