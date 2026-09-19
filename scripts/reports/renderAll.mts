/**
 * Render every format, measure every page, and print one table.
 *
 * ```
 *   npx tsx scripts/reports/renderAll.mts [--only <format>[,<format>]] [--keep <dir>] [--skip-specs]
 * ```
 *
 * `critique.mts` takes one document at a time and is the right tool when you
 * are iterating on one. This is the fan-out over it, and it exists because of
 * a fact that was easy to miss: of the ten formats in this programme, exactly
 * two had ever been rendered and looked at. The other eight were asserted with
 * `toContain` against an in-memory string, which cannot see a page.
 *
 * The pipeline is:
 *
 *   1. run the render specs, which write `reports/html/<archetype>.html`
 *      (see `src/lib/reports/__tests__/renderArtifact.ts`),
 *   2. WeasyPrint each one to `reports/pdf/<archetype>.pdf`,
 *   3. `measure_pages.py` over each PDF,
 *   4. `judgeDocument` over each measurement,
 *   5. one table: pages, median ink, findings by severity.
 *
 * The table is the point, not the exit code. The mechanical rubric is a floor —
 * every real defect this programme has fixed was found by a person or the
 * `report-critic` agent *looking* at the page images, which this leaves on
 * disk. The ink column is the fastest signal: a natively designed page in this
 * design system measures **0.133 to 0.221**. A document whose body pages sit at
 * 0.05 is not sparse in one place, it has no page economy at all.
 *
 * Exits non-zero if any document produces a `high` finding, so it can gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  critiquePasses,
  describeCritique,
  judgeDocument,
  type CritiqueFinding,
  type DocumentMeasurement,
} from '../../supabase/functions/_shared/reports/critique.pure.ts';

const REPO = resolve(import.meta.dirname, '../..');
const HTML_DIR = join(REPO, 'reports/html');
const PDF_DIR = join(REPO, 'reports/pdf');

/**
 * The ten formats, by archetype id, each with the spec that writes its HTML.
 *
 * Declared rather than globbed so that a format whose spec silently stopped
 * writing its artefact is a missing row in the table rather than a document
 * nobody notices is absent. That is the failure mode this whole harness exists
 * to end.
 */
const FORMATS: ReadonlyArray<{ id: string; spec: string }> = [
  { id: 'borrowing-capacity', spec: 'src/lib/reports/borrowingCapacity/__tests__/render.spec.ts' },
  { id: 'cash-flow-projection', spec: 'src/lib/reports/cashFlow/__tests__/render.spec.ts' },
  { id: 'cash-flow-comparison', spec: 'src/lib/reports/cashFlowComparison/__tests__/render.spec.ts' },
  { id: 'client-details', spec: 'src/lib/reports/clientDetails/__tests__/render.spec.ts' },
  { id: 'commercial-capacity', spec: 'src/lib/reports/commercialCapacity/__tests__/render.spec.ts' },
  { id: 'investment-compass', spec: 'src/lib/reports/investment/__tests__/render.spec.ts' },
  { id: 'market-intelligence', spec: 'src/lib/reports/marketIntelligence/__tests__/render.spec.ts' },
  { id: 'portfolio-performance', spec: 'src/lib/reports/portfolio/__tests__/render.spec.ts' },
  { id: 'property-comparison', spec: 'src/lib/reports/propertyComparison/__tests__/render.spec.ts' },
  { id: 'report-qa', spec: 'src/lib/reports/reportQa/__tests__/render.spec.ts' },
  { id: 'converted', spec: 'src/lib/reports/converted/__tests__/converter.spec.ts' },
  // Not a report, and the only client-facing document here that a *partner*
  // receives rather than a client. It is in this table because it is rendered
  // by the same stylesheet and has the same way of going wrong — and because
  // for its first two months nobody could look at it without a database.
  { id: 'partner-agreement', spec: 'src/lib/reports/partnerAgreement/__tests__/render.spec.ts' },
];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const wanted = only ? FORMATS.filter((f) => only.includes(f.id)) : FORMATS;
if (!wanted.length) {
  console.error(`no format matched --only ${only?.join(',')}`);
  console.error(`known: ${FORMATS.map((f) => f.id).join(', ')}`);
  process.exit(2);
}

const workRoot = flag('keep') ?? join(REPO, 'reports/pages');
mkdirSync(workRoot, { recursive: true });
mkdirSync(PDF_DIR, { recursive: true });

// ── 1. The specs, which are what actually write the HTML ────────────────────

if (!has('skip-specs')) {
  console.log(`Running ${wanted.length} render spec${wanted.length === 1 ? '' : 's'}…`);
  try {
    execFileSync('npx', ['vitest', 'run', ...wanted.map((f) => f.spec)], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // A failing assertion still leaves the artefacts on disk, because they are
    // written in `beforeAll`. Worth continuing to the render, and worth saying.
    console.error('⚠ some render specs failed; the documents below are still from this run.');
    const out = (err as { stdout?: string }).stdout ?? '';
    for (const line of out.split('\n').filter((l) => /FAIL|AssertionError/.test(l)).slice(0, 12)) {
      console.error(`  ${line.trim()}`);
    }
  }
}

// ── 2-4. Render, measure, judge ─────────────────────────────────────────────

interface Row {
  id: string;
  pages: number;
  medianInk: number;
  inBand: number;
  findings: CritiqueFinding[];
  images: string;
  warnings: string;
}

/** The band a natively designed page in this design system measures at. */
const INK_BAND: readonly [number, number] = [0.133, 0.221];

const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const rows: Row[] = [];
const missing: string[] = [];

for (const format of wanted) {
  const html = join(HTML_DIR, `${format.id}.html`);
  if (!existsSync(html)) {
    missing.push(format.id);
    continue;
  }

  const pdf = join(PDF_DIR, `${format.id}.pdf`);
  let warnings = '';
  try {
    // Warnings on stderr are a finding in their own right — "Ignored
    // `box-shadow`" is how an effect goes missing unnoticed — so they are kept
    // and counted rather than swallowed.
    const out = execFileSync('weasyprint', [html, pdf], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    warnings = out.trim();
  } catch (err) {
    console.error(`✗ ${format.id}: WeasyPrint failed`);
    console.error(String((err as { stderr?: string }).stderr ?? err).trim().split('\n').slice(-6).join('\n'));
    continue;
  }

  const images = join(workRoot, format.id);
  const measured = execFileSync('python3', [
    join(REPO, 'scripts/reports/measure_pages.py'), pdf,
    '--dpi', '72',
    '--images', images,
  ], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

  const doc = JSON.parse(measured) as DocumentMeasurement & {
    pages: Array<{ page: number; inkCoverage: number }>;
  };
  const findings = judgeDocument(doc);

  // The cover and the closing page are full-bleed fields by design and would
  // drag the median to nothing; the band is about body pages.
  const body = doc.pages.slice(1, -1).map((p) => p.inkCoverage);
  rows.push({
    id: format.id,
    pages: doc.pages.length,
    medianInk: median(body),
    inBand: body.filter((v) => v >= INK_BAND[0] && v <= INK_BAND[1]).length,
    findings,
    images,
    warnings,
  });
}

// ── 5. The table ────────────────────────────────────────────────────────────

const sev = (findings: readonly CritiqueFinding[], level: string) =>
  findings.filter((f) => f.severity === level).length;

const pad = (s: string, n: number) => s.padEnd(n);
const num = (s: string, n: number) => s.padStart(n);

const NAME_W = Math.max(8, ...rows.map((r) => r.id.length));
console.log(`\n${pad('format', NAME_W)}  ${num('pp', 3)}  ${num('median', 6)}  ${num('in band', 8)}  ${num('high', 4)}  ${num('med', 4)}  ${num('low', 4)}`);
console.log('─'.repeat(NAME_W + 40));

for (const r of rows) {
  const bodyPages = Math.max(0, r.pages - 2);
  const inkFlag = r.medianInk < INK_BAND[0] ? ' ↓' : r.medianInk > INK_BAND[1] ? ' ↑' : '  ';
  console.log(
    `${pad(r.id, NAME_W)}  ${num(String(r.pages), 3)}  ${num(r.medianInk.toFixed(3), 6)}${inkFlag}`
    + `${num(`${r.inBand}/${bodyPages}`, 6)}  ${num(String(sev(r.findings, 'high')), 4)}`
    + `  ${num(String(sev(r.findings, 'medium')), 4)}  ${num(String(sev(r.findings, 'low')), 4)}`,
  );
}

if (missing.length) {
  console.log(`\n⚠ no HTML artefact for: ${missing.join(', ')}`);
  console.log('  Its render spec did not write one. See src/lib/reports/__tests__/renderArtifact.ts.');
}

for (const r of rows) {
  if (!r.findings.length && !r.warnings) continue;
  console.log(`\n── ${r.id} ${'─'.repeat(Math.max(0, 60 - r.id.length))}`);
  console.log(`   images: ${r.images}`);
  if (r.warnings) {
    console.log('   engine warnings:');
    for (const line of r.warnings.split('\n').slice(0, 8)) console.log(`     ${line}`);
  }
  if (r.findings.length) console.log(describeCritique(r.findings));
}

console.log(
  `\n${rows.length} document${rows.length === 1 ? '' : 's'} · page images under ${workRoot}`
  + `\nThe rubric is a floor. Read the pages — that is where every real defect in this programme was found.`,
);

const clean = rows.every((r) => critiquePasses(r.findings));
process.exit(clean && !missing.length ? 0 : 1);
