/**
 * Does real production text fit the boxes the masters declare?
 *
 * ## Why this is not `templates:compass:qa`
 *
 * That harness measures the same boxes, but it renders `SAMPLE_REPORT_DATA` —
 * fixture data written in the catalogue's own vocabulary. `CLAUDE.md` is blunt
 * about what that is worth: a check against the sample "passes while production
 * is empty", and it is exactly how two formats shipped a cover with no title.
 * A fixture is written by the same person who wrote the template, so it tends
 * to be the length the author assumed.
 *
 * This renders the **stored production row** through the format's own
 * projection — the same call the adapter makes — and measures where the ink
 * actually lands. A declared height is a promise the renderer keeps only if the
 * text is as short as the author assumed; when it is not, the block does not
 * overflow the page, it prints over the next one, and `flow()`'s arithmetic
 * cannot see that because `flow()` is what placed them.
 *
 * ## It measures the tight variants, not all fifty
 *
 * Within a family the five variants differ in structure, and the third is the
 * spacious one: `pb-03`, `le-03` and `ap-03` set the same characters into more
 * vertical space than their siblings. When the Property Comparison risk
 * register was resized, those three were the *only* variants that overflowed —
 * the other twenty-seven took the same budget. So the `-03`s are the binding
 * constraint, and measuring them is what decides whether a budget fits.
 *
 * `npm run templates:production-fit`.
 */
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { renderTemplateToHtml } from '../../src/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '../../src/lib/reportTemplate/bindingResolver';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyBorrowingCapacityProjection } from '../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import { applyPortfolioProjection } from '../../supabase/functions/_shared/portfolioProjection.pure';
import { applyComparisonProjection } from '../../supabase/functions/_shared/comparisonProjection.pure';
import { applyCashFlowProjection } from '../../supabase/functions/_shared/cashFlowProjection.pure';
import { applyClientDetailsProjection } from '../../supabase/functions/_shared/clientDetailsProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { applyReportQaProjection } from '../../supabase/functions/_shared/reportQaProjection.pure';
import { applyCommercialCapacityProjection } from '../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { applyMarketIntelligenceProjection } from '../../supabase/functions/_shared/marketIntelligenceProjection.pure';
import { buildClientDetails } from '../../supabase/functions/_shared/reports/clientDetails/normalise.pure';
import { buildReportQaDocument } from '../../supabase/functions/_shared/reports/reportQa/normalise.pure';
import { buildCapacitySnapshot } from '../../supabase/functions/_shared/reports/commercialCapacity/normalise.pure';
import { buildMarketIntelligenceReport } from '../../supabase/functions/_shared/reports/marketIntelligence/normalise.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from './investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from './investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from './investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from './investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from './investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from './investmentCompass/clientDetails';
import { REPORT_QA_TEMPLATES } from './investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from './investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from './investmentCompass/marketIntelligence';

const SCRATCH = process.env.FIXTURES
  ?? '/tmp/claude-0/-home-user/2d1fcc99-8bfb-51aa-8aa3-79bd8050091a/scratchpad';

const ROWS = JSON.parse(readFileSync(`${SCRATCH}/format-rows.json`, 'utf8'));

/**
 * A settings row shaped like the one the adapter loads.
 *
 * The column names matter: `projectOrganisation` reads `company_name` and the
 * `email_signature_*` group, and guessing them wrong makes every `org.*` path
 * look unresolved — which is what it did on the first run of this audit.
 */
const ORG = {
  company_name: 'NPC Services',
  email_signature_phone: '03 9000 0000',
  email_signature_email: 'hello@npcservices.com.au',
  email_signature_website: 'npcservices.com.au',
  email_signature_address: '1 Collins Street, Melbourne VIC 3000',
};

const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});

/**
 * A stand-in brand mark, so the cover is measured with one on it.
 *
 * A 1x1 PNG: this harness measures boxes, and the box is fixed by the template
 * rather than by the picture inside it. What matters is that the image block
 * renders at all, because the head is moved down to clear it either way.
 */
const MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
  + 'AAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MARKS = { mark: MARK, markMono: MARK };

function investmentData(row: any): Record<string, any> {
  const data: Record<string, any> = {
    report: { id: row.id, type: 'investment', generated_at: row.updated_at },
    property: flat(row.property_specs),
    financials: flat(row.financial_calculations),
    scores: flat(row.investment_score),
    demographics: flat(row.demographics_data),
    economic: flat(row.economic_data),
    location: flat(row.location_intelligence),
    sections: {},
    sources: flat(row.sources_content),
    overrides: flat(row.manual_overrides),
    brand: { tokens: {}, logo: null },
  };
  applyInvestmentProjection(data, row);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function borrowingData(row: any): Record<string, any> {
  const data: Record<string, any> = { report: {}, assessment: row, brand: {} };
  /*
   * The longest applicant name the cover can be asked to set.
   *
   * The adapter joins `clients` for this; the fixture row here does not carry
   * it, so the worst realistic name is supplied instead. The longest primary
   * name in production is 27 characters — this is 24 longer, so the eyebrow is
   * measured past the end of the record rather than at it.
   */
  applyBorrowingCapacityProjection(data, row, {
    primary_first_name: 'Christopher', primary_surname: 'Papadopoulos',
  });
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function portfolioData(row: any): Record<string, any> {
  const data: Record<string, any> = { report: {}, analysis: row, brand: {} };
  // The client's newest completed review, joined exactly as
  // `render-portfolio-review-pdf` joins it — the fixture carries the real one,
  // so the review, scenario and verdict-score pages render and are measured.
  applyPortfolioProjection(data, row, ROWS.portfolio_review ?? null);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function comparisonData(row: any): Record<string, any> {
  const data: Record<string, any> = { report: {}, analysis: row, brand: {} };
  applyComparisonProjection(data, {
    row, clientName: undefined, notes: [], now: new Date('2026-08-13').toISOString(),
  } as any);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

/*
 * The three model-authored formats.
 *
 * Their rows are far larger than the others — one stored Market Intelligence
 * report is 305 KB and a Q&A conversation reaches 4 MB — and they are the ones
 * whose length nobody controls, because a model wrote the prose. They are also
 * the three whose page budgets were fitted most recently, so measuring them
 * against the stored row rather than a fixture is the point of this harness.
 */
const ROWS2 = JSON.parse(readFileSync(`${SCRATCH}/format-rows2.json`, 'utf8'));

function qaData(row: any): Record<string, any> {
  const built = buildReportQaDocument({
    conversation: row.conversation,
    messages: row.messages ?? [],
    subject: 'transcript',
    messageId: null,
    preparedOn: new Date('2026-08-13').toISOString(),
  } as any);
  const data: Record<string, any> = { report: {}, brand: {} };
  if ((built as any)?.ok !== false) {
    applyReportQaProjection(data, (built as any).document ?? built);
  }
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

/**
 * The single-answer subject against the longest answer a small conversation
 * holds — 27,050 characters, which runs past the masters' eight answer pages,
 * so this is the row that renders every continuation and the cut page.
 */
function qaAnswerData(row: any): Record<string, any> {
  const built = buildReportQaDocument({
    conversation: row.conversation,
    messages: row.messages ?? [],
    subject: 'answer',
    messageId: row.answerMessageId,
    preparedOn: new Date('2026-08-13').toISOString(),
  } as any);
  const data: Record<string, any> = { report: {}, brand: {} };
  if ((built as any)?.ok !== false) {
    applyReportQaProjection(data, (built as any).document ?? built);
  }
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function capacityData(row: any): Record<string, any> {
  const { assessment, run } = row;
  const snapshot = buildCapacitySnapshot({
    assessment,
    outputs: run?.outputs,
    inputs: run?.inputs_snapshot,
    clientName: 'A Client Pty Ltd',
    analysis: (run?.analysis ?? null) as never,
  } as any);
  const data: Record<string, any> = { report: {}, brand: {} };
  applyCommercialCapacityProjection(data, snapshot as any);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function marketData(row: any): Record<string, any> {
  const built = buildMarketIntelligenceReport({
    row,
    preparedOn: new Date('2026-08-13').toISOString(),
    brandName: ORG.company_name,
    audienceOverride: null,
  } as any);
  const data: Record<string, any> = { report: {}, brand: {} };
  if ((built as any)?.ok) applyMarketIntelligenceProjection(data, (built as any).report);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

function cashFlowData(row: any): Record<string, any> {
  const data: Record<string, any> = { report: {}, analysis: row, brand: {} };
  applyCashFlowProjection(data, row);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

/**
 * The nine-table bundle, exactly as `clientDetailsAdapter` loads it, through
 * the format's own normaliser and projection.
 */
function clientDetailsData(bundle: any): Record<string, any> {
  const details = buildClientDetails({
    client: bundle.client,
    properties: bundle.properties,
    employment: bundle.employment,
    income: bundle.income,
    incomeSources: bundle.incomeSources,
    assets: bundle.assets,
    liabilities: bundle.liabilities,
    expenses: bundle.expenses,
    addressHistory: bundle.addressHistory,
    now: new Date('2026-08-14').toISOString(),
  } as any);
  const data: Record<string, any> = { report: {}, record: bundle.client, brand: {} };
  applyClientDetailsProjection(data, details);
  applyOrganisationProjection(data, ORG as any, MARKS);
  return data;
}

const SETS: Array<[string, any[], Record<string, any>]> = [
  ['Investment Compass', INVESTMENT_COMPASS_TEMPLATES as any[], investmentData(ROWS.investment)],
  ['Borrowing Capacity', BORROWING_CAPACITY_TEMPLATES as any[], borrowingData(ROWS.borrowing_capacity)],
  ['Portfolio Review', PORTFOLIO_TEMPLATES as any[], portfolioData(ROWS.portfolio)],
  ['Property Comparison', COMPARISON_TEMPLATES as any[], comparisonData(ROWS.comparison)],
  // A salvaged row too — 27 of the 50 stored comparisons have every jsonb
  // column NULL and the truncated raw response in `executive_summary`. The
  // fallback verdict, the truncation note and the salvage-only timing and
  // advantages pages render only on this shape, so measuring the intact row
  // alone leaves half of production's pages unmeasured.
  ['Property Comparison (salvaged)', COMPARISON_TEMPLATES as any[], comparisonData(ROWS.comparison_salvaged)],
  // The 10 Year Cash Flow reads the same investment_reports row the Compass
  // does — 162 of the 1,182 carry a projection, and the fixture is one.
  ['Ten Year Cash Flow', CASH_FLOW_COMPASS_TEMPLATES as any[], cashFlowData(ROWS.investment)],
  // Three client shapes, because no one client renders every page: the
  // fullest record draws every financial page (three holdings, one over-cap
  // liability table), the richest one is where every cap bites at once —
  // 18 assets, 16 liabilities, 100 expense lines — with no property or
  // employment at all, and the third is the record with a second contact who
  // lives apart, the only shape that renders the secondary-residence row and
  // a 20-period address history.
  ['Client Details', CLIENT_DETAILS_TEMPLATES as any[], clientDetailsData(ROWS.client_details)],
  ['Client Details (caps bite)', CLIENT_DETAILS_TEMPLATES as any[], clientDetailsData(ROWS.client_details_capped)],
  ['Client Details (second contact)', CLIENT_DETAILS_TEMPLATES as any[], clientDetailsData(ROWS.client_details_secondary)],
  ['Report Q&A', REPORT_QA_TEMPLATES as any[], qaData(ROWS2.qa)],
  ['Report Q&A (long answer)', REPORT_QA_TEMPLATES as any[], qaAnswerData(ROWS2.qa_long_answer)],
  ['Commercial Capacity', COMMERCIAL_CAPACITY_TEMPLATES as any[], capacityData(ROWS2.commercial_capacity)],
  ['Market Intelligence', MARKET_INTELLIGENCE_TEMPLATES as any[], marketData(ROWS2.market_intelligence)],
];

const PAGE_H_PT = 842;
const FOOTER_HEIGHT_PT = 22;
const PX_TO_PT = 0.75;
/** Blocks may reach the footer band by design; only content above it is measured. */
const FOOTER_TOP_PT = PAGE_H_PT - FOOTER_HEIGHT_PT;
/** A box this tall relative to the sheet is a ground, a frame or a bleed plate. */
const DECOR_RATIO = 0.92;

interface Overflow {
  format: string; template: string; page: string; overBy: number;
}

async function measure(browser: Browser, schema: any, data: Record<string, any>) {
  const { html } = renderTemplateToHtml(schema, { data });
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.setContent(html, { waitUntil: 'load' });
  const visible = (schema.pages as any[]).filter(
    (p) => !p.conditional || evalConditional(String(p.conditional), { data, tokens: {} } as any),
  );
  const bottoms: number[] = await page.locator('.tpl-page').evaluateAll(
    (els: any[], ratio: number) => els.map((el) => {
      const pr = el.getBoundingClientRect();
      const footerTopPx = pr.height - 22 / 0.75;
      let deepest = -1e9;
      for (const c of Array.from(el.children) as any[]) {
        const r = c.getBoundingClientRect();
        const top = r.top - pr.top;
        // Skip full-sheet decor and the running foot: both sit in or across the
        // footer band on purpose and are not content that can overflow.
        if (r.height > 0 && r.height < pr.height * ratio && top < footerTopPx) {
          deepest = Math.max(deepest, r.bottom - pr.top);
        }
      }
      return deepest;
    }),
    DECOR_RATIO,
  );
  await page.close();
  return { bottoms, visible };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const overflows: Overflow[] = [];
let measured = 0;
let pagesMeasured = 0;

/**
 * Optional substring filter, so the heavy formats can be run on their own.
 *
 * A stored Q&A conversation is 4 MB and a Market Intelligence report 305 KB;
 * rendering seventy masters against those in one pass outlasts a sensible
 * timeout, and a harness nobody can finish running is a harness nobody runs.
 */
const ONLY = process.env.ONLY?.toLowerCase();

for (const [format, list, data] of SETS) {
  if (ONLY && !format.toLowerCase().includes(ONLY)) continue;
  // The spacious variant of each family is the binding constraint; see header.
  const tight = list.filter((t: any) => /-0(3)-/.test(t.slug));
  for (const t of tight) {
    const { bottoms, visible } = await measure(browser, t.schema, data);
    measured += 1;
    for (const [i, bottomPx] of bottoms.entries()) {
      if (bottomPx < -1e8) continue;
      pagesMeasured += 1;
      const bottomPt = bottomPx * PX_TO_PT;
      if (bottomPt > FOOTER_TOP_PT + 1) {
        overflows.push({
          format,
          template: t.slug,
          page: visible[i]?.name ?? `page ${i + 1}`,
          overBy: Math.round(bottomPt - FOOTER_TOP_PT),
        });
      }
    }
  }
  console.log(`  ${format}: ${tight.length} spacious masters measured`);
}

await browser.close();

console.log(`\nProduction fit — ${measured} masters, ${pagesMeasured} rendered pages`);
console.log('  data: stored production rows through each format\'s own projection\n');

if (!overflows.length) {
  console.log('  No block runs past the footer.\n');
} else {
  console.error(`✖ ${overflows.length} page(s) overflow:\n`);
  for (const o of overflows) {
    console.error(`  ${o.format} / ${o.template} — "${o.page}": ${o.overBy}pt past the footer`);
  }
  console.error('');
  process.exitCode = 1;
}
