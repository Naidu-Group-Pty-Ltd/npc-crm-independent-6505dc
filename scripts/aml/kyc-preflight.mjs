#!/usr/bin/env node
/**
 * Go-live preflight for the zero-cost KYC stack.
 *
 * Answers one question: if the providers were switched to live right now,
 * would identity verification and screening actually work?
 *
 * Every check is read-only. Nothing here changes configuration — flipping a
 * provider to live stays a deliberate human action in
 * AML › Configuration › Providers.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   AML_VERIFICATION_SERVICE_URL=... AML_VERIFICATION_SERVICE_TOKEN=... \
 *     node scripts/aml/kyc-preflight.mjs [--tenant default] [--json]
 *
 * Exit code 0 = ready, 1 = something would fail. Warnings do not fail the run;
 * they are things that work today but will bite later (a list going stale is
 * the usual one).
 */
import { createClient } from '@supabase/supabase-js';

/** A sanctions list older than this is not a current list. */
const LIST_STALE_DAYS = 7;

const results = [];
const record = (level, name, detail, fix = null) =>
  results.push({ level, name, detail, fix });
const pass = (n, d) => record('PASS', n, d);
const warn = (n, d, f) => record('WARN', n, d, f);
const fail = (n, d, f) => record('FAIL', n, d, f);

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

async function checkVerificationService() {
  const url = (process.env.AML_VERIFICATION_SERVICE_URL || '').replace(/\/+$/, '');
  const token = process.env.AML_VERIFICATION_SERVICE_TOKEN || '';

  if (!url || !token) {
    return fail('Verification service credentials',
      `AML_VERIFICATION_SERVICE_URL ${url ? 'set' : 'MISSING'}, ` +
      `AML_VERIFICATION_SERVICE_TOKEN ${token ? 'set' : 'MISSING'}`,
      'Set both on the edge functions: supabase secrets set AML_VERIFICATION_SERVICE_URL=... AML_VERIFICATION_SERVICE_TOKEN=...');
  }
  pass('Verification service credentials', `${url} (token ${token.length} chars)`);

  let health;
  try {
    const res = await fetch(`${url}/healthz`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return fail('Verification service reachable', `GET ${url}/healthz returned ${res.status}`,
        'Confirm the container is running and reachable from the edge functions (private network or tunnel).');
    }
    health = await res.json();
  } catch (e) {
    return fail('Verification service reachable', `${e.message}`,
      'Deploy the container: cd services/aml-verification-service && docker compose up --build -d');
  }

  pass('Verification service reachable', `status=${health.status}`);

  const models = health.models ?? {};
  if (models.yunet && models.sface) {
    pass('Face models present', 'YuNet + SFace found in the model directory');
  } else {
    fail('Face models present',
      `yunet=${!!models.yunet} sface=${!!models.sface} (model_dir ${health.model_dir})`,
      'Models are fetched at image build time — rebuild rather than starting against a half-populated directory: docker compose build --no-cache');
  }

  if (health.token_configured) pass('Service token enforced', 'Service is refusing unauthenticated calls');
  else fail('Service token enforced', 'Service reports no token configured — it would accept anonymous face comparisons',
    'Set AML_SERVICE_TOKEN in the container environment and restart.');
}

async function checkDatabase(admin, tenantId) {
  const aml = admin.schema('aml');

  /* providers ---------------------------------------------------------- */
  for (const [capability, expected] of [['idv', 'selfhosted'], ['pep_sanctions', 'local_lists']]) {
    const { data, error } = await aml.from('provider_configs')
      .select('provider_key, mode, active, priority')
      .eq('tenant_id', tenantId).eq('capability', capability).eq('active', true)
      .order('priority', { ascending: true }).limit(1).maybeSingle();

    if (error) { fail(`Provider: ${capability}`, error.message); continue; }
    if (!data) {
      warn(`Provider: ${capability}`, 'no active provider configured — the simulator will be used',
        `Run the seed migration, or add ${expected} in AML › Configuration › Providers.`);
      continue;
    }
    const label = `${data.provider_key} (mode=${data.mode}, priority=${data.priority})`;
    if (data.mode === 'live' && data.provider_key === expected) pass(`Provider: ${capability}`, `LIVE via ${label}`);
    else if (data.mode === 'live') {
      warn(`Provider: ${capability}`, `live, but via ${label} rather than ${expected}`,
        'Intentional only if a paid adapter is wired; otherwise the factory will throw.');
    } else {
      warn(`Provider: ${capability}`, `${label} — still returning simulator results`,
        `Switch this provider to live in AML › Configuration › Providers once the rest of this preflight is green.`);
    }
  }

  /* sanctions lists ----------------------------------------------------- */
  const { count: entryCount } = await aml.from('sanctions_entries')
    .select('id', { count: 'exact', head: true });
  if ((entryCount ?? 0) === 0) {
    fail('Sanctions entries loaded', 'aml.sanctions_entries is empty — every screen would return "clear"',
      'npm run aml:sanctions:load');
  } else {
    pass('Sanctions entries loaded', `${entryCount} entries`);
  }

  for (const list of ['dfat', 'un', 'ofac']) {
    const { data: sync } = await aml.from('sanctions_list_syncs')
      .select('status, entry_count, completed_at, started_at, error_detail')
      .eq('list_code', list).eq('status', 'succeeded')
      .order('started_at', { ascending: false }).limit(1).maybeSingle();

    if (!sync) {
      const level = list === 'dfat' ? fail : warn;
      level(`List freshness: ${list}`, 'never loaded successfully',
        list === 'dfat'
          ? 'DFAT is the legally operative Australian list. npm run aml:sanctions:load -- --list dfat'
          : `npm run aml:sanctions:load -- --list ${list}`);
      continue;
    }
    const age = daysSince(sync.completed_at ?? sync.started_at);
    const detail = `${sync.entry_count} entries, ${age.toFixed(1)} days old`;
    if (age > LIST_STALE_DAYS) {
      warn(`List freshness: ${list}`, `${detail} — older than ${LIST_STALE_DAYS} days`,
        'Schedule the loader (.github/workflows/aml-sanctions-refresh.yml) or run it now.');
    } else {
      pass(`List freshness: ${list}`, detail);
    }
  }

  /* biometric plumbing --------------------------------------------------- */
  const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
  if (bucketErr) {
    warn('Biometric bucket', `could not list buckets: ${bucketErr.message}`);
  } else {
    const bucket = (buckets ?? []).find((b) => b.id === 'aml-biometrics');
    if (!bucket) {
      fail('Biometric bucket', 'aml-biometrics does not exist — selfie upload would fail',
        'Apply migration 20260728160000_aml_selfhosted_verification.sql');
    } else if (bucket.public) {
      fail('Biometric bucket', 'aml-biometrics is PUBLIC — facial images would be world-readable',
        'Set the bucket private immediately.');
    } else {
      pass('Biometric bucket', 'aml-biometrics exists and is private');
    }
  }

  const { data: consent } = await aml.from('consent_documents')
    .select('version, required').eq('code', 'biometric_collection')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (!consent) {
    fail('Biometric consent published', 'no biometric_collection consent document',
      'Apply migration 20260728120000_aml_verification_checks.sql');
  } else if (consent.required) {
    fail('Biometric consent optional', `v${consent.version} is marked REQUIRED — it would block the portal for clients who decline`,
      'Apply migration 20260729030000_optional_biometric_consent.sql');
  } else {
    pass('Biometric consent published', `v${consent.version}, optional (APP 3.3)`);
  }

  const { data: schedule } = await aml.from('retention_schedules')
    .select('retention_years, disposal_method, active').eq('entity_type', 'biometric').maybeSingle();
  if (!schedule) {
    fail('Biometric retention schedule', 'no schedule for entity_type=biometric — images would never be destroyed',
      'Apply migration 20260728160000_aml_selfhosted_verification.sql');
  } else {
    pass('Biometric retention schedule',
      `${schedule.retention_years} years, ${schedule.disposal_method}`);
  }

  /* work waiting on a human ---------------------------------------------- */
  const { count: pending } = await aml.from('verification_checks')
    .select('id', { count: 'exact', head: true }).in('status', ['pending', 'referred']);
  if ((pending ?? 0) > 0) {
    warn('Verification queue', `${pending} check(s) pending or referred and awaiting adjudication`,
      'Open the case workspace › Verification for each.');
  } else {
    pass('Verification queue', 'nothing waiting');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const tenantId = argv.includes('--tenant') ? argv[argv.indexOf('--tenant') + 1] : 'default';
  const asJson = argv.includes('--json');

  await checkVerificationService();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail('Supabase credentials', 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — database checks skipped',
      'Export both and re-run.');
  } else {
    await checkDatabase(createClient(url, key), tenantId);
  }

  const failed = results.filter((r) => r.level === 'FAIL');
  const warned = results.filter((r) => r.level === 'WARN');

  if (asJson) {
    console.log(JSON.stringify({
      ready: failed.length === 0, tenant: tenantId,
      pass: results.length - failed.length - warned.length,
      warn: warned.length, fail: failed.length, results,
    }, null, 2));
  } else {
    const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
    console.log(`\nKYC go-live preflight — tenant "${tenantId}"\n`);
    for (const r of results) {
      console.log(`  ${icon[r.level]} ${r.name.padEnd(32)} ${r.detail}`);
      if (r.fix && r.level !== 'PASS') console.log(`      → ${r.fix}`);
    }
    console.log(`\n  ${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failures`);
    console.log(failed.length === 0
      ? '\n  READY — the stack would work if the providers were switched to live.\n'
      : '\n  NOT READY — resolve the failures above before switching to live.\n');
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
