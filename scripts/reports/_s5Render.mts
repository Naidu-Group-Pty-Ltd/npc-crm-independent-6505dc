/**
 * One render step for the whole S5 suite.
 *
 * Ten documents — a Compass, a Financial, a Due Diligence, an Executive
 * Briefing and a Snapshot, for two properties — are compared against each
 * other in this stage: page counts, body fill, PDF/UA-1, and whether a defect
 * found in one is present in the others. That comparison is only sound if
 * every document reaches the paper the same way, so the projection, the
 * organisation stamp, the compile and the engine call live here rather than
 * three times across `s5CompassReports`, `s5ForkReports` and
 * `s5CondenseReports`.
 *
 * It is the supported path: `applyInvestmentProjection` +
 * `applyOrganisationProjection` into an Investment Compass master, then
 * `compileTemplateHtmlForPdf` (which forces the container as the font source),
 * then WeasyPrint through `renderWeasy.py` on the six options the production
 * route sends. The flowing renderer is the fallback and draws a DIFFERENT
 * document, so nothing here may fall back to it silently.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

export const REPO = resolve(import.meta.dirname, '../..');

/** `reports/` is git-ignored, so a fresh checkout has to fetch the fixtures. */
export function readFixture(path: string): any {
  try {
    return JSON.parse(readFileSync(resolve(REPO, path), 'utf8'));
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    throw new Error(`${path} is not present. It is read from production and \`reports/\` is git-ignored.`);
  }
}

const MARK = readFileSync(resolve(REPO, 'reports/fixtures/mark-monogram.txt'), 'utf8').trim();
const SETTINGS = readFixture('reports/fixtures/report-settings.meta.json');
const ORG = { company_name: 'Naidu Property Consulting Services' };
const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});

/** The Chancery master — one design across all ten, so the design is not a variable. */
export const TEMPLATE = INVESTMENT_COMPASS_TEMPLATES.find(
  (t) => String((t as never as { slug?: string }).slug ?? '').includes('-pb-01-'),
)! as never as { name: string; slug?: string; schema: unknown };

export interface Drawn {
  name: string;
  pages: string;
  /** Engine warnings beyond the two every run emits. */
  warnings: number;
}

/** Project a stored row, bind it, compile it, and draw it on the print contract. */
export async function drawReportRow(row: Record<string, unknown>, name: string): Promise<Drawn> {
  mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
  mkdirSync(resolve(REPO, 'reports/pdf'), { recursive: true });

  const data: Record<string, any> = {
    report: { id: row.id, type: 'investment', generated_at: row.updated_at },
    property: flat(row.property_specs),
    financials: flat(row.financial_calculations),
    scores: flat(row.investment_score),
    brand: { tokens: {}, logo: null },
  };
  applyInvestmentProjection(data, row as never);
  applyOrganisationProjection(data, ORG as never, { mark: MARK, markMono: MARK }, SETTINGS as never);
  data.narrative = { ...(data.narrative ?? {}), source: row.report_content };

  const compiled = await compileTemplateHtmlForPdf(TEMPLATE.schema as never, { data });
  const htmlPath = resolve(REPO, `reports/html/${name}.html`);
  const pdfPath = resolve(REPO, `reports/pdf/${name}.pdf`);
  writeFileSync(htmlPath, compiled.html);
  writeFileSync(resolve(REPO, `reports/html/${name}.md`), String(row.report_content ?? ''));
  const render = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), htmlPath, pdfPath], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const warnings = render.split('\n').filter((l) => l.startsWith('warning\t')).length;
  const pages = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1] ?? '—';
  return { name, pages, warnings };
}

export const headingsOf = (md: string): string[] =>
  [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
