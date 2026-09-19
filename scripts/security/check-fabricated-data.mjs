#!/usr/bin/env node
/**
 * No invented figures in the report pipeline.
 *
 * ## Why this exists
 *
 * On 2026-09-06 seven of the nine external-data services behind report
 * generation were found answering "I don't know" by inventing — random
 * demographics labelled "ABS Census 2021 estimates" (849 stored reports across
 * 500 properties carried one identical profile; one property held 20 reports
 * with 20 different populations), a hard-coded landmark stop list per state,
 * invented offence counts, invented school names, a Math.random() walk score,
 * a stale cash rate stamped with today's date — and four cache tables held
 * 2,139 fabricated rows and not one live one. Every path reported as normal
 * operation, which is why it survived the platform's whole life.
 *
 * The generators are deleted and every source now answers through
 * `_shared/sourceUnavailable.pure.ts`. This gate is what keeps the class from
 * growing back, in two parts:
 *
 * 1. **A `Math.random()` ratchet over `supabase/functions/`.** A random number
 *    in an edge function is legitimate as jitter, an id, or an SVG handle —
 *    and is fabrication the moment it lands in a figure a report can carry.
 *    Static analysis cannot tell those apart, so every occurrence must be
 *    named in the allowlist with its purpose, counts may only fall, and a new
 *    or grown one fails CI until a human writes down what it is for.
 *    Comments are stripped first: the removal left the history in comments,
 *    and a gate that counts the warnings as violations teaches people to
 *    delete the warnings.
 *
 * 2. **The de-fabricated services stay honest.** Each must still import
 *    `sourceUnavailable` and must not reintroduce a generator by any of the
 *    old names — `getMockABSData`, `generateEmploymentEstimate`,
 *    `generateBushfireEstimate` and the rest — nor a new one matching the
 *    generate/get + Mock/Estimate/Fallback naming shape returning data.
 *
 * The allowlist lives beside the other frozen baselines in
 * `supabase/functions-registry/`. Adding to it is a reviewed act, and the
 * entry's `purpose` is the review.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url` — the negative-test
// harness runs gates against a symlinked mirror with one file mutated, and a
// gate that resolves relative to its own location reads the real repository
// and passes on mutated source.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');
const ALLOWLIST_PATH = join(root, 'supabase', 'functions-registry', 'math-random-allowlist.json');

/** Comments carry the history of the removed fabricators; strip before counting. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
const errors = [];
const improvements = [];

// ── Part 1: the Math.random() ratchet ────────────────────────────────────────
const seen = new Map();
for (const file of walk(FUNC_DIR)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const src = stripComments(readFileSync(file, 'utf8'));
  const count = (src.match(/Math\.random\s*\(/g) ?? []).length;
  if (count > 0) seen.set(rel, count);
}

for (const [rel, count] of seen) {
  const entry = allowlist.entries[rel];
  if (!entry) {
    errors.push(
      `${rel}: ${count} Math.random() call(s) and no allowlist entry. A random number in a data-bearing `
      + `edge function is fabrication unless it is jitter, an id, or a rendering handle — name it and its `
      + `purpose in supabase/functions-registry/math-random-allowlist.json, or use real data / sourceUnavailable.`,
    );
  } else if (count > entry.count) {
    errors.push(
      `${rel}: Math.random() count grew ${entry.count} → ${count}. The allowlist is a ratchet; `
      + `a new occurrence needs its own reviewed purpose.`,
    );
  } else if (count < entry.count) {
    improvements.push(`${rel}: ${entry.count} → ${count}`);
  }
}
for (const rel of Object.keys(allowlist.entries)) {
  if (!seen.has(rel)) improvements.push(`${rel}: ${allowlist.entries[rel].count} → 0 (entry can be removed)`);
}

// ── Part 2: the de-fabricated services stay honest ───────────────────────────
/** The services whose only "data" used to be invented, and the names it wore. */
// `marker` is the honest-absence contract to require. The default is the
// shared envelope; risk-assessment is composite (a real AFRIP flood reading
// can stand beside an unavailable bushfire one), so its honesty lives in-band
// as `floodRiskUnavailable`/`bushfireRiskUnavailable` readings instead.
const DEFABRICATED = {
  'abs-data-service': ['generateEnhancedABSData', 'getPostcodeProfile', 'getMockABSData', 'getEstimatedIncome'],
  'abs-employment-service': ['generateEmploymentEstimate', 'generateEmploymentDetails', 'estimateLaborForce', 'estimateMedianIncome'],
  'abs-seifa-service': ['generateSEIFAEstimate'],
  'climate-data-service': ['generateClimateEstimate', 'getExtremeWeatherRisk', 'calculateComfortIndex'],
  'crime-statistics-service': ['generateEnhancedCrimeData', 'generateCrimeEstimate', 'getCrimeProfile'],
  'location-intelligence-service': ['generateMockLocationData'],
  'public-transport-service': ['generateFallbackData', 'fetchNSWTransportData', 'fetchVICTransportData'],
  'rba-data-service': ['getFallbackData'],
  'risk-assessment-service': { ghosts: ['generateBushfireEstimate', 'generateFloodEstimate'], marker: /RiskUnavailable\s*\(/ },
  'school-data-service': ['generateSchoolEstimates'],
};

for (const [service, spec] of Object.entries(DEFABRICATED)) {
  const ghosts = Array.isArray(spec) ? spec : spec.ghosts;
  const marker = Array.isArray(spec) ? /sourceUnavailable/ : spec.marker;
  const path = join(FUNC_DIR, service, 'index.ts');
  let src;
  try {
    src = stripComments(readFileSync(path, 'utf8'));
  } catch {
    continue; // a deleted service cannot fabricate
  }
  if (!marker.test(src)) {
    errors.push(`${service}: the honest-absence contract (${marker}) has been removed.`);
  }
  for (const ghost of ghosts) {
    // A definition or a call outside comments is the generator coming back.
    if (new RegExp(`\\b${ghost}\\s*\\(`).test(src)) {
      errors.push(`${service}: \`${ghost}\` is back. The fabricated-data generators were deleted on 2026-09-06; a source that cannot answer says so.`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`Fabricated-data check FAILED (${errors.length} violation(s)):\n`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

const total = [...seen.values()].reduce((a, b) => a + b, 0);
if (improvements.length) {
  console.log(`${improvements.length} file(s) improved on the allowlist:`);
  for (const i of improvements) console.log(` - ${i}`);
  console.log('Update math-random-allowlist.json to bank the improvement.');
}
console.log(
  `Fabricated-data check passed (${seen.size} file(s) with Math.random(), ${total} call(s), all allowlisted; `
  + `${Object.keys(DEFABRICATED).length} de-fabricated services verified honest).`,
);
