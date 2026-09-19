/**
 * Do the four assessment readings reach all five reports?
 *
 * The owner's requirement is that the approved treatment goes through the
 * shared production components and the report-specific bindings, not only the
 * six-page review script. `projectInvestmentReport` is that shared component:
 * every one of the five tiers binds it, and `tierContent`'s policy decides
 * what each tier may publish. So the check is per tier, on one row, through
 * the real projection.
 *
 * It prints what each tier resolves, and fails if a reading that should be on
 * every tier is missing from one. Nothing here renders; it measures the
 * bindings the templates draw from.
 *
 *   npx tsx scripts/reports/s3TierBindings.mts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { projectInvestmentReport } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { REPORT_TIERS, type ReportTier } from '../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

const REPO = resolve(import.meta.dirname, '../..');
const row = JSON.parse(readFileSync(resolve(REPO, 'reports/fixtures/annabelle-row.json'), 'utf8'));

/**
 * Readings that describe the ASSESSMENT rather than the purchase, so every
 * tier may carry them — `tierContent` withholds financial modelling, not the
 * assessment's own account of itself.
 */
const ON_EVERY_TIER = [
  'measuredLine', 'measuredScore', 'measuredGrade',
  'coverageLabel', 'coveragePercent', 'criteriaMeasuredLine',
  'gradeCapped', 'capExplanation', 'conclusionLine', 'weightRoundingNote',
];

let missing = 0;
console.log(`\nrow ${row.id}  ·  stored tier ${row.report_tier ?? '(none)'}\n`);
for (const tier of REPORT_TIERS as readonly ReportTier[]) {
  const p = projectInvestmentReport(row, { tier });
  const rec = p.recommendation as Record<string, unknown>;
  const absent = ON_EVERY_TIER.filter((k) => rec[k] === undefined);
  const drawsModelling = (p.financials as Record<string, unknown>) && Object.keys(p.financials).length > 0;
  console.log(`  ${tier.padEnd(10)} ${absent.length === 0 ? 'all four readings bind' : `MISSING ${absent.join(', ')}`}`);
  console.log(`             measured=${String(rec.measuredLine)}  coverage=${String(rec.coverageLabel)} `
    + `criteria=${String(rec.criteriaMeasuredLine)}  issued=${String(rec.grade)}  capped=${String(rec.gradeCapped)}`);
  console.log(`             conclusion: ${String(rec.conclusionLine)}`);
  console.log(`             financial modelling published: ${drawsModelling}  (${Object.keys(p.financials).length} bindings)`);
  if (absent.length) missing += 1;
}
console.log(`\n${missing === 0 ? 'every tier binds every reading' : `${missing} tier(s) missing a reading`}\n`);
process.exitCode = missing === 0 ? 0 : 1;
