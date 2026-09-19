#!/usr/bin/env node
/**
 * PDF Extraction V3 · E12 — strict release-gate CLI.
 *
 * Tiers: static | fast | full. Runs the private-artifact scanner + the required
 * Vitest suites (+ the real browser/export e2e for fast/full), writes a strict
 * ReleaseGateReportV2-shaped JSON EVEN ON FAILURE, and exits 0 ONLY when every
 * required check passed. There is NO flag that bypasses hard defects, tests or
 * build (`--force-pass`, `--skip-quality`, `--ignore-hard-defects` are rejected).
 * `--no-build` / `--no-tests` are developer-diagnostic only and force
 * releaseReady=false.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectEnvironmentProfile } from './environment-profile.mjs';

const FORBIDDEN_FLAGS = ['--force-pass', '--skip-quality', '--ignore-hard-defects', '--no-hard-defects'];
const args = process.argv.slice(2);
for (const f of FORBIDDEN_FLAGS) {
  if (args.includes(f)) { console.error(`✗ ${f} is not permitted — the release gate cannot bypass hard defects.`); process.exit(2); }
}

const tierArg = (args.find((a) => a.startsWith('--tier=')) || '--tier=static').split('=')[1];
const tier = ['static', 'fast', 'full'].includes(tierArg) ? tierArg : 'static';
const jsonOut = args.includes('--json');
const noTests = args.includes('--no-tests');
const noBuild = args.includes('--no-build');

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, 'reports', 'pdf-extraction-v3');
mkdirSync(REPORT_DIR, { recursive: true });

const env = detectEnvironmentProfile();
const commit = (() => { try { return spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch { return 'unknown'; } })();

/** Run a subprocess; return { ok, code }. */
function run(cmd, cmdArgs, label) {
  process.stderr.write(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env } });
  return { ok: r.status === 0, code: r.status ?? 1 };
}

const checks = [];
function record(checkId, domain, severity, status, detail) { checks.push({ checkId, domain, severity, status, detail }); }

// 1. Private-artifact scan (always required).
const scan = run('node', ['scripts/regression/pdf-extraction-v3/artifact-scan.mjs', '--staged'], 'private-artifact scan (staged)');
record('private-artifacts.scan', 'private-artifacts', 'hard', scan.ok ? 'pass' : 'fail', scan.ok ? 'no leaks' : 'leaks detected');

// 2. Pure contract + policy + assertion + security suites (static + up).
if (!noTests) {
  const pure = run('npx', ['vitest', 'run', 'src/lib/reportTemplate/ingestion/releaseV3/__tests__'], 'pure release-gate suites');
  record('contracts.matrix', 'contracts', 'hard', pure.ok ? 'pass' : 'fail', 'contract + policy + assertion unit suites');
  record('quality.hard-defects-zero', 'quality', 'hard', pure.ok ? 'pass' : 'fail', 'hard-defect-first semantics verified');
  record('security.no-signed-urls', 'security', 'hard', pure.ok ? 'pass' : 'fail', 'redaction/validator suites');
} else {
  record('contracts.matrix', 'contracts', 'hard', 'skipped', '--no-tests (developer diagnostic)');
}

// 3. Browser/export e2e (fast + full). Reported unavailable when Chromium absent.
if (tier === 'fast' || tier === 'full') {
  if (!env.hasChromium) {
    record('quality.browser-evidence', 'quality', 'hard', 'unavailable', 'Chromium not available in this environment');
    record('export.parity', 'export', 'hard', 'unavailable', 'browser/export e2e requires Chromium');
  } else if (noTests) {
    record('quality.browser-evidence', 'quality', 'hard', 'skipped', '--no-tests');
  } else {
    const e2e = run('npx', ['playwright', 'test', '--config=playwright.config.ts', 'tests-e2e/pdf-extraction-v3'], 'real browser/export e2e');
    record('quality.browser-evidence', 'quality', 'hard', e2e.ok ? 'pass' : 'fail', 'real Chromium DOM + raster + jsPDF export');
    record('export.parity', 'export', 'hard', e2e.ok ? 'pass' : 'fail', 'browser/export structural parity');
    record('determinism.replay', 'determinism', 'hard', e2e.ok ? 'pass' : 'fail', 'deterministic double-run in e2e');
  }
}

// 4. Build (full only, unless deferred).
if (tier === 'full' && !noBuild) {
  const build = run('npm', ['run', 'build'], 'production build');
  record('runtime.container', 'runtime', 'soft', build.ok ? 'pass' : 'warning', build.ok ? 'build ok' : 'build failed (see log)');
}

// ── Decision ─────────────────────────────────────────────────────────────────
const strict = tier === 'full';
const requiredHard = checks.filter((c) => c.severity === 'hard');
const failed = requiredHard.filter((c) => c.status === 'fail' || c.status === 'infrastructure-error');
const skipped = requiredHard.filter((c) => c.status === 'skipped');
const unavailable = requiredHard.filter((c) => c.status === 'unavailable');
const warnings = checks.filter((c) => c.status === 'warning');

let decision = 'pass';
if (failed.length > 0) decision = 'fail';
else if (skipped.length > 0) decision = 'fail';                      // skipped required = fail
else if (unavailable.length > 0) decision = strict ? 'fail' : 'blocked'; // unavailable required = fail (strict)
else if (strict && warnings.length > 0) decision = 'fail';

// Developer-diagnostic flags can never yield a release-eligible pass.
const developerBypass = noTests || noBuild;
const releaseReady = decision === 'pass' && !developerBypass && failed.length === 0 && skipped.length === 0 && unavailable.length === 0;

const report = {
  version: 'pdf-release-gate-report-v2',
  tier: tier === 'fast' ? 'generated-fast' : tier === 'full' ? 'generated-full' : 'static',
  commit,
  environmentProfileId: env.environmentProfileId,
  decision,
  releaseReady,
  requiredCheckCount: requiredHard.length,
  failedRequiredCheckCount: failed.length,
  skippedRequiredCheckCount: skipped.length,
  unavailableRequiredCheckCount: unavailable.length,
  checks,
  developerBypass,
  remediationSummary: [...failed, ...skipped, ...unavailable].map((c) => `${c.checkId}: ${c.status} — ${c.detail}`),
};

const reportPath = path.join(REPORT_DIR, `release-gate-${report.tier}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (jsonOut) console.log(JSON.stringify(report, null, 2));
else {
  console.log('\n' + '='.repeat(64));
  console.log(` PDF Extraction V3 Release Gate — ${decision.toUpperCase()} (tier ${report.tier})`);
  console.log('='.repeat(64));
  console.log(` releaseReady: ${releaseReady}`);
  console.log(` required: ${requiredHard.length}  failed ${failed.length}  skipped ${skipped.length}  unavailable ${unavailable.length}`);
  console.log(` report: ${path.relative(ROOT, reportPath)}`);
  for (const r of report.remediationSummary) console.log(`   • ${r}`);
}

// exit 0 ONLY when release-ready.
process.exit(releaseReady ? 0 : 1);
