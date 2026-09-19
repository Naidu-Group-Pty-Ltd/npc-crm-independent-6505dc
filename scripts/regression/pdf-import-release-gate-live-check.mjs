#!/usr/bin/env node
/**
 * PDF Import Release Gate — OPTIONAL live environment checks (Phase 11D).
 *
 * Opt-in only. Runs ONLY when PDF_IMPORT_ENABLE_LIVE_CHECKS=true. It performs
 * read-only reachability checks and NEVER prints secrets, NEVER mutates data,
 * NEVER calls AI, and NEVER runs imports. The default static gate does not use
 * this script; missing env must never fail the static gate.
 *
 * Checks (each degrades to a warning when its endpoint/credential is absent):
 *   - Supabase SQL file present + Supabase URL configured.
 *   - pdf-import-monitoring function reachable (expects a structured 401/200).
 *   - Cloud Run sidecar /health reachable.
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();

const findings = [];
function record(id, status, message) {
  findings.push({ id, status, message });
}

if (process.env.PDF_IMPORT_ENABLE_LIVE_CHECKS !== 'true') {
  console.log('[live-check] PDF_IMPORT_ENABLE_LIVE_CHECKS != true — live checks disabled. Exiting 0 (no-op).');
  process.exit(0);
}

const TIMEOUT_MS = 5000;
async function ping(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: '{}', signal: controller.signal });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name ?? 'error' };
  } finally {
    clearTimeout(timer);
  }
}

// 1. Supabase SQL file + URL
const sqlFile = join(ROOT, 'scripts/regression/pdf-import-phase-11d-release-gate-check.sql');
if (existsSync(sqlFile) && process.env.SUPABASE_URL) {
  record('optional_supabase_sql_check_configured', 'pass', 'Supabase configured; run the Phase 11D SQL manually in the SQL editor.');
} else {
  record('optional_supabase_sql_check_configured', 'warning', 'Supabase URL or SQL file missing; skipped.');
}

// 2. Monitoring function reachability
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (supabaseUrl && anonKey) {
  const res = await ping(`${supabaseUrl}/functions/v1/pdf-import-monitoring`, {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    'Content-Type': 'application/json',
  });
  // A structured 401/403/200 means the function is up (auth enforced in-function).
  if (res.ok && [200, 401, 403].includes(res.status)) {
    record('optional_monitoring_function_check_configured', 'pass', `Monitoring function reachable (HTTP ${res.status}).`);
  } else {
    record('optional_monitoring_function_check_configured', 'warning', 'Monitoring function not reachable; skipped.');
  }
} else {
  record('optional_monitoring_function_check_configured', 'warning', 'Supabase URL/anon key missing; skipped.');
}

// 3. Cloud Run sidecar health
const sidecarUrl = process.env.PDF_PARSE_SERVICE_URL;
if (sidecarUrl) {
  const res = await ping(`${sidecarUrl.replace(/\/$/, '')}/health`);
  if (res.ok && res.status >= 200 && res.status < 500) {
    record('optional_cloud_run_sidecar_check_configured', 'pass', `Sidecar reachable (HTTP ${res.status}).`);
  } else {
    record('optional_cloud_run_sidecar_check_configured', 'warning', 'Sidecar not reachable; skipped.');
  }
} else {
  record('optional_cloud_run_sidecar_check_configured', 'warning', 'PDF_PARSE_SERVICE_URL missing; skipped.');
}

for (const f of findings) console.log(`[live-check] ${f.status.toUpperCase().padEnd(7)} ${f.id} — ${f.message}`);
// Live checks never hard-fail the run: warnings are acceptable when opt-in endpoints are absent.
process.exit(0);
