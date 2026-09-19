/**
 * Measure what a narrative (markdown-block) page actually holds.
 *
 * The paging arithmetic in `_shared/reports/markdownPaging.pure.ts` and the
 * per-block line charges in `_shared/reports/markdown.pure.ts` decide where a
 * narrative page breaks. Those numbers were pinned by render once — against the
 * Report Q&A fixtures — and this repo's own rule is that such constants are
 * *measured, never reasoned* (`LINES_PER_PAGE`'s header says exactly that).
 * This script is the measuring instrument, kept, so the next calibration is a
 * command rather than an afternoon.
 *
 * Probes A–C render through the REAL Investment Compass master (Private
 * Banking — Chancery, the seeded production default) with the pager in charge,
 * so they show what the pager sends to a page. With `--box`, probes D lift the
 * per-block bucket cap to 999 so the PAGE GEOMETRY decides where content stops
 * being visible — that is the true capacity the pager should be filling.
 *
 * The 2026-09 calibration this instrument produced (recorded because the
 * constants in `markdownPaging.pure.ts` derive from it):
 *
 *   A · pager sent 17 one-line paragraphs per page; D showed 40 fit → 42% fill
 *   B · prose wraps at ~98 characters per rendered line (constant said 65)
 *   D · continuation page ≈ 54.5 rendered line-units; first narrative page
 *       ≈ 42 (part-header furniture); heading+line pairs ≈ 15 per page
 *
 * Requires: `pip install weasyprint==69.0` (the pinned engine) and poppler's
 * pdftotext on PATH. Run: `npx tsx scripts/reports/markdownCalibration.mts [--box]`.
 * Output PDFs land in `reports/calibration/` for eyes as well as arithmetic.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { renderTemplateToHtml } from '../../src/lib/reportTemplate/htmlRenderer';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { renderMarkdown } from '../../supabase/functions/_shared/reports/markdown.pure';
import { packMarkdownPages } from '../../supabase/functions/_shared/reports/markdownPaging.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const REPO = resolve(import.meta.dirname, '../..');
const OUT = join(REPO, 'reports/calibration');
mkdirSync(OUT, { recursive: true });

// A 1×1 valid PNG so image blocks render without a network fetch.
const MARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

const ORG = {
  company_name: 'Calibration Probe Pty Ltd',
  email_signature_phone: '02 0000 0000',
  email_signature_email: 'probe@example.com',
  email_signature_website: 'example.com',
  email_signature_address: '1 Probe Street',
};

const chancery = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.name === 'Chancery');
if (!chancery) throw new Error('Chancery master not found in catalogue source');

const PROSE_390 = ('Riverbank settlements along the estuary widened steadily as ferries, market gardens and '
  + 'timber mills drew workers whose cottages later became the tightly held streets buyers now '
  + 'compare against newer estates further inland, and the pattern repeats in every coastal town '
  + 'with a working harbour, a school and one road out.').slice(0, 390);

function dataWithNarrative(narrative: string): Record<string, any> {
  const row = {
    id: 'probe',
    property_address: '1 Probe Street',
    property_specs: {},
    financial_calculations: null,
    investment_score: null,
    report_content: narrative,
    updated_at: new Date('2026-01-01').toISOString(),
  };
  const data: Record<string, any> = {
    report: { id: 'probe', type: 'investment' },
    property: {}, financials: {}, scores: {}, demographics: {}, economic: {},
    location: {}, sections: {}, sources: {}, overrides: {},
    brand: { tokens: {}, logo: null },
  };
  applyInvestmentProjection(data, row as any);
  applyOrganisationProjection(data, ORG as any, { mark: MARK, markMono: MARK } as any);
  return data;
}

/** Deep-clone the master with every markdown block's bucket cap lifted. */
function boxSchema(): any {
  const clone = structuredClone(chancery!.schema) as any;
  let patched = 0;
  for (const page of clone.pages ?? []) {
    for (const b of page.blocks ?? []) {
      const props = b?.props ?? b?.config;
      if (b?.type === 'markdown-block' && props) { props.linesPerPage = 999; patched++; }
    }
  }
  if (!patched) throw new Error('no markdown blocks found to patch');
  return clone;
}

function renderToPdf(name: string, narrative: string, schema: unknown = chancery!.schema): string {
  const { html } = renderTemplateToHtml(schema, {
    data: dataWithNarrative(narrative),
    fontSource: 'container',
  });
  const htmlPath = join(OUT, `${name}.html`);
  const pdfPath = join(OUT, `${name}.pdf`);
  writeFileSync(htmlPath, html);
  execFileSync('python3', ['-m', 'weasyprint', htmlPath, pdfPath], { stdio: 'pipe' });
  return pdfPath;
}

/** pdftotext -layout, split into per-page arrays of non-empty lines. */
function pageLines(pdf: string): string[][] {
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  return txt.split('\f').map((p) => p.split('\n').filter((l) => l.trim().length > 0));
}

function tokensPerPage(pdf: string, token: RegExp): number[] {
  return pageLines(pdf)
    .filter((p) => p.some((l) => token.test(l)))
    .map((p) => p.join(' ').match(token)?.length ?? 0);
}

const report: string[] = [];
const say = (s: string) => { report.push(s); console.log(s); };

// ── Probe A: single-line paragraphs, pager in charge ────────────────────────
{
  const src = Array.from({ length: 160 }, (_, i) => `P${String(i + 1).padStart(3, '0')} alpha beta.`).join('\n\n');
  const pdf = renderToPdf('probe-a-paragraphs', src);
  const perPage = tokensPerPage(pdf, /P\d{3}/g);
  const charged = packMarkdownPages(renderMarkdown(src).blocks).map((pg) => pg.length);
  say(`A · single-line paragraphs — rendered per page: [${perPage.join(', ')}]`);
  say(`A · pager put per page: [${charged.join(', ')}]`);
}

// ── Probe B: fixed-width prose, to measure characters per rendered line ─────
{
  const src = Array.from({ length: 42 }, (_, i) => `B${String(i + 1).padStart(2, '0')}. ${PROSE_390}`).join('\n\n');
  const pdf = renderToPdf('probe-b-prose', src);
  const pages = pageLines(pdf).filter((p) => p.some((l) => /B\d{2}\./.test(l)));
  const first = pages[1] ?? pages[0];
  const idx = first.map((l, i) => (/B\d{2}\./.test(l) ? i : -1)).filter((i) => i >= 0);
  const spans = idx.slice(1).map((v, i) => v - idx[i]);
  const linesPerPara = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : 0;
  say(`B · 390-char paragraph wraps to ~${linesPerPara} rendered lines → ~${Math.round(390 / Math.max(1, linesPerPara))} chars/line`);
  say(`B · paragraphs per page (pager in charge): [${pages.map((p) => p.join(' ').match(/B\d{2}\./g)?.length ?? 0).join(', ')}]`);
}

// ── Probe C: heading + one-liner pairs, pager in charge ─────────────────────
{
  const src = Array.from({ length: 60 }, (_, i) => `### H${String(i + 1).padStart(2, '0')} heading\n\nH${String(i + 1).padStart(2, '0')}x body.`).join('\n\n');
  const pdf = renderToPdf('probe-c-headings', src);
  say(`C · heading+line pairs per page (pager in charge): [${tokensPerPage(pdf, /H\d{2}x/g).join(', ')}]`);
}

// ── Probes D: the box itself, bucket cap lifted ─────────────────────────────
if (process.argv.includes('--box')) {
  const schema = boxSchema();
  {
    const src = Array.from({ length: 240 }, (_, i) => `Q${String(i + 1).padStart(3, '0')} alpha beta.`).join('\n\n');
    const pdf = renderToPdf('probe-d-box-paras', src, schema);
    say(`D · one-line paragraphs VISIBLE per page: [${tokensPerPage(pdf, /Q\d{3}/g).join(', ')}]`);
  }
  {
    const src = Array.from({ length: 60 }, (_, i) => `R${String(i + 1).padStart(2, '0')}. ${PROSE_390}`).join('\n\n');
    const pdf = renderToPdf('probe-d-box-prose', src, schema);
    say(`D · 390-char paragraphs VISIBLE per page: [${tokensPerPage(pdf, /R\d{2}\./g).join(', ')}]`);
  }
  {
    const src = Array.from({ length: 80 }, (_, i) => `### G${String(i + 1).padStart(2, '0')} heading\n\nG${String(i + 1).padStart(2, '0')}x body.`).join('\n\n');
    const pdf = renderToPdf('probe-d-box-headings', src, schema);
    say(`D · heading+line pairs VISIBLE per page: [${tokensPerPage(pdf, /G\d{2}x/g).join(', ')}]`);
  }
}

writeFileSync(join(OUT, 'calibration.txt'), report.join('\n') + '\n');
say(`\nwritten → ${join(OUT, 'calibration.txt')} (PDFs beside it for reading)`);
