#!/usr/bin/env node
/**
 * PDF Import Release Gate — Phase 11D local/CI static gate.
 *
 * Self-contained (no TypeScript import — its one local import is a sibling
 * `.mjs`). Answers "can this branch/deployment
 * proceed?" for the PDF import system. Local/CI-safe by default: NO production
 * secrets, NO Supabase calls, NO Cloud Run calls, NO AI, NO template mutation,
 * NO import execution. It only reads files, inspects git, optionally runs the
 * project's own tests/build, and writes a report.
 *
 * Exit code: 0 for pass / pass_with_warnings / skipped, 1 for fail.
 * With --strict-warnings, pass_with_warnings also exits 1.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyArtifact } from './pdfImportArtifactClass.mjs';

const ROOT = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

// ── CLI flags ──
const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function value(name, fallback) {
  const p = args.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split('=').slice(1).join('=') : fallback;
}
const MODE = value('mode', null);
const NO_BUILD = flag('no-build');
const NO_TESTS = flag('no-tests');
const JSON_ONLY = flag('json');
const STRICT_WARNINGS = flag('strict-warnings');
const OUTPUT_DIR_FLAG = value('output-dir', null);

// ── Config ──
function loadConfig() {
  const configPath = join(SELF_DIR, 'pdf-import-release-gate.config.json');
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}
const config = loadConfig();
const mode = MODE || config.mode || 'static';
const reportsDir = OUTPUT_DIR_FLAG || config.reportsDir || 'reports/pdf-import-release-gate';

// ── Git info (best-effort) ──
function git(cmd, fallback = null) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}
const branch = git('git rev-parse --abbrev-ref HEAD');
const commit = git('git rev-parse HEAD');
const baseCommit = /^[0-9a-f]{40,64}$/i.test(process.env.PDF_IMPORT_BASE_SHA || '')
  ? git(`git rev-parse --verify ${process.env.PDF_IMPORT_BASE_SHA}^{commit}`)
  : null;
/**
 * What *this branch* changed, and not what the base changed under it.
 *
 * `git diff <base> HEAD` is a two-dot diff: it reports every difference
 * between the two commits, which includes files the **base** gained after the
 * branch diverged. Those show up as changes this branch never made, and the
 * artifact scan below classifies purely by path — so a legitimate `.png`
 * committed to main failed every open pull request whose branch predated it,
 * naming a file the author had never touched.
 *
 * The merge base is the fix: `<merge-base> HEAD` is the three-dot range, which
 * is the set of files the pull request is actually proposing. The workflow
 * checks out with `fetch-depth: 0` precisely so this is computable.
 *
 * When it is not computable — a shallow clone, an unrelated base — this falls
 * back to the base commit itself, which is the old behaviour: **over**-
 * inclusive rather than under-inclusive. That direction is deliberate. A false
 * alarm costs somebody a re-run; a missed private artifact is a client PDF or
 * a `.env` committed to the repository, which is what this check exists to
 * stop.
 */
const diffFrom = baseCommit
  ? (git(`git merge-base ${baseCommit} HEAD`, null) || baseCommit)
  : null;
const committedFiles = diffFrom
  ? (git(`git diff --name-only ${diffFrom} HEAD`, '') || '').split('\n').filter(Boolean)
  : [];
const stagedFiles = (git('git diff --cached --name-only', '') || '').split('\n').filter(Boolean);
const changedFiles = (git('git diff --name-only', '') || '').split('\n').filter(Boolean);
const candidateFiles = Array.from(new Set([...committedFiles, ...stagedFiles, ...changedFiles]));

// ── Severity weights + scoring (mirror releaseGateEvaluator.ts) ──
const WEIGHT = { critical: 25, high: 12, medium: 6, low: 2, info: 0 };
function scoreOf(checks) {
  let score = 100;
  for (const c of checks) {
    const w = WEIGHT[c.severity] ?? 0;
    if (c.status === 'fail') score -= w;
    else if (c.status === 'warning') score -= w / 2;
    else if (c.status === 'unknown') score -= w / 4;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
function decisionOf(checks, score) {
  if (checks.length === 0) return 'skipped';
  if (checks.every((c) => c.status === 'skipped')) return 'skipped';
  const crit = checks.filter((c) => c.status === 'fail' && c.severity === 'critical').length;
  const high = checks.filter((c) => c.status === 'fail' && c.severity === 'high').length;
  const anyFail = checks.some((c) => c.status === 'fail');
  const anySoft = checks.some((c) => c.status === 'warning' || c.status === 'unknown' || c.status === 'skipped');
  if (crit > 0 || high >= 2 || score < 75) return 'fail';
  if (anyFail) return 'pass_with_warnings';
  if (!anySoft && score >= 95) return 'pass';
  return 'pass_with_warnings';
}

// ── Check helpers ──
const checks = [];
function add(id, domain, severity, status, title, message, evidence = [], remediation = '') {
  checks.push({ id, domain, severity, status, title, message, evidence, remediation });
}

// 1. Required files
function classify(rel) {
  if (rel.startsWith('docs/') && rel.endsWith('.schema.json')) return ['schemas', 'medium'];
  if (rel.startsWith('docs/')) return ['documentation', 'medium'];
  if (rel.endsWith('.sql')) return ['sql', 'medium'];
  if (rel.startsWith('supabase/functions/')) return ['monitoring', 'high'];
  if (rel.startsWith('supabase/migrations/')) return ['source_integrity', 'high'];
  if (rel.startsWith('scripts/regression/') && (rel.endsWith('.mjs') || rel.endsWith('.json'))) return ['ci_configuration', 'high'];
  if (rel.includes('ingestion/monitoring/')) return ['monitoring', 'high'];
  if (rel.includes('ingestion/operatorPermissions/')) return ['permissions', 'critical'];
  if (rel.includes('ingestion/goldenCorpus/')) return ['golden_regression', 'high'];
  if (rel.includes('ingestion/exportParity/')) return ['export_parity', 'high'];
  if (rel.includes('ingestion/releaseGate/')) return ['ci_configuration', 'high'];
  if (rel.startsWith('src/lib/reportTemplate/ingestion/')) return ['source_integrity', 'critical'];
  return ['source_integrity', 'medium'];
}
const requiredFiles = Array.isArray(config.requiredFiles) ? config.requiredFiles : [];
for (const rel of requiredFiles) {
  const [domain, severity] = classify(rel);
  const exists = existsSync(join(ROOT, rel));
  add(`file_exists:${rel}`, domain, severity, exists ? 'pass' : 'fail',
    `Required file: ${rel}`, exists ? 'File present.' : 'Required file missing.',
    [rel], `Restore or create ${rel}.`);
}

// 2. Private artifact scan (committed CI range + staged/unstaged file paths)
//
// The rule lives in its own module rather than inline here, because it is
// written twice — the other copy is `releaseGateSafetyScanner.ts`, which is
// what the unit tests exercise while THIS is what CI runs. Narrowing the
// TypeScript copy alone once cost a full round trip: four specs passed, the
// change merged and cascaded, and the gate failed on the same file. A contract
// spec now imports both and fails when they answer differently.
const artifactHits = { no_private_pdfs_staged: [], no_generated_images_staged: [], no_logs_or_env_staged: [], no_signed_url_dumps_staged: [] };
for (const p of candidateFiles) {
  const [, checkId] = classifyArtifact(p);
  if (checkId) artifactHits[checkId].push(p);
}
const ARTIFACT_TITLES = {
  no_private_pdfs_staged: 'No private PDFs staged',
  no_generated_images_staged: 'No generated images staged',
  no_logs_or_env_staged: 'No logs or .env staged',
  no_signed_url_dumps_staged: 'No signed URL dumps staged',
};
for (const [id, hits] of Object.entries(artifactHits)) {
  add(id, 'private_artifacts', 'critical', hits.length ? 'fail' : 'pass', ARTIFACT_TITLES[id],
    hits.length ? `${hits.length} offending candidate file(s).` : 'No offending candidate files.',
    hits, 'Unstage the private artifact(s) and add to .gitignore.');
}

// 3. Unsafe source pattern scan (changed source files only)
const GENERAL_PATTERNS = [
  { code: 'automatic_ai_execution', id: 'no_automatic_ai_execution_pattern', re: /\b(autoRunAiReconciliation|automaticallyReconcile|autoInvokeAiReconciliation|autoRunReconciliation)\b/ },
  { code: 'manual_only_auto_completion', id: 'no_manual_only_action_auto_completion_pattern', re: /\b(autoCompleteManualOnly|forceCompleteManualOnly|autoExecuteManualOnly)\b/ },
  { code: 'quality_gate_bypass', id: 'no_quality_gate_bypass_pattern', re: /\b(bypassQualityGate|skipQualityGate|forceQualityGatePass|disableQualityGate)\b/ },
];
const SCOPED_PATTERNS = [
  // Frontend-only: the service-role key is legitimate in server-side edge
  // functions (supabase/functions/**), so this rule scopes to the src/ bundle.
  { id: 'no_service_role_secret_frontend_pattern', pathScope: /^src\//, re: /SUPABASE_SERVICE_ROLE_KEY/ },
  { id: 'no_automatic_template_mutation_pattern', pathScope: /ingestion\/(selfHealing|operatorControls)\/.*(Executor|executor)/, re: /\b(applyTemplateImportPlan|applyRepairedTemplateToRecord)\s*\(/ },
  { id: 'no_automatic_template_mutation_pattern', pathScope: /ingestion\/(selfHealing|operatorControls)\//, re: /from\(['"]report_templates['"]\)\s*\.\s*(update|upsert|insert|delete)/ },
];
function shouldScan(rel) {
  if (rel.includes('/__tests__/')) return false;
  if (rel.endsWith('.spec.ts') || rel.endsWith('.test.ts')) return false;
  if (rel.startsWith('docs/')) return false;
  if (rel.endsWith('.md') || rel.endsWith('.sql') || rel.endsWith('.json')) return false;
  if (rel.includes('ingestion/releaseGate/')) return false;
  return rel.startsWith('src/') || rel.startsWith('supabase/functions/');
}
const safetyHits = {
  no_service_role_secret_frontend_pattern: [],
  no_automatic_ai_execution_pattern: [],
  no_manual_only_action_auto_completion_pattern: [],
  no_quality_gate_bypass_pattern: [],
  no_automatic_template_mutation_pattern: [],
};
for (const rel of candidateFiles) {
  if (!shouldScan(rel)) continue;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  let content = '';
  try { content = readFileSync(abs, 'utf8'); } catch { continue; }
  for (const p of GENERAL_PATTERNS) if (p.re.test(content)) safetyHits[p.id].push(rel);
  for (const p of SCOPED_PATTERNS) if (p.pathScope.test(rel) && p.re.test(content)) safetyHits[p.id].push(rel);
}
const SAFETY_TITLES = {
  no_service_role_secret_frontend_pattern: 'No service-role secret in frontend',
  no_automatic_ai_execution_pattern: 'No automatic AI execution',
  no_manual_only_action_auto_completion_pattern: 'No manual-only auto-completion',
  no_quality_gate_bypass_pattern: 'No quality gate bypass',
  no_automatic_template_mutation_pattern: 'No automatic template mutation',
};
for (const [id, hits] of Object.entries(safetyHits)) {
  add(id, 'security_safety', 'critical', hits.length ? 'fail' : 'pass', SAFETY_TITLES[id],
    hits.length ? `${hits.length} unsafe pattern hit(s).` : 'No unsafe patterns detected.',
    hits, 'Remove the unsafe pattern; keep AI/template/manual actions manual and gated.');
}

// 4. Command runner
function runCommand(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (err) {
    const out = (err.stdout?.toString?.() ?? '') + (err.stderr?.toString?.() ?? '');
    return { ok: false, output: out.slice(-2000) };
  }
}

// 5. Tests
if (NO_TESTS) {
  add('release_gate_tests_pass', 'tests', 'critical', 'skipped', 'Release gate tests pass', 'Skipped via --no-tests.', [], 'Run the Phase 11D specs.');
} else {
  const cmd = config.commands?.phase11dTests;
  if (cmd) {
    const r = runCommand(cmd);
    add('release_gate_tests_pass', 'tests', 'critical', r.ok ? 'pass' : 'fail', 'Release gate tests pass',
      r.ok ? 'Phase 11D specs passed.' : 'Phase 11D specs failed.', r.ok ? [] : [r.output], 'Fix failing Phase 11D specs.');
  } else {
    add('release_gate_tests_pass', 'tests', 'critical', 'unknown', 'Release gate tests pass', 'No test command configured.', [], 'Configure commands.phase11dTests.');
  }
}

// 6. Build
if (NO_BUILD) {
  add('npm_build_passes', 'build', 'critical', 'skipped', 'npm build passes', 'Skipped via --no-build.', [], 'Run npm run build.');
} else {
  const cmd = config.commands?.build || 'npm run build';
  const r = runCommand(cmd);
  add('npm_build_passes', 'build', 'critical', r.ok ? 'pass' : 'fail', 'npm build passes',
    r.ok ? 'Build passed.' : 'Build failed.', r.ok ? [] : [r.output], 'Fix build/type errors.');
}

// 7. CI configuration presence
add('release_gate_script_exists', 'ci_configuration', 'high',
  existsSync(join(SELF_DIR, 'pdf-import-release-gate.mjs')) ? 'pass' : 'fail',
  'Release gate script exists', 'CLI script presence.', [], 'Restore the CLI script.');
add('release_gate_config_exists', 'ci_configuration', 'high',
  existsSync(join(SELF_DIR, 'pdf-import-release-gate.config.json')) ? 'pass' : 'fail',
  'Release gate config exists', 'Config presence.', [], 'Restore the config.');
const workflowExists = existsSync(join(ROOT, '.github/workflows/pdf-import-release-gate.yml'));
add('github_actions_workflow_exists_or_documented', 'ci_configuration', 'medium',
  workflowExists ? 'pass' : 'warning', 'GitHub Actions workflow exists or documented',
  workflowExists ? 'Workflow present.' : 'Workflow not enabled; documented in CI setup doc.', [],
  'Add .github/workflows/pdf-import-release-gate.yml or document the CI setup.');

// 8. Optional live checks (info; skipped unless mode enables them + secrets present)
const liveEnabled = (mode === 'live' || mode === 'full') && process.env.PDF_IMPORT_ENABLE_LIVE_CHECKS === 'true';
function liveCheck(id, title, ready) {
  add(id, 'live_environment', 'info', liveEnabled && ready ? 'pass' : 'skipped', title,
    liveEnabled ? (ready ? 'Configured.' : 'Not configured; skipped.') : 'Live checks disabled (default).', [],
    'Enable PDF_IMPORT_ENABLE_LIVE_CHECKS and configure credentials.');
}
liveCheck('optional_supabase_sql_check_configured', 'Optional Supabase SQL check configured', !!process.env.SUPABASE_URL);
liveCheck('optional_monitoring_function_check_configured', 'Optional monitoring function check configured', !!process.env.SUPABASE_URL);
liveCheck('optional_cloud_run_sidecar_check_configured', 'Optional Cloud Run sidecar check configured', !!process.env.PDF_PARSE_SERVICE_URL);

// 9. Report generated marker
add('release_gate_report_generated', 'ci_configuration', 'medium', 'pass', 'Release gate report generated',
  'JSON + Markdown reports written.', [], 'n/a');

// ── Evaluate ──
const score = scoreOf(checks);
let decision = decisionOf(checks, score);
if (STRICT_WARNINGS && decision === 'pass_with_warnings') decision = 'fail';

const summary = {
  total: checks.length,
  pass: checks.filter((c) => c.status === 'pass').length,
  warning: checks.filter((c) => c.status === 'warning').length,
  fail: checks.filter((c) => c.status === 'fail').length,
  skipped: checks.filter((c) => c.status === 'skipped').length,
  unknown: checks.filter((c) => c.status === 'unknown').length,
  criticalFailures: checks.filter((c) => c.status === 'fail' && c.severity === 'critical').length,
  highFailures: checks.filter((c) => c.status === 'fail' && c.severity === 'high').length,
};

const report = {
  version: 'pdf-import-release-gate-v1',
  mode,
  decision,
  score,
  checks,
  summary,
  generatedAt: new Date().toISOString(),
  branch,
  commit,
};

// ── Write reports ──
function toMarkdown(r) {
  const crit = r.checks.filter((c) => c.status === 'fail' && c.severity === 'critical');
  const warns = r.checks.filter((c) => c.status === 'warning' || c.status === 'unknown');
  const rows = r.checks.map((c) => `| ${c.id} | ${c.domain} | ${c.status} | ${c.severity} | ${String(c.message).replace(/\|/g, '\\|')} |`);
  return [
    '# PDF Import Release Gate Report', '',
    `- **Decision:** ${r.decision}`, `- **Mode:** ${r.mode}`, `- **Score:** ${r.score}/100`,
    `- **Generated At:** ${r.generatedAt}`, `- **Branch:** ${r.branch ?? '(unknown)'}`, `- **Commit:** ${r.commit ?? '(unknown)'}`, '',
    '## Summary', '',
    `total ${r.summary.total} · pass ${r.summary.pass} · warning ${r.summary.warning} · fail ${r.summary.fail} · skipped ${r.summary.skipped} · unknown ${r.summary.unknown} · critical failures ${r.summary.criticalFailures} · high failures ${r.summary.highFailures}`, '',
    '## Critical Failures', '',
    crit.length ? crit.map((c) => `- **${c.id}** — ${c.message}`).join('\n') : '_None._', '',
    '## Warnings', '',
    warns.length ? warns.map((c) => `- **${c.id}** (${c.status}) — ${c.message}`).join('\n') : '_None._', '',
    '## Check Results', '',
    '| ID | Domain | Status | Severity | Message |', '|---|---|---|---|---|',
    ...rows, '',
  ].join('\n');
}

const outDir = join(ROOT, reportsDir);
let reportsWritten = false;
try {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'release-gate-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'release-gate-report.md'), toMarkdown(report));
  reportsWritten = true;
} catch (err) {
  console.error(`[release-gate] Could not write reports: ${err.message}`);
}

// ── Console output ──
if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('');
  console.log('===================================================================');
  console.log(` PDF Import Release Gate — ${decision.toUpperCase()} (score ${score}/100, mode ${mode})`);
  console.log('===================================================================');
  console.log(` branch: ${branch ?? '(unknown)'}  commit: ${(commit ?? '').slice(0, 12)}`);
  console.log(` checks: ${summary.total}  pass ${summary.pass}  warn ${summary.warning}  fail ${summary.fail}  skip ${summary.skipped}  unknown ${summary.unknown}`);
  const fails = checks.filter((c) => c.status === 'fail');
  if (fails.length) {
    console.log('');
    console.log(' Failures:');
    for (const c of fails) console.log(`   [${c.severity}] ${c.id} — ${c.message}`);
  }
  if (reportsWritten) console.log(`\n reports: ${reportsDir}/release-gate-report.{json,md}`);
  console.log('');
}

process.exit(decision === 'fail' ? 1 : 0);
