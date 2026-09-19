#!/usr/bin/env node
/**
 * The sidecar and the dispatcher have to agree about what the engine IS.
 *
 * WHY THIS CHECK EXISTS
 * ---------------------
 * `pdf-parse-dispatch` fingerprints its artifact cache with the engine version
 * and the lane policy version. A cache hit skips the sidecar entirely and
 * serves a stored artifact. So if the two sides disagree about which semantics
 * a version string names, the dispatcher serves artifacts produced under the
 * OLD rules and reports them as current — silently, and for ever, because a
 * cache hit never reaches the code that would have noticed.
 *
 * `LANE-POLICY.md` G3 records this as the rule that keeps biting: the sidecar
 * image and the dispatcher function must ship together.
 *
 * THE RULE IS SUBSET, NOT PREFIX
 * ------------------------------
 * The two constants are deliberately different shapes:
 *
 *   sidecar    ENGINE_VERSION         every marker the image carries
 *   dispatcher ENGINE_VERSION_FAMILY  only the markers that change the ARTIFACT
 *
 * The dispatcher's string omits `phase4j-capability-activation`,
 * `phase2-fitz-vectors-typography`, `phase3-fonts`, `phase6e-stroke-style` and
 * `coverage-ranges-v1` — markers that move without invalidating a cached
 * artifact. So the family is a **subset** of the engine version, and the two
 * share a prefix only as far as `phase3-raster-manifest`. A prefix comparison
 * would fail on the very first correct deploy.
 *
 * COMPARED AS TOKENS, NEVER AS SUBSTRINGS
 * ---------------------------------------
 * `"…source-measure-v1…".includes("source-measure-v1")` is true of
 * `source-measure-v10` as well, so a substring test quietly passes a version it
 * has never seen. Both sides are split on `+` and compared as sets.
 *
 * MODES
 * -----
 *   --static              the two files in this repo agree with each other
 *   --deployed <path|->   a /healthz payload agrees with this repo
 *   --selftest            the rules above, against known-good and known-bad input
 *
 * Zero dependencies, so it runs from a workflow step before `npm ci` — and on a
 * machine that cannot complete one.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SOURCES = {
  sidecarEngine: {
    file: 'pdf-parse-service/app.py',
    // Anchored at column 0: `app.py` also *imports* LANE_ENFORCEMENT_VERSION on
    // an indented line, and an unanchored pattern would read the import.
    pattern: /^ENGINE_VERSION\s*=\s*["']([^"']+)["']/m,
    name: 'ENGINE_VERSION',
  },
  sidecarLane: {
    file: 'pdf-parse-service/lane_policy.py',
    pattern: /^LANE_ENFORCEMENT_VERSION\s*=\s*["']([^"']+)["']/m,
    name: 'LANE_ENFORCEMENT_VERSION',
  },
  dispatcherFamily: {
    file: 'supabase/functions/pdf-parse-dispatch/index.ts',
    pattern: /^const\s+ENGINE_VERSION_FAMILY\s*=\s*["']([^"']+)["']/m,
    name: 'ENGINE_VERSION_FAMILY',
  },
  dispatcherLane: {
    file: 'supabase/functions/pdf-parse-dispatch/index.ts',
    pattern: /^const\s+LANE_POLICY_VERSION\s*=\s*["']([^"']+)["']/m,
    name: 'LANE_POLICY_VERSION',
  },
};

/** `a+b+c` → `['a','b','c']`, empty segments dropped. */
export function engineTokens(version) {
  return String(version ?? '').split('+').map((t) => t.trim()).filter(Boolean);
}

/**
 * Which of the dispatcher's markers the engine version does not carry.
 *
 * Returns the missing tokens rather than a boolean: naming them is the whole
 * value when somebody bumped one file and not the other.
 */
export function missingFamilyTokens(engineVersion, family) {
  const carried = new Set(engineTokens(engineVersion));
  return engineTokens(family).filter((token) => !carried.has(token));
}

/**
 * Every way the four constants can disagree, as human-readable failures.
 *
 * An empty array means they agree. A missing value is a failure rather than a
 * skip — a check that did not run must never report success.
 */
export function lockstepFailures({ sidecarEngine, sidecarLane, dispatcherFamily, dispatcherLane }) {
  const failures = [];

  for (const [label, value] of Object.entries({ sidecarEngine, sidecarLane, dispatcherFamily, dispatcherLane })) {
    if (!value || typeof value !== 'string' || !value.trim()) {
      failures.push(`${label} is missing — the comparison could not be made, which is not the same as passing`);
    }
  }
  if (failures.length) return failures;

  const missing = missingFamilyTokens(sidecarEngine, dispatcherFamily);
  if (missing.length) {
    failures.push(
      `the dispatcher's ENGINE_VERSION_FAMILY names ${missing.length} marker(s) the sidecar's `
      + `ENGINE_VERSION does not carry: ${missing.join(', ')}`,
    );
  }

  if (sidecarLane !== dispatcherLane) {
    failures.push(
      `lane policy version disagrees — sidecar LANE_ENFORCEMENT_VERSION is "${sidecarLane}", `
      + `dispatcher LANE_POLICY_VERSION is "${dispatcherLane}"`,
    );
  }

  return failures;
}

/** Read one constant, or fail loudly. */
function readConstant(key) {
  const { file, pattern, name } = SOURCES[key];
  const path = resolve(ROOT, file);
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${file} — ${name} could not be checked`);
  }
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} not found in ${file} — the constant moved or was renamed`);
  return match[1];
}

export function readRepoVersions() {
  return {
    sidecarEngine: readConstant('sidecarEngine'),
    sidecarLane: readConstant('sidecarLane'),
    dispatcherFamily: readConstant('dispatcherFamily'),
    dispatcherLane: readConstant('dispatcherLane'),
  };
}

// ── modes ────────────────────────────────────────────────────────────────────

function runStatic() {
  const versions = readRepoVersions();
  const failures = lockstepFailures(versions);

  console.log('Engine lockstep (this repo):');
  console.log(`  sidecar    ENGINE_VERSION         ${versions.sidecarEngine}`);
  console.log(`  dispatcher ENGINE_VERSION_FAMILY  ${versions.dispatcherFamily}`);
  console.log(`  sidecar    LANE_ENFORCEMENT_VERSION  ${versions.sidecarLane}`);
  console.log(`  dispatcher LANE_POLICY_VERSION       ${versions.dispatcherLane}`);

  if (failures.length) {
    console.error('\nThe sidecar and the dispatcher do NOT agree:\n');
    for (const f of failures) console.error(` - ${f}`);
    console.error(
      '\nShipping them apart makes the artifact cache serve stale semantics under a '
      + 'current key. Bump both, or neither (LANE-POLICY.md G3).',
    );
    return 1;
  }
  console.log('\nThey agree.');
  return 0;
}

/**
 * Compare a deployed sidecar's `/healthz` against this repo.
 *
 * The image is built from this commit, so the deployed engine version must be
 * EQUAL to the checked-out one — not merely compatible. A staged revision
 * running something else means the build published a different image than the
 * one this run believes it deployed.
 */
function runDeployed(source) {
  const raw = source === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(source), 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error('the deployed /healthz response is not JSON — the service may not be reachable');
    return 1;
  }

  const repo = readRepoVersions();
  const deployedEngine = payload.engine_version;
  const deployedLane = payload.lane_enforcement_version;
  const failures = [];

  if (deployedEngine !== repo.sidecarEngine) {
    failures.push(
      `the deployed image is not this commit — /healthz reports "${deployedEngine}", `
      + `this checkout builds "${repo.sidecarEngine}"`,
    );
  }
  if (deployedLane !== repo.sidecarLane) {
    failures.push(
      `the deployed lane policy is "${deployedLane}", this checkout builds "${repo.sidecarLane}"`,
    );
  }
  // Against the DEPLOYED string rather than the repo's, so a mismatched image
  // is measured for what it actually carries.
  const missing = missingFamilyTokens(deployedEngine, repo.dispatcherFamily);
  if (missing.length) {
    failures.push(
      `the deployed engine does not carry ${missing.length} marker(s) the dispatcher's cache key `
      + `claims: ${missing.join(', ')}`,
    );
  }

  console.log(`deployed engine_version            ${deployedEngine}`);
  console.log(`deployed lane_enforcement_version  ${deployedLane}`);

  if (failures.length) {
    console.error('\nThe deployed sidecar does NOT match this commit:\n');
    for (const f of failures) console.error(` - ${f}`);
    return 1;
  }
  console.log('\nThe deployed sidecar matches this commit, and carries every marker the dispatcher caches on.');
  return 0;
}

/**
 * The rules, against input chosen to break them.
 *
 * Here rather than in a vitest spec so it runs in a deploy workflow that has no
 * `node_modules` — the gate must be able to refuse a build before anything is
 * installed.
 */
function runSelftest() {
  const cases = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, actual, expected });
  };

  const ENGINE = 'docling-2.14.0+phaseD+phase3-raster-manifest+extra-marker+source-measure-v2';
  const FAMILY = 'docling-2.14.0+phaseD+phase3-raster-manifest+source-measure-v2';

  check('a family that is a subset of the engine passes', missingFamilyTokens(ENGINE, FAMILY), []);
  check(
    'a marker the engine lacks is named',
    missingFamilyTokens(ENGINE, `${FAMILY}+cmap-repair-v1`),
    ['cmap-repair-v1'],
  );
  // The substring trap: v1 must NOT be satisfied by v10 or by v2.
  check(
    'a version suffix is not matched by a longer one',
    missingFamilyTokens('a+source-measure-v10', 'a+source-measure-v1'),
    ['source-measure-v1'],
  );
  check(
    'the engine base version must match exactly',
    missingFamilyTokens('docling-2.15.0+phaseD', 'docling-2.14.0+phaseD'),
    ['docling-2.14.0'],
  );

  const agree = { sidecarEngine: ENGINE, sidecarLane: 'lane-v3', dispatcherFamily: FAMILY, dispatcherLane: 'lane-v3' };
  check('agreeing constants produce no failures', lockstepFailures(agree), []);
  check(
    'a lane bump on one side only is caught',
    lockstepFailures({ ...agree, dispatcherLane: 'lane-v2' }).length,
    1,
  );
  check(
    'a missing constant fails rather than passing quietly',
    lockstepFailures({ ...agree, sidecarEngine: '' }).length,
    1,
  );
  check(
    'an engine that dropped a cached marker is caught',
    lockstepFailures({ ...agree, sidecarEngine: 'docling-2.14.0+phaseD' }).length,
    1,
  );

  let failed = 0;
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      failed += 1;
      console.error(`       expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed.`);
  return failed ? 1 : 0;
}

// ── entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const deployedAt = args.indexOf('--deployed');

let code;
try {
  if (args.includes('--selftest')) code = runSelftest();
  else if (deployedAt !== -1) {
    const path = args[deployedAt + 1];
    if (!path) throw new Error('--deployed needs a path to a /healthz JSON payload (or - for stdin)');
    code = runDeployed(path);
  } else code = runStatic();
} catch (error) {
  console.error(`engine lockstep check failed: ${error.message}`);
  code = 1;
}
process.exit(code);
