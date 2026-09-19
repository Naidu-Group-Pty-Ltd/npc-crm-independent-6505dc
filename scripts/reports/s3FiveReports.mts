/**
 * S3 — the approved assessment treatment, on all five reports, from bindings.
 *
 * The six-page review composed its figures in the script. This does not: every
 * value below is a `{{binding}}` resolved by the production binding resolver
 * out of `projectInvestmentReport`, which is the authority all 500 seeded
 * masters and both render routes read. If a reading is missing from a tier,
 * the page shows it missing rather than the script filling in.
 *
 * One page per tier, same row, same master. It shows three things at once:
 *
 *   · the four assessment readings, separated, on every tier;
 *   · the criteria table, bound from `assessment.N.*` by index, which is how
 *     the catalogue's own scorecard binds it;
 *   · and the financial band, drawn ONLY where the tier's content policy
 *     publishes modelling — so the Compass's missing purchase analysis is
 *     visible beside the Financial report that carries it.
 *
 *   npx tsx scripts/reports/s3FiveReports.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { measureAndRender, REPO, type Sheet, weasy } from './_reviewKit.mts';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { REPORT_TIERS, type ReportTier } from '../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';
import { documentTitleForTier } from '../../supabase/functions/_shared/reports/investment/tierIdentity.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const F = (p: string) => resolve(REPO, 'reports/fixtures', p);
const row = JSON.parse(readFileSync(F('annabelle-row.json'), 'utf8'));
const MARK = readFileSync(F('mark-monogram.txt'), 'utf8').trim();

const chancery: any = INVESTMENT_COMPASS_TEMPLATES.find(
  (t: any) => String(t.slug ?? '').includes('-pb-01-'),
);
const TOKENS = chancery.schema.tokens;
const C = TOKENS.colors;
const PAD = TOKENS.spacing.padding;
const W = 595 - PAD * 2;
const FOOT_RULE = 786;

const TABLE = {
  headerStyle: 'rule', headerBg: 'token:primary', headerFg: 'token:onPrimary',
  headerFont: 'token:mono', headerSize: 6, headerTracking: 0.1,
  numericFont: 'token:heading', rowRule: true, outerBorder: false,
  stripeBg: 'token:panel', cellFg: 'token:ink', borderColor: 'token:line',
  emphasisColor: 'token:ink', negativeColor: 'token:negative',
  fontSize: 8.5, cellPadding: 4.5,
};

let n = 0;
const B = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: `s3-${type}-${++n}`, type, props: { x: PAD, width: W, ...props }, overlays: [], ...extra });
const eyebrow = (text: string, color = C.accentOnField) =>
  B('text-block', { body: text, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.28, color });
const title = (text: string, size = 20) =>
  B('text-block', { body: text, bodySize: size, bodyFont: 'token:heading', bodyLineHeight: 1.18, bodyTracking: -0.01, color: C.ink });
const para = (text: string, opts: Record<string, unknown> = {}) =>
  B('text-block', { body: text, bodySize: 9, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.ink, ...opts });
const rule = () => B('divider', { color: C.line, thickness: 0.6, width: W });

/**
 * One sheet per tier. Everything inside comes from a binding; the only
 * authored strings are the labels and the two explanatory sentences, which
 * are the treatment itself rather than data.
 */
const sheetFor = (tier: ReportTier, index: number): Sheet => ({
  name: `${tier} · ${documentTitleForTier(tier)}`,
  top: PAD,
  pinned: [
    B('image', { src: MARK, fit: 'contain', placeholder: false, x: PAD, y: FOOT_RULE + 4, width: 22, height: 18 },
      { name: 'Naidu Property Consulting Services brand mark' }),
    B('divider', { color: C.line, thickness: 0.6, width: W, y: FOOT_RULE }),
    B('text-block', {
      body: '{{property.address}} · {{report.documentTitle}}',
      bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted,
      y: FOOT_RULE + 10, x: PAD + 30, width: 380,
    }),
    B('text-block', {
      body: `${index + 1} of ${REPORT_TIERS.length} report types`,
      bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted,
      y: FOOT_RULE + 10, x: PAD + W - 120, width: 120, align: 'right',
    }),
  ],
  flow: [
    [0, eyebrow('{{report.documentTitle}}', C.muted)],
    [14, title('How the assessment was reached')],
    [16, rule()],
    [12, para('Three things are kept apart and never combined: how the property SCORED on what could be measured, how much of the method the evidence REACHED, and the GRADE issued once the second limits the first. The fourth reading is whether any of it supports an overall conclusion.')],
    [16, B('kpi-grid', {
      variant: 'ruled', columns: 3, height: 62,
      items: [
        { label: 'Measured-criteria score', value: '{{recommendation.measuredLine}}' },
        { label: 'Evidence coverage', value: '{{recommendation.coverageLabel}}' },
        { label: 'Grade issued, after the cap', value: '{{recommendation.grade}}' },
      ],
      valueFont: 'token:heading', labelFont: 'token:mono', labelSize: 6, labelTracking: 0.18,
      valueSize: 13, valueColor: C.ink, labelColor: C.muted, ruleColor: C.line, emphasisColor: C.ink,
    })],
    [12, para('{{recommendation.conclusionLine}}', { bodySize: 10, bodyFont: 'token:heading', bodyLineHeight: 1.3 })],
    [16, eyebrow('CRITERIA THAT COULD BE MEASURED — {{recommendation.criteriaMeasuredLine}}')],
    [10, B('data-table', {
      ...TABLE,
      headers: ['Criterion', 'Score', 'Weight applied', 'Measured on'],
      columnWidths: [0.3, 0.12, 0.16, 0.42],
      numericColumns: [1, 2],
      // Bound by index, which is how the catalogue's own scorecard binds it.
      // A criterion that did not score publishes nothing, and the row is
      // dropped by `rowsWithSomethingToSay` rather than printing a hole.
      rows: [0, 1, 2, 3, 4].map((i) => ({
        cells: [
          `{{assessment.${i}.label}}`,
          `{{assessment.${i}.scoreLabel}}`,
          `{{assessment.${i}.weightLabel}}`,
          `{{assessment.${i}.measuredOn}}`,
        ],
      })),
    })],
    [8, para('{{recommendation.weightRoundingNote}}', { bodySize: 8, color: C.muted })],
    [14, eyebrow('WHY THE GRADE IS LOWER THAN THE SCORE')],
    [8, para('{{recommendation.capExplanation}}', { bodySize: 8.6 })],
    [12, eyebrow('WHAT THIS REPORT CARRIES ABOUT THE PURCHASE', C.muted)],
    [10, B('data-table', {
      ...TABLE,
      headers: ['Figure', 'This report'],
      columnWidths: [0.42, 0.58],
      numericColumns: [1],
      fontSize: 8.2,
      rows: [
        { cells: ['Asking price', '{{financials.purchasePrice | currency}}'] },
        { cells: ['Indicative weekly rent', '{{financials.weeklyRent | currency}}'] },
        { cells: ['Loan amount', '{{financials.loanAmount | currency}}'] },
        { cells: ['Weekly holding position', '{{financials.weeklyNet | currency}}'] },
        { cells: ['Ten-year equity projection', '{{tenYear.equitySeries.9.value | currency}}'] },
      ],
    })],
    [8, para('The price and the rent are facts about the asset and appear on every report. The loan, the holding position and the projection are the analysis of a PURCHASE: the tier decides whether this report draws them, so a missing row is this document declining that figure rather than nobody holding it.', { bodySize: 8, color: C.muted })],
  ],
});

const data: Record<string, any> = {};
const SHEETS: Sheet[] = [];
REPORT_TIERS.forEach((tier, i) => SHEETS.push(sheetFor(tier as ReportTier, i)));

// One binding context per page is not possible — the resolver takes one `data`
// — so each tier is rendered in its own pass and the pages are concatenated by
// rendering five documents. Simpler and equally faithful: render per tier.
let overrunTotal = 0;
let lostTotal = 0;
for (let i = 0; i < REPORT_TIERS.length; i += 1) {
  const tier = REPORT_TIERS[i] as ReportTier;
  const ctx: Record<string, any> = {
    report: { id: row.id, type: 'investment', generated_at: row.updated_at },
    property: {}, financials: {}, scores: {}, brand: { tokens: {}, logo: null },
  };
  applyInvestmentProjection(ctx, row, { tier });
  applyOrganisationProjection(
    ctx,
    { company_name: 'Naidu Property Consulting Services' } as never,
    { mark: MARK, markMono: MARK },
    {
      contact: {
        company_name: 'Naidu Property Consulting Services', abn: '50 684 555 771',
        email: 'admin@npcservices.com.au', phone: '02 8609 3299',
        address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
        website: 'www.npcservices.com.au',
      },
      disclaimer: { is_enabled: true, font_size: 'medium', text: readFileSync(F('disclaimer.txt'), 'utf8') },
    } as never,
  );
  console.log(`\n── ${tier} ─────────────────────────────────────────────`);
  const { overruns, lost } = await measureAndRender([SHEETS[i]], TOKENS, ctx, `s3-${tier}`, { floor: FOOT_RULE - 12 });
  overrunTotal += overruns;
  lostTotal += lost;
}

console.log(`\n${overrunTotal === 0 && lostTotal === 0 ? 'ALL FIVE REPORTS DREW CLEAN' : `${overrunTotal} overrun(s), ${lostTotal} lost string(s)`}\n`);

/**
 * The five tiers as one document to hand over.
 *
 * Each tier is rendered in its own pass because the binding resolver takes one
 * `data` and the five tiers resolve it differently. The first version of this
 * handover file was the five PDFs concatenated — which **strips the structure
 * tree**: the merged file carried no `/StructTreeRoot`, no `/MarkInfo`, no
 * `/Lang` and no title, so the one document actually sent for review was the
 * only one in the set that was not tagged.
 *
 * The pages are already resolved by the time they are HTML, so the five
 * `<section>` elements are spliced into one shell and drawn in a single pass.
 * One engine run, one structure tree, and the result goes through the same
 * validator as everything else.
 */
const shell = readFileSync(resolve(REPO, 'reports/html/s3-compass.html'), 'utf8');
const sectionsOf = (html: string) => {
  const from = html.indexOf('<section');
  const to = html.lastIndexOf('</section>');
  if (from < 0 || to < 0) throw new Error('no page section in the rendered HTML');
  return html.slice(from, to + '</section>'.length);
};
const bodyAt = shell.indexOf('<body>') + '<body>'.length;
const merged = shell.slice(0, bodyAt)
  + REPORT_TIERS.map((t) => sectionsOf(readFileSync(resolve(REPO, `reports/html/s3-${t}.html`), 'utf8'))).join('\n')
  + shell.slice(shell.indexOf('</body>'));
const mergedHtml = resolve(REPO, 'reports/html/s3-five-reports.html');
const mergedPdf = resolve(REPO, 'reports/pdf/s3-five-reports.pdf');
writeFileSync(mergedHtml, merged);
weasy(mergedHtml, mergedPdf);
console.log(`one document for review: ${mergedPdf}`);

process.exitCode = overrunTotal === 0 && lostTotal === 0 ? 0 : 1;
