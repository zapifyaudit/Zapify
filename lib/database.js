/**
 * Zapify — Supabase Database Layer
 * Saves scan reports and findings to Supabase.
 * Fire-and-forget: never throws — errors are caught internally.
 */




/**
 * Save a scan report to Supabase.
 * @param {object} report — the full report object from api/scan.js
 */
export async function saveToDb(report) {
  try {
    const sb = await getClientAsync();
    if (!sb) return;

    const { data: scanRow, error: scanErr } = await sb
      .from('scans')
      .insert({
        address: report.address,
        token_name: report.token?.name || null,
        token_symbol: report.token?.symbol || null,
        score: report.score?.value ?? null,
        verdict: report.score?.verdict || null,
        subclass: report.score?.subclass || null,
        coverage_ok: report.coverage?.ok ?? null,
        coverage_total: report.coverage?.total ?? null,
        raw_modules: report.modules || null
      })
      .select('id')
      .single();

    if (scanErr || !scanRow) return;

    const findings = (report.findings || []).map(f => ({
      scan_id: scanRow.id,
      code: f.code,
      severity: f.severity,
      title: f.title,
      description: f.description || null,
      source_url: f.source_url || null
    }));

    if (findings.length > 0) {
      await sb.from('findings').insert(findings);
    }
  } catch {
    // Silently fail — DB is not critical to scan results
  }
}

/**
 * Get recent scan history.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getHistory(limit = 20) {
  try {
    const sb = await getClientAsync();
    if (!sb) return [];

    const { data, error } = await sb
      .from('scans')
      .select('id, address, token_symbol, score, verdict, subclass, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Internal async getter for the client
async function getClientAsync() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || url.includes('your-project')) return null;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    _client = createClient(url, key, { auth: { persistSession: false } });
    return _client;
  } catch {
    return null;
  }
}
