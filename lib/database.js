import { createClient } from '@supabase/supabase-js';

let _client = null;
function getClient() {
  if (!_client && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}

/**
 * Persist a completed scan report to Supabase.
 * Fire-and-forget — errors are swallowed by the caller.
 */
export async function saveScanHistory(report) {
  const db = getClient();
  if (!db) return; // Supabase not configured — skip silently

  const { address, scannedAt, token, score, findings, coverage } = report;

  // 1. Upsert into `scans`
  const { data: scanRow, error: scanErr } = await db
    .from('scans')
    .upsert({
      address,
      scanned_at: scannedAt || new Date().toISOString(),
      token_name: token?.name || null,
      token_symbol: token?.symbol || null,
      score_value: score?.value ?? null,
      verdict: score?.verdict ?? null,
      subclass: score?.subclass ?? null,
      coverage_ok: coverage?.ok ?? null,
      coverage_total: coverage?.total ?? null,
    }, { onConflict: 'address' })
    .select('id')
    .single();

  if (scanErr || !scanRow) return;

  // 2. Insert findings (delete old ones first to avoid duplication on rescan)
  if (findings?.length) {
    await db.from('findings').delete().eq('scan_address', address);
    await db.from('findings').insert(
      findings.map(f => ({
        scan_address: address,
        code: f.code,
        severity: f.severity,
        title: f.title,
        description: f.description,
        source_url: f.source_url || null,
      }))
    );
  }
}

/**
 * Fetch past scans for a wallet (via wallet_scans join table).
 * Returns up to 20 most recent scans.
 */
export async function getWalletHistory(walletAddress) {
  const db = getClient();
  if (!db) return [];

  const { data } = await db
    .from('wallet_scans')
    .select('scans(address, token_symbol, score_value, verdict, scanned_at)')
    .eq('wallet_address', walletAddress.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(20);

  return (data || []).map(row => row.scans).filter(Boolean);
}
