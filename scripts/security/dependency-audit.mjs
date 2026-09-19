#!/usr/bin/env node
/**
 * Dependency vulnerability gate (SUPPLY-001 / CI-001).
 *
 * Runs `npm audit --json` and fails the build when a vulnerability at or above
 * the blocking severity is present and not explicitly accepted.
 *
 * Design notes:
 *  - Blocks on `high` by default (override with SECURITY_AUDIT_LEVEL:
 *    low|moderate|high|critical). Findings below the threshold are reported as
 *    warnings so they stay visible without breaking every unrelated PR.
 *  - Accepted advisories are listed in
 *    scripts/security/dependency-audit-allowlist.json (by advisory URL or
 *    GHSA/CVE id, each with a reason + review date). Anything not on the
 *    allowlist counts toward the gate.
 *  - `npm audit` exits non-zero when it finds anything; we capture output and
 *    make our own pass/fail decision, so a clean-but-nonzero exit is fine.
 *  - The audit call is BOUNDED AND RETRIED, because it is a network request to
 *    the npm registry and the gate used to have no notion of time: a registry
 *    that hung for seven minutes and then answered with something unusable was
 *    indistinguishable from a malformed report, and two builds on 4 September
 *    2026 went red on exactly that — including main's own — while the re-run
 *    passed in nine seconds. Each attempt is killed at a fixed bound, a fresh
 *    attempt gets a fresh connection, and after the attempts are spent the
 *    gate STILL FAILS CLOSED, exactly as before. The retries change when a
 *    build goes red, never what may pass one.
 *
 * This is intentionally advisory-database driven (npm's registry mirrors the
 * GitHub Advisory / OSV data), so it needs no extra service. SBOM generation
 * is handled separately in CI via @cyclonedx/cyclonedx-npm.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWLIST_PATH = join(root, 'scripts', 'security', 'dependency-audit-allowlist.json');

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const blockLevel = (process.env.SECURITY_AUDIT_LEVEL || 'high').toLowerCase();
const blockRank = RANK[blockLevel] ?? RANK.critical;

let allow = { advisories: [] };
try {
  allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
} catch {
  // No allowlist file -> nothing accepted; that's fine.
}
const accepted = new Set(
  (allow.advisories || []).map((a) => String(a.id || a.url || '').trim()).filter(Boolean)
);

/**
 * How long ONE `npm audit` call may take before it is killed.
 *
 * The call ordinarily answers in seconds — the very re-run that followed the
 * seven-minute hang took nine — so two minutes is generous headroom for a slow
 * registry while still bounding the job. SIGKILL rather than the default
 * SIGTERM, so the bound is the bound whatever npm is doing.
 *
 * Env-overridable for the tests, which prove the kill actually happens without
 * waiting two minutes to do it.
 */
const AUDIT_TIMEOUT_MS = Number(process.env.SECURITY_AUDIT_TIMEOUT_MS || 120_000);

/**
 * Attempts before the gate fails closed.
 *
 * Three, because the failure this absorbs is a registry that is briefly
 * unavailable — each retry opens a fresh connection — while a report that is
 * genuinely malformed is malformed three times and still exits 2. Fixed
 * rather than configurable: a knob here is a knob on how long a security gate
 * argues with itself.
 */
const AUDIT_ATTEMPTS = 3;

/** The pause between attempts. Zeroed by the tests; a moment in CI. */
const AUDIT_RETRY_DELAY_MS = Number(process.env.SECURITY_AUDIT_RETRY_DELAY_MS ?? 5_000);

/** Synchronous pause, because everything in this gate is synchronous. */
function pause(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** One bounded call to `npm audit --json`: a valid report, or why not. */
function attemptAudit() {
  let raw;
  try {
    /*
     * `execFileSync` rather than the shell variant: `sh -c` in between meant
     * the timeout's SIGKILL landed on the shell and npm itself survived as an
     * orphan — the CI runner's post-job cleanup found two of them
     * ("Terminate orphan process: npm audit") after the first bounded run.
     * With no shell in the way, the process the bound kills is the process
     * doing the work.
     */
    raw = execFileSync('npm', ['audit', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: AUDIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  } catch (e) {
    // Killed at the bound: there is no report and the reason is TIME, which is
    // worth saying — "invalid report" sent the last reader of this failure
    // hunting for a parsing bug in a network outage.
    if (e.signal || e.code === 'ETIMEDOUT') {
      return { error: new Error(`\`npm audit --json\` did not answer within ${AUDIT_TIMEOUT_MS}ms.`) };
    }
    // npm audit exits 1 when vulnerabilities exist; the JSON is still on stdout.
    if (e.stdout) raw = e.stdout;
    else return { error: e };
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    return { error: e };
  }

  // Operational failures can also produce parseable JSON. Only accept the
  // documented npm v7+ report shape so registry/audit errors fail closed.
  if (!isRecord(report?.vulnerabilities) || !isRecord(report?.metadata?.vulnerabilities)) {
    return { error: new Error('`npm audit --json` returned an invalid audit report.') };
  }
  return { report };
}

function runAudit() {
  let lastError;
  for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt++) {
    if (attempt > 1) pause(AUDIT_RETRY_DELAY_MS);
    const outcome = attemptAudit();
    if (outcome.report) return outcome.report;
    lastError = outcome.error;
    console.error(`dependency-audit: attempt ${attempt} of ${AUDIT_ATTEMPTS} failed: ${lastError.message}`);
  }
  failAudit(new Error(`${lastError.message} (${AUDIT_ATTEMPTS} attempts)`));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failAudit(error) {
  console.error('dependency-audit: could not run/parse `npm audit --json`.');
  console.error(error.message);
  process.exit(2);
}

const report = runAudit();

// npm v7+ schema: report.vulnerabilities is keyed by package name.
const vulns = report.vulnerabilities;
const blocking = [];
const belowThreshold = [];

/** Advisory identifiers this package is flagged under, for allowlist matching. */
function advisoryIds(v) {
  const ids = new Set();
  for (const via of v.via || []) {
    if (typeof via === 'object') {
      if (via.url) ids.add(String(via.url));
      if (via.source) ids.add(String(via.source));
      if (via.name && via.title) ids.add(`${via.name}: ${via.title}`);
    }
  }
  return ids;
}

/**
 * Is this package accepted?
 *
 * Directly, when one of its own advisory ids is on the allowlist. Or
 * TRANSITIVELY: `npm audit` also flags a package whose only fault is depending
 * on a vulnerable one, and represents that as a `via` entry which is a bare
 * package NAME rather than an advisory object. `pptxgenjs` is flagged solely
 * because it pulls in `image-size`; it has no advisory of its own, so there is
 * no id to allowlist and no way to accept it without naming the bare package —
 * which the allowlist's own policy forbids, because accepting a package accepts
 * every future advisory against it sight unseen.
 *
 * So a package flagged only through other packages is accepted exactly when all
 * of those are. The judgement stays attached to the advisory that was actually
 * read, and a NEW advisory against `pptxgenjs` itself would arrive as an
 * advisory object and block, as it should.
 *
 * ## The `seen` set is per-PATH, not per-traversal
 *
 * `seen` guards against a cycle, and a cycle is a repeat along ONE path. Sharing
 * a single set across the sibling branches of `.every` also rejects a **diamond**
 * — a package legitimately reached twice by two different routes — because the
 * second visit looks like a repeat.
 *
 * That is not hypothetical. It blocked `main`:
 *
 *     radix-ui ─┬─ @radix-ui/react-form ── @radix-ui/react-label ── image-size
 *               └─ @radix-ui/react-label ─────────────────────────── image-size
 *
 * `image-size`'s two advisories are on the allowlist with reasons and a review
 * date, and both radix packages were reported `accepted-via-allowlist`. But
 * evaluating `react-form` first put `react-label` in the shared set, so the
 * second branch returned false, `.every` failed, and `radix-ui [high]` was
 * reported as an unaccepted advisory that nobody could act on — there is no
 * advisory id to allowlist, and naming the bare package is what the allowlist's
 * own policy forbids.
 *
 * A fresh copy per branch keeps the guard doing what it is for.
 */
function isAcceptedPkg(pkg, seen = new Set()) {
  if (seen.has(pkg)) return false;  // cycle guard — see the note above
  seen.add(pkg);
  const v = vulns[pkg];
  if (!v) return false;
  if (accepted.has(pkg)) return true;                       // explicit, discouraged
  if ([...advisoryIds(v)].some((id) => accepted.has(id))) return true;

  const parents = (v.via || []).filter((via) => typeof via === 'string');
  const ownAdvisories = (v.via || []).filter((via) => typeof via === 'object');
  if (ownAdvisories.length > 0 || parents.length === 0) return false;
  return parents.every((parent) => isAcceptedPkg(parent, new Set(seen)));
}

for (const [pkg, v] of Object.entries(vulns)) {
  const severity = String(v.severity || 'info').toLowerCase();
  const rank = RANK[severity] ?? 0;
  const ids = advisoryIds(v);
  const isAccepted = isAcceptedPkg(pkg);
  const record = { pkg, severity, ids: [...ids], accepted: isAccepted };

  if (rank >= blockRank && !isAccepted) blocking.push(record);
  else if (rank >= blockRank && isAccepted) belowThreshold.push({ ...record, note: 'accepted-via-allowlist' });
  else belowThreshold.push(record);
}

const meta = report.metadata?.vulnerabilities || {};
console.log(
  `Dependency audit: ${meta.total ?? '?'} total ` +
  `(critical ${meta.critical ?? 0}, high ${meta.high ?? 0}, moderate ${meta.moderate ?? 0}, low ${meta.low ?? 0}). ` +
  `Blocking level: ${blockLevel}.`
);

if (belowThreshold.length) {
  console.log(`\nBelow-threshold / accepted (${belowThreshold.length}):`);
  for (const r of belowThreshold) {
    console.log(`  - ${r.pkg} [${r.severity}]${r.note ? ' (' + r.note + ')' : ''}`);
  }
}

if (blocking.length) {
  console.error(`\nDependency audit FAILED — ${blocking.length} vulnerability(ies) at/above "${blockLevel}" not on the allowlist:\n`);
  for (const r of blocking) {
    console.error(`  - ${r.pkg} [${r.severity}]`);
    for (const id of r.ids) console.error(`      ${id}`);
  }
  console.error(
    '\nRemediate (npm audit fix / upgrade), or, if the risk is accepted, add the ' +
    'advisory id/url to scripts/security/dependency-audit-allowlist.json with a reason.'
  );
  process.exit(1);
}

console.log('\nDependency audit passed.');
