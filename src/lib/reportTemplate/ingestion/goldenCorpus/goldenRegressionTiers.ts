/**
 * Three-tier golden / regression testing taxonomy (Path-to-100 v2 · C10).
 *
 * Formalises the golden-corpus framework into three execution tiers with
 * explicit gates, so CI never accidentally runs the heavy or unsafe tiers:
 *
 *   - tier-1-pure    : deterministic vitest (renderer parity, policy, decisions,
 *                      diagnostics). Always in CI. No browser, no network.
 *   - tier-2-browser : Playwright/Chromium real-browser rendering — the checks
 *                      jsdom cannot make (actual layout/paint). Opt-in script,
 *                      not the default CI job. No network.
 *   - tier-3-live    : live corpus against real Supabase + Cloud Run, behind
 *                      `PDF_IMPORT_GOLDEN_LIVE=1`. Manual pre-release only. Reads
 *                      client PDFs from a local, git-excluded directory that is
 *                      NEVER committed.
 *
 * Pure and deterministic. The invariant `tierCiSafetyViolations()` proves that no
 * CI-running tier touches live services or the client corpus.
 */

export const GOLDEN_REGRESSION_TIERS_VERSION = 'golden-regression-tiers-v1';

export const PDF_IMPORT_GOLDEN_LIVE_FLAG = 'PDF_IMPORT_GOLDEN_LIVE';
export const PDF_IMPORT_GOLDEN_CORPUS_DIR_ENV = 'PDF_IMPORT_GOLDEN_CORPUS_DIR';

export type GoldenRegressionTierId = 'tier-1-pure' | 'tier-2-browser' | 'tier-3-live';
export type GoldenRegressionTrigger = 'always' | 'opt-in-script' | 'env-flag';

export interface GoldenRegressionTier {
  id: GoldenRegressionTierId;
  name: string;
  trigger: GoldenRegressionTrigger;
  /** The script / env var that activates the tier (null for `always`). */
  gate: string | null;
  /** Whether the default CI pipeline runs this tier. */
  runsInCi: boolean;
  /** Human-readable list of what the tier verifies. */
  covers: string[];
  /** May the tier reach real network / Supabase / Cloud Run? */
  usesLiveServices: boolean;
  /** May the tier read client PDFs (which are never committed)? */
  usesClientCorpus: boolean;
}

export const GOLDEN_REGRESSION_TIERS: Record<GoldenRegressionTierId, GoldenRegressionTier> = {
  'tier-1-pure': {
    id: 'tier-1-pure',
    name: 'Pure (vitest)',
    trigger: 'always',
    gate: null,
    runsInCi: true,
    covers: [
      'renderer parity (HTML/jsPDF/PPTX policy resolution)',
      'page output policy + per-page fidelity decisions',
      'quality-gate batching + coverage truthfulness',
      'diagnostics-v2 builders + failed-page categorization',
    ],
    usesLiveServices: false,
    usesClientCorpus: false,
  },
  'tier-2-browser': {
    id: 'tier-2-browser',
    name: 'Browser (Playwright/Chromium)',
    trigger: 'opt-in-script',
    gate: 'npm run test:e2e',
    runsInCi: false,
    covers: [
      'real-browser layout/paint of the reconstructed template',
      'raster-only page actually paints its source raster',
      'raster-only page suppresses native content in a real engine (not jsdom)',
    ],
    usesLiveServices: false,
    usesClientCorpus: false,
  },
  'tier-3-live': {
    id: 'tier-3-live',
    name: 'Live corpus',
    trigger: 'env-flag',
    gate: `${PDF_IMPORT_GOLDEN_LIVE_FLAG}=1`,
    runsInCi: false,
    covers: [
      'end-to-end import against real Supabase + Cloud Run',
      'full quality gate + repair + finalize on a real corpus',
    ],
    usesLiveServices: true,
    usesClientCorpus: true,
  },
};

export function isTruthyFlag(value: string | undefined | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/** True when the live tier is explicitly enabled via `PDF_IMPORT_GOLDEN_LIVE`. */
export function isGoldenLiveEnabled(env: Record<string, string | undefined> = {}): boolean {
  return isTruthyFlag(env[PDF_IMPORT_GOLDEN_LIVE_FLAG]);
}

export interface ResolveActiveTiersOptions {
  /** The Playwright browser project is running. */
  browser?: boolean;
}

/**
 * Resolve which tiers are active for a given environment. Tier 1 is always on;
 * Tier 2 only when the browser project runs; Tier 3 only behind the live flag.
 */
export function resolveActiveTiers(
  env: Record<string, string | undefined> = {},
  options: ResolveActiveTiersOptions = {},
): GoldenRegressionTierId[] {
  const active: GoldenRegressionTierId[] = ['tier-1-pure'];
  if (options.browser) active.push('tier-2-browser');
  if (isGoldenLiveEnabled(env)) active.push('tier-3-live');
  return active;
}

/**
 * Safety invariant: any tier the CI pipeline runs must not touch live services
 * or the client corpus. Returns the list of violations (empty when safe) so a
 * unit test can assert the taxonomy can never drift into leaking client PDFs or
 * hitting production from CI.
 */
export function tierCiSafetyViolations(): string[] {
  const violations: string[] = [];
  for (const tier of Object.values(GOLDEN_REGRESSION_TIERS)) {
    if (tier.runsInCi && tier.usesLiveServices) {
      violations.push(`${tier.id} runs in CI but uses live services`);
    }
    if (tier.runsInCi && tier.usesClientCorpus) {
      violations.push(`${tier.id} runs in CI but reads the client corpus`);
    }
  }
  return violations;
}
