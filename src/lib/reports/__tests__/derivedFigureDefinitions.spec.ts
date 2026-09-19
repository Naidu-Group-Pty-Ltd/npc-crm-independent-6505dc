/**
 * A ratchet on the number of places that define a derived figure.
 *
 * Gross yield, net yield and LVR are each computed inline in more than a
 * dozen modules. That is not, by itself, a bug — most of the divergence is a
 * real distinction between two quantities that had never been given separate
 * names (yield on the purchase price versus yield on today's value;
 * origination LVR versus current LVR), which is why
 * `_shared/reports/metrics/propertyMetrics.pure.ts` names them rather than
 * collapsing them, and why nothing here rewrites a working call site.
 *
 * What it is is a slope. Stamp duty had exactly this shape and went from four
 * copies to four DIFFERENT answers — a South Australian band, three Tasmanian
 * rates and a quadratic Northern Territory modelled as linear — before anyone
 * compared them. This test does not forbid the copies that exist; it fixes
 * their number, so the next one has to be a decision somebody makes rather
 * than a line somebody adds.
 *
 * Adding an entry, or raising a count, is not automatically wrong. It is a
 * question with an answer: could this call the canonical module instead? If it
 * genuinely could not — because the quantity is different, or the shape of the
 * inputs is different — say which in the commit and move the number.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const ROOTS = ['src', 'supabase/functions', 'scripts'];

/**
 * A figure named for what it is, assigned from a division scaled to a
 * percentage. Deliberately narrow: it wants definitions, not readers, so a
 * line that merely prints or compares an existing yield does not count.
 */
const DEFINITION =
  /(?:gross[A-Za-z_]*[Yy]ield|net[A-Za-z_]*[Yy]ield|\blvr\b|loanToValue)[A-Za-z_]*\s*[:=]\s*[^;=]*\/[^;]*100/;

/** The canonical module is the point; its own spec exercises it. */
const EXEMPT = /(__tests__|\.spec\.|\.test\.|propertyMetrics\.pure)/;

/**
 * Measured 2026-09-07; `CashFlowAnalysisModal` / `projectionEngine` re-measured
 * 2026-09-08. See the header before changing a number here.
 *
 * That one movement is a ratchet DOWN, and it is the answer to the question
 * the header asks. The modal held 8 definitions because it held the 10-year
 * projection TWICE — once for the report a client receives and once for the
 * properties it is compared against — so gross yield, net yield and LVR were
 * each written out twice in one file. The two engines are now one,
 * `src/lib/cashFlow/projectionEngine.pure.ts`, and the same three figures are
 * defined once: 8 becomes 4, and the modal leaves this list entirely.
 *
 * They stay defined there rather than calling `propertyMetrics.pure.ts`
 * because the engine's quantities are the CURRENT-year ones — rent and
 * expenses against the year's grown value, and the amortised balance against
 * it — computed inside the chained loop that produces them, which is the
 * distinction that module exists to keep rather than collapse.
 */
const FROZEN = new Map<string, number>([
  ['src/components/borrowing-capacity/scenarios/AdditionalStrategyLevers.tsx', 1],
  ['src/components/borrowing-capacity/scenarios/StrategyScenarioModeling.tsx', 1],
  ['src/components/clients/PropertyReportGenerator.tsx', 3],
  ['src/components/clients/review-wizard/useReviewWizard.ts', 3],
  ['src/components/finance-portal/CalculatorsTab.tsx', 1],
  // RC-3.1 moved the Investment drawing out of the React component into this
  // module, unchanged. The definition MOVED — the ratchet does not go up.
  ['src/lib/reports/investment/investmentPdfDocument.ts', 1],
  ['src/components/reports/manual-inputs/IncomeExpensesTab.tsx', 1],
  ['src/lib/cashFlow/investmentMetrics.pure.ts', 1],
  ['src/lib/cashFlow/projectionEngine.pure.ts', 4],
  ['src/lib/reports/cashFlow/liveProjectionRow.ts', 1],
  ['src/lib/templateLibrary/sampleReportData.ts', 9],
  ['src/pages/portal/PortalPropertyInsights.tsx', 1],
  ['supabase/functions/_shared/calculators.ts', 1],
  ['supabase/functions/_shared/reports/cashFlow/normalise.pure.ts', 2],
  ['supabase/functions/_shared/reports/clientDetails/normalise.pure.ts', 1],
  ['supabase/functions/_shared/reports/investment/financialEngine.pure.ts', 5],
  ['supabase/functions/ai-dashboard-agent/index.ts', 5],
  ['supabase/functions/finance-portal-batch8/index.ts', 1],
  ['supabase/functions/financial-calculator-service/index.ts', 2],
  ['supabase/functions/financial-validation-service/index.ts', 1],
  ['supabase/functions/generate-portfolio-analysis/index.ts', 2],
  ['supabase/functions/investment-scoring-service/index.ts', 1],
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function inventory(): Map<string, number> {
  const found = new Map<string, number>();
  for (const root of ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (EXEMPT.test(rel)) continue;
      const hits = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => DEFINITION.test(line)).length;
      if (hits) found.set(rel, hits);
    }
  }
  return found;
}

describe('derived figures are defined in a fixed set of places', () => {
  const found = inventory();

  it('names no module the baseline has not already accounted for', () => {
    const strangers = [...found.keys()].filter((f) => !FROZEN.has(f)).sort();
    expect(strangers).toEqual([]);
  });

  it('does not add a definition to a module that already has some', () => {
    const grown = [...found].filter(([f, n]) => (FROZEN.get(f) ?? 0) < n)
      .map(([f, n]) => `${f}: ${FROZEN.get(f) ?? 0} → ${n}`).sort();
    expect(grown).toEqual([]);
  });

  it('the baseline names nothing that has since gone (ratchet down, never up)', () => {
    // A file that lost its last definition should leave the list, so the
    // number keeps meaning what it says.
    const gone = [...FROZEN.keys()].filter((f) => !found.has(f)).sort();
    expect(gone).toEqual([]);
  });
});
