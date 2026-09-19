/**
 * The Annabelle document through the FLOWING renderer, from its stored row.
 *
 * ## Why this is a script and not a spec
 *
 * It was a spec, and CI proved that wrong: it loads
 * `reports/fixtures/annabelle-row.json`, which is a real customer's row held
 * locally and gitignored, so the file exists on the machine that wrote the
 * test and can never exist on a runner. It passed locally and failed CI with
 * `ENOENT` — a gate that only ever ran where it could not fail.
 *
 * A check that cannot run in CI is not a check. This is a local render
 * harness, so it lives with the other ones and says what it needs.
 *
 *   npx tsx scripts/reports/s1Annabelle.mts
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildInvestmentReport } from '../../src/lib/reports/investment/normalise.pure';
import { renderInvestmentFromBrand } from '../../src/lib/reports/investment/render.pure';
import { buildReportBrandSnapshot } from '../../src/lib/reportDesign/snapshot.pure';

const REPO = resolve(import.meta.dirname, '../..');
const FIXTURE = resolve(REPO, 'reports/fixtures/annabelle-row.json');
if (!existsSync(FIXTURE)) {
  console.error(
    `No local fixture at ${FIXTURE}.\n`
    + 'This harness reads a real stored row that is deliberately not committed. '
    + 'Export it read-only into reports/fixtures/ before running.',
  );
  process.exit(2);
}

const ROW = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
const PREPARED_ON = '2026-09-17';

const { snapshot } = buildReportBrandSnapshot({
  contact: {
    company_name: 'Naidu Property Consulting Services',
    abn: '50 684 555 771',
    email: 'admin@npcservices.com.au',
    phone: '02 8609 3299',
  },
  capturedAt: PREPARED_ON,
} as never);

const built = buildInvestmentReport({ row: ROW, preparedOn: PREPARED_ON });
if (built.ok === false) throw new Error(`normalise failed: ${built.error}`);
const out = renderInvestmentFromBrand({
  report: built.report,
  snapshot,
  projectionsRaw: (ROW.financial_calculations as Record<string, unknown> | null)?.projections ?? null,
});

mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
const htmlPath = resolve(REPO, 'reports/html/s1-annabelle.html');
writeFileSync(htmlPath, out.html);

// The two things that would make the artefact worthless if they failed.
const problems: string[] = [];
if (!out.html.includes('Annabelle')) problems.push('the document does not name its subject');
if (out.html.length <= 20_000) problems.push(`the document is ${out.html.length} bytes, which is not a report`);

console.log(`${out.html.length} bytes, ${out.chapters.length} chapters`);
console.log(`chapters: ${out.chapters.join(' | ')}`);
console.log(htmlPath);
for (const p of problems) console.log(`  PROBLEM  ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
