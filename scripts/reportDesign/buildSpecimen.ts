/**
 * Render a specimen document through the report design system.
 *
 * A type specimen, not a fixture: it puts every primitive on the page at once so
 * a change to the stylesheet can be looked at rather than reasoned about. The
 * plan's verification step — build the WeasyPrint image, POST the HTML, open
 * the PDF — starts here.
 *
 *   npm run reportkit:specimen
 *   npm run reportkit:specimen -- --preset=minimal_ink --density=compact
 *   npm run reportkit:specimen -- --brand=#00A3FF --out=/tmp/tenant.html
 *
 * Output is a single self-contained HTML file. Feed it to the render service:
 *
 *   docker build -t npc-weasyprint weasyprint-service/
 *   docker run --rm -p 8080:8080 -e RENDER_TOKEN=dev npc-weasyprint
 *   curl -s localhost:8080/render -H 'Authorization: Bearer dev' \
 *     -H 'Content-Type: application/json' \
 *     -d "$(jq -Rn --rawfile h specimen.html '{html:$h}')" -o specimen.pdf
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveReportPalette, type ReportPreset } from '../../src/lib/reportDesign/brandResolve.pure';
import { buildReportCss } from '../../src/lib/reportDesign/css.pure';
import { normalizeReportDesignOptions, type ReportDesignOptions } from '../../src/lib/reportDesign/options.pure';
import { resolveCompanyBlock, mastheadFor } from '../../src/lib/reportDesign/companyBlock.pure';
import {
  buildReportBrandSnapshot,
  companyContactFor,
  lockupFor,
  paletteInputFor,
} from '../../src/lib/reportDesign/snapshot.pure';
import {
  NPC_HOUSE_COVER_ART,
  NPC_HOUSE_MARK,
} from './generated/defaultAssets.generated';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
} from '../../src/lib/reportDesign/structure.pure';
import {
  chartContext,
  chartContextForSpan,
  chartFigure,
  renderBars,
  renderDonut,
  renderGauge,
  renderInlineSpark,
  renderWaterfall,
} from '../../src/lib/reportDesign/charts.pure';
import {
  closeChapter,
  openChapter,
  renderBandedMatrix,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDecisionBox,
  renderDocument,
  renderGrid12,
  renderKpiStrip,
  renderLede,
  renderPullQuote,
  renderSidenote,
} from '../../src/lib/reportDesign/primitives.pure';

// ── Arguments ───────────────────────────────────────────────────────────────

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? 'true');
}

const brandHex = args.get('brand') ?? null;
// `--logo=none` renders the wordmark-only lockup; anything else uses the house
// mark, so the specimen exercises the path a tenant with no upload takes.
const useMark = args.get('logo') !== 'none';
// `--cover-art` uses the HOUSE cover, which carries NPC's company name and
// tagline in its pixels. Off by default and never a tenant fallback: the
// specimen's issuer is a fictional firm, and printing our name on their cover is
// precisely the defect this programme is removing.
const useCoverArt = args.get('cover-art') === 'true';
const outPath = resolve(process.cwd(), args.get('out') ?? 'reports/specimen.html');
const options: ReportDesignOptions = normalizeReportDesignOptions({
  preset: args.get('preset') as ReportPreset | undefined,
  density: args.get('density') as ReportDesignOptions['density'] | undefined,
  chapterStyle: args.get('chapter') as ReportDesignOptions['chapterStyle'] | undefined,
  tableStyle: args.get('table') as ReportDesignOptions['tableStyle'] | undefined,
  coverStyle: args.get('cover') as ReportDesignOptions['coverStyle'] | undefined,
  bodyScale: args.has('body-scale') ? Number(args.get('body-scale')) : undefined,
  visualIntensity: args.has('intensity') ? Number(args.get('intensity')) : undefined,
  showDropCaps: args.get('drop-caps') === 'true',
  justifyText: args.get('justify') !== 'false',
});

// ── Content ─────────────────────────────────────────────────────────────────
//
// Deliberately fictional. A specimen is committed, screenshotted and shared;
// real client figures must never be the thing that gets shared.

const CONTACT = {
  company_name: 'Meridian Property Partners',
  website: 'meridianpartners.example',
  email: 'advice@meridianpartners.example',
  phone: '+61 7 5555 0100',
  address: 'Level 8, 100 Example Street, Brisbane QLD 4000',
  abn: '11 222 333 444',
};

const DISCLAIMER = {
  is_enabled: true,
  font_size: 'small' as const,
  text: 'This report has been prepared for the named recipient and is general in '
    + 'nature. It does not take into account your objectives, financial situation '
    + 'or needs, and it is not a recommendation to acquire or dispose of any '
    + 'property or financial product.\n\nProjections are modelled outcomes based on '
    + 'the assumptions stated. Actual results will differ. Obtain independent '
    + 'legal, taxation and financial advice before acting.',
};

const archetype = REPORT_ARCHETYPES['financial-analysis'];

const CHAPTERS = [
  {
    id: 'spec.position',
    title: 'Position and assumptions',
    pageBudget: 4,
    note: 'What the model was given.',
  },
  {
    id: 'spec.projection',
    title: 'Ten-year projection',
    pageBudget: 8,
    note: 'Year by year, before and after tax.',
    wide: true,
  },
  {
    id: 'spec.verdict',
    title: 'Verdict',
    pageBudget: 4,
    note: 'What the numbers support.',
  },
];

const YEARS = Array.from({ length: 10 }, (_, i) => `Yr ${i + 1}`);
const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-AU')}`;

// Everything below is driven by one snapshot — the same object the render path
// will read from `report_brand_snapshots`. Nothing here reaches around it to the
// settings tables, which is the property Phase 3 exists to establish.
const { snapshot, skippedAssets } = buildReportBrandSnapshot({
  whitelabel: {
    id: '00000000-0000-4000-8000-000000000000',
    themeVersion: 2,
    companyName: CONTACT.company_name,
    tradingName: 'Meridian',
    brandColour: brandHex,
    preset: options.preset,
    assets: useMark ? { report: NPC_HOUSE_MARK } : {},
  },
  contact: CONTACT,
  document: { confidentiality: 'Confidential · Strategic advisory', preparedBy: CONTACT.company_name },
  // Fixed, not `new Date()` — a specimen that changes every run cannot be diffed.
  capturedAt: '2026-08-02T00:00:00.000Z',
});

const palette = resolveReportPalette(paletteInputFor(snapshot));
// A chart drawn for the full measure and dropped into a 38% column prints its
// labels at 38% of the size the code asked for. One context per width.
const charts = chartContext(palette);
const chartsCol7 = chartContextForSpan(palette, 7);
const chartsCol5 = chartContextForSpan(palette, 5);
const contact = companyContactFor(snapshot);
const masthead = mastheadFor(contact);
const spine = buildSpine({ archetype: 'financial-analysis', chapters: CHAPTERS });

const positionChapter = `
  ${openChapter('Position', '01', 'Position and assumptions')}
  ${renderChapterHeader({
    number: '01',
    title: 'Position and assumptions',
    label: archetype.chapterLabel,
    dek: 'A held asset, financed at 80%, modelled over ten years on the assumptions '
      + 'below. Change any one of them and the shape of the projection changes.',
  })}
  <div class="chapter-body">
  ${renderLede('The property clears its outgoings from year four and turns cash-flow '
    + 'positive from year six on the base case.')}
  ${renderKpiStrip([
    { label: 'Purchase price', value: '$785,000' },
    { label: 'Gross yield', value: '5.4%', foot: 'net 3.9%' },
    { label: 'Yr 1 cash flow', value: '-$8,140', tone: 'negative' },
    { label: 'Yr 10 position', value: '$41,900', tone: 'positive' },
  ])}
  ${renderGrid12([
    {
      span: 7,
      html: '<h3>What the model assumes</h3>'
        + '<p>Rent grows at 3.0% a year and expenses at 2.5%. The loan is '
        + 'interest-only for five years at 6.15%, reverting to principal and '
        + 'interest over the remaining twenty-five. Vacancy is carried at two '
        + 'weeks a year throughout, which is conservative for the locality and '
        + 'deliberately so — a model that assumes full occupancy is a model that '
        + 'has never met a tenant.</p>'
        + '<p>Capital growth is not an input to the cash-flow line. It appears '
        + 'only in the equity position, and only at the rate stated.</p>',
    },
    {
      span: 5,
      html: renderSidenote(
        'Sensitivity',
        '<p>A 100bp rate rise moves the year-one shortfall from $8,140 to '
        + '$14,700 and pushes break-even from year six to year eight.</p>',
      ),
    },
  ])}
  ${renderDataTable(
    [
      { key: 'item', label: 'Upfront cost' },
      { key: 'basis', label: 'Basis' },
      { key: 'amount', label: 'Amount', align: 'right' },
    ],
    [
      { item: 'Deposit', basis: '20% of price', amount: '$157,000' },
      { item: 'Stamp duty', basis: 'QLD investor scale', amount: '$21,485' },
      { item: 'Legal and conveyancing', basis: 'Fixed quote', amount: '$1,850' },
      { item: 'Building and pest', basis: 'Fixed quote', amount: '$680' },
      { item: 'Lender fees', basis: 'Application and valuation', amount: '$1,240' },
      { item: 'Total funds required', basis: '', amount: '$182,255', __total: true },
    ],
    { caption: 'Funds required at settlement' },
  )}
  ${renderGrid12([
    {
      span: 7,
      html: chartFigure(
        renderWaterfall(chartsCol7, [
          { label: 'Gross rent', value: 42_400 },
          { label: 'Operating', value: -11_900 },
          { label: 'Interest', value: -38_600 },
          { label: 'Net year 1', value: -8_100, total: true },
        ]),
        'Year-one cash flow build-up',
      ),
    },
    {
      span: 5,
      html: chartFigure(
        renderGauge(chartsCol5, 72, { label: 'Investment score', caption: 'weighted composite' }),
        'Composite score',
      ),
    },
  ])}
  ${renderGrid12([
    {
      span: 7,
      html: chartFigure(
        renderBars(chartsCol7, [
          { label: 'Schools within 5km', value: 8 },
          { label: 'Transport access', value: 6 },
          { label: 'Employment depth', value: 4, tone: 'caution' },
          { label: 'Vacancy pressure', value: 2, tone: 'negative' },
        ], { title: 'Locality scorecard', max: 10, unit: '/10' }),
      ),
    },
    {
      span: 5,
      html: chartFigure(
        renderDonut(chartsCol5, [
          { label: 'Owner-occupied', value: 62 },
          { label: 'Rented', value: 31 },
          { label: 'Other', value: 7 },
        ], { title: 'Tenure mix', centerSub: 'owner-occupied' }),
      ),
    },
  ])}
  ${renderCallout(
    'caution',
    'Watch',
    '<p>The interest-only period ends in year six, in the same year the base case '
    + 'turns positive. The two are not independent — a shift in either moves both.</p>',
  )}
  </div>
  ${closeChapter()}`;

const projectionChapter = `
  ${openChapter('Projection', '02', 'Ten-year projection')}
  ${renderChapterHeader({
    number: '02',
    title: 'Ten-year projection',
    label: archetype.chapterLabel,
    dek: 'Before-tax cash flow, year by year, on the base case.',
  })}
  ${closeChapter()}
  ${renderBandedMatrix(
    'Line item',
    YEARS,
    [
      { label: 'Gross rent', values: YEARS.map((_, i) => money(42_400 * 1.03 ** i)) },
      { label: 'Operating expenses', values: YEARS.map((_, i) => money(-11_900 * 1.025 ** i)) },
      { label: 'Interest', values: YEARS.map((_, i) => money(-(i < 5 ? 38_600 : 36_100 - i * 900))) },
      {
        label: 'Net cash flow',
        values: YEARS.map((_, i) =>
          money(42_400 * 1.03 ** i - 11_900 * 1.025 ** i - (i < 5 ? 38_600 : 36_100 - i * 900))),
        total: true,
      },
    ],
    { caption: 'Before-tax cash flow, base case' },
  )}`;

const verdictChapter = `
  ${openChapter('Verdict', '03', 'Verdict')}
  ${renderChapterHeader({
    number: '03',
    title: 'Verdict',
    label: archetype.chapterLabel,
  })}
  <div class="chapter-body">
  <p>Rent has moved ${renderInlineSpark(charts, [38_200, 39_100, 40_400, 41_000, 42_400])}
  steadily over five years, and the model carries that forward at 3.0%.</p>
  <p>On the stated assumptions the asset is serviceable from the outset and
  self-supporting from year six. The exposure is concentrated in the rate path
  rather than in the rent: the locality has carried sub-2% vacancy for eleven
  consecutive quarters, and the model already prices two weeks a year against
  that.</p>
  ${renderPullQuote(
    'The question is not whether the asset performs. It is whether the holding '
    + 'period is long enough to reach the year it starts to.',
    'Base case, section 02',
  )}
  <h3>Where this could go wrong</h3>
  <p>Two things would change the recommendation. A sustained 150bp rise pushes
  break-even past year nine, which is longer than the stated holding period. A
  body-corporate special levy of any size lands entirely in the early years,
  where there is no headroom to absorb it.</p>
  ${renderCallout('negative', 'Risk', '<p>No sinking-fund forecast was available at '
    + 'the time of writing. Obtain one before exchange.</p>')}
  ${renderCallout('positive', 'Strength', '<p>Fixed-price building contract with a '
    + 'twelve-month defects liability period.</p>')}
  ${renderDecisionBox(
    'What this means',
    '<p>Proceed to the sinking-fund review. If the fund is adequately provisioned, '
    + 'the position holds on the base case. If it is not, re-run the model with the '
    + 'levy in year one before making a decision.</p>',
  )}
  </div>
  ${closeChapter()}`;

const bodyHtml = [
  renderCover({
    title: '13 Bean Street',
    subtitle: 'Blackwater, QLD 4717',
    eyebrow: archetype.documentName,
    masthead: snapshot.company.name,
    edition: 'VOL. 2026 · ED. 08',
    lockup: lockupFor(snapshot, 'field'),
    heroDataUri: useCoverArt ? NPC_HOUSE_COVER_ART : null,
    meta: [
      { label: 'Prepared for', value: 'A. & J. Sample' },
      { label: 'Prepared by', value: 'Meridian Property Partners' },
      { label: 'Issued', value: '1 August 2026' },
    ],
    footerLeft: snapshot.document.confidentiality,
    footerRight: 'REF MPP-2026-0814',
  }),
  renderContentsPage(archetype.documentName, contentsEntriesFor(spine)),
  positionChapter,
  projectionChapter,
  verdictChapter,
  renderCompanyPage({
    block: resolveCompanyBlock(contact, DISCLAIMER),
    lockup: lockupFor(snapshot, 'field'),
  }),
].join('\n');

const html = renderDocument({
  title: `${archetype.documentName} — 13 Bean Street`,
  author: snapshot.company.name,
  subject: '13 Bean Street, Blackwater QLD 4717',
  css: buildReportCss({ palette, options, masthead }),
  bodyHtml,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

const pages = spine.reduce((n, e) => n + e.pageBudget, 0);
console.log(`✓ specimen written to ${outPath}`);
console.log(`  preset=${options.preset} density=${options.density} `
  + `table=${options.tableStyle} cover=${options.coverStyle} brand=${brandHex ?? 'default'}`);
console.log(`  ${spine.length} spine entries, ${pages} pages budgeted`);
console.log(`  brand snapshot ${snapshot.fingerprint} · mark ${snapshot.logo.report ? 'inlined' : 'none'}`);
for (const skipped of skippedAssets) {
  console.warn(`  ! ${skipped.source} skipped: ${skipped.reason} — ${skipped.detail}`);
}
