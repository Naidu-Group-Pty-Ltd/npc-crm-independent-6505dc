/**
 * Ten-Year Cash Flow Analysis — three variations on the legacy report.
 *
 * ## What these are derived from
 *
 * `src/components/reports/CashFlowAnalysisModal.tsx` generates the report the
 * business actually sends: a jsPDF document with a branded cover, an input
 * summary, upfront and total-expenditure tables, a twenty-three-row projection
 * matrix banded into STATISTICS / CASH DEDUCTIONS / NON-CASH DEDUCTIONS /
 * SUMMARY, four dark summary cards, and two annotated trend charts.
 *
 * That generator is a fixed pipeline: one layout, no variants, and nothing a
 * user can pick from the Template Library. These three entries bring its
 * structure into the catalogue as editable templates, so the same analysis can
 * be issued in the shape the audience needs.
 *
 * ## What is carried over, and what is not
 *
 * Carried over: the section order, the banded matrix, red negatives, the dark
 * summary cards, the gold accent, and the written insight blocks under each
 * chart — everything that makes the legacy output recognisable.
 *
 * Not carried over: the fixed slate `#2D3748` and gold `#CA8A04` literals.
 * Those resolve to `token:bg` and `token:primary` under the NPC voices, so the
 * white-label pipeline can re-skin them and `isBrandSafe()` stays true. The
 * legacy gold is within the NPC brand-gold family, so the documents look like
 * their predecessor rather than like a different product.
 *
 * ## Why the accent is gold, not evergreen
 *
 * `CATEGORY_ACCENT` maps `cash_flow` to evergreen. These three override it to
 * gold deliberately: they are the legacy report's successors and the legacy
 * report is gold. The accent argument to `beginTemplate()` exists precisely so
 * a template can make that call.
 */
import {
  barChart, beginTemplate, callout, contents, cover, currentAccent, currentVoice,
  decision, definitions, disclaimerPage, flow, heading, inputGrid, kpis, lineChart,
  matrixTable, page, prose, summaryCards, table, useLandscape, withFurniture,
  type PageDef,
} from './blocks';
import { STANDARD_DISCLAIMER, voiceTokens } from './designSystem';
import type { SeedTemplate } from './templates';

const FOOT = 'Ten-year cash flow · {{property.address}}';

/** Milestone columns for the portrait variants. Ten years will not fit. */
const MILESTONES = [0, 2, 4, 6, 9] as const;
const MILESTONE_HEADERS = ['Metric', 'Today', 'Yr 1', 'Yr 3', 'Yr 5', 'Yr 7', 'Yr 10'];

/** `{{tenYear.matrix.<row>.<index>}}` for the milestone years. */
function milestoneRow(label: string, key: string, today?: string): string[] {
  return [
    label,
    today ?? '',
    ...MILESTONES.map((i) => `{{tenYear.matrix.${key}.${i}}}`),
  ];
}

/** All ten years, for the landscape variant. */
function fullRow(label: string, key: string, today?: string): string[] {
  return [
    label,
    today ?? '',
    ...Array.from({ length: 10 }, (_, i) => `{{tenYear.matrix.${key}.${i}}}`),
  ];
}

const FULL_HEADERS = [
  'Metric', 'Today',
  ...Array.from({ length: 10 }, (_, i) => `Yr ${i + 1}`),
];

/** The banded row structure, shared by every variant. Mirrors the legacy. */
function matrixGroups(row: (label: string, key: string, today?: string) => string[]) {
  return [
    {
      rows: [
        row('Capital Growth %', 'capitalGrowth'),
        row('CPI Growth %', 'cpiGrowth'),
        row('Property Value $', 'propertyValue', '{{tenYear.today.propertyValue}}'),
        row('Loan Amount $', 'loanAmount', '{{tenYear.today.loanAmount}}'),
      ],
    },
    {
      band: 'Statistics',
      rows: [
        row('Equity $', 'equity', '{{tenYear.today.equity}}'),
        row('LVR %', 'lvr', '{{tenYear.today.lvr}}'),
        row('Rental Income $', 'rentalIncome', '{{tenYear.today.rentalIncome}}'),
        row('Gross Yield %', 'grossYield'),
        row('Net Yield %', 'netYield'),
      ],
    },
    {
      band: 'Cash deductions',
      rows: [
        row('Property Expenses $', 'expenses'),
        row('Land Tax $', 'landTax'),
        row('Interest Rate %', 'interestRate'),
        row('Interest Payments $', 'interestPayments'),
        row('Principal Payments $', 'principalPayments'),
        row('Pre-Tax Cash Flow p/a $', 'preTaxPA'),
        row('Pre-Tax Cash Flow p/w $', 'preTaxPW'),
      ],
    },
    {
      band: 'Non-cash deductions',
      rows: [row('Depreciation $', 'depreciation')],
    },
    {
      band: 'Summary',
      rows: [
        row('Total Deductions $', 'totalDeductions'),
        row('Net Profit/Loss $', 'netProfitLoss'),
        row('Tax Refund $', 'taxRefund'),
        row('After-Tax Cash Flow p/a $', 'afterTaxPA'),
        row('After-Tax Cash Flow p/w $', 'afterTaxPW'),
      ],
    },
  ];
}

/** The legacy input summary, two-up. */
const INPUT_PAIRS: Array<[string, string]> = [
  ['Purchase Price', '{{tenYear.inputs.purchasePrice}}'],
  ['Weekly Rent', '{{tenYear.inputs.weeklyRent}}'],
  ['Land Price', '{{tenYear.inputs.landPrice}}'],
  ['Gross Rental Yield', '{{tenYear.inputs.grossYield}}'],
  ['Build Price', '{{tenYear.inputs.buildPrice}}'],
  ['Council Rates (p.a.)', '{{tenYear.inputs.councilRates}}'],
  ['Deposit Amount', '{{tenYear.inputs.deposit}}'],
  ['Water Rates (p.a.)', '{{tenYear.inputs.waterRates}}'],
  ['Loan Amount', '{{tenYear.inputs.loanAmount}}'],
  ['Property Management', '{{tenYear.inputs.propertyManagement}}'],
  ['Interest Rate', '{{tenYear.inputs.interestRate}}'],
  ['Landlord Insurance', '{{tenYear.inputs.landlordInsurance}}'],
  ['Capital Growth Rate', '{{tenYear.inputs.capitalGrowth}}'],
  ['Letting Fees', '{{tenYear.inputs.lettingFees}}'],
  ['CPI Growth Rate', '{{tenYear.inputs.cpiGrowth}}'],
  ['Repairs & Maintenance', '{{tenYear.inputs.repairs}}'],
  ['Tax Rate (MTR)', '{{tenYear.inputs.taxRate}}'],
  ['Body Corporate', '{{tenYear.inputs.bodyCorporate}}'],
  ['Depreciation (Yr 1)', '{{tenYear.inputs.depreciation}}'],
  ['Stamp Duty', '{{tenYear.inputs.stampDuty}}'],
  ['Conveyancing', '{{tenYear.inputs.conveyancing}}'],
];

const HEADLINE_KPIS = [
  { label: 'Purchase price', value: '{{tenYear.inputs.purchasePrice}}' },
  { label: 'Weekly rent', value: '{{tenYear.inputs.weeklyRent}}' },
  { label: 'Interest rate', value: '{{tenYear.inputs.interestRate}}' },
  { label: 'Capital growth', value: '{{tenYear.inputs.capitalGrowth}}' },
];

const OUTCOME_CARDS = [
  { label: 'Property value', value: '{{tenYear.summary.propertyValue}}' },
  { label: 'Total equity', value: '{{tenYear.summary.totalEquity}}' },
  { label: 'Capital gain', value: '{{tenYear.summary.capitalGain}}' },
  { label: 'After-tax cash flow', value: '{{tenYear.summary.totalAfterTax}}' },
];

const UPFRONT_ROWS = [
  ['Deposit (20% — from your funds)', '{{tenYear.upfront.deposit}}'],
  ['Stamp duty', '{{tenYear.upfront.stampDuty}}'],
  ['Solicitor / conveyancer cost', '{{tenYear.upfront.conveyancing}}'],
  ['Agent fee', '{{tenYear.upfront.agentFee}}'],
  ['Total upfront costs', '{{tenYear.upfront.total}}'],
];

function schemaFor(name: string, pages: PageDef[]) {
  return {
    version: 1 as const,
    name,
    tokens: voiceTokens(currentVoice(), currentAccent()),
    pages,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Cash Flow Ledger — the faithful successor
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Everything the legacy report contained, in portrait, in the Cadastre voice.
 *
 * The one substantive change: the matrix shows milestone years (today, 1, 3,
 * 5, 7, 10) rather than all ten. Twelve columns on a portrait page is 42pt
 * each, which the legacy handled by dropping to 6pt type. Six columns at 9pt
 * is a more honest trade — and the Matrix variant below exists for a reader
 * who genuinely needs every year.
 */
function cashFlowLedger(): SeedTemplate {
  beginTemplate('technical', 'gold', 'cash_flow');
  const pages = [
    cover({
      eyebrow: '10-Year Cash Flow Analysis',
      title: '{{property.address}}',
      subtitle: 'Prepared for {{client.name}}',
      footnote: 'Generated {{report.generatedDate | date}}',
    }),
    // Inputs and costs share a page, as they did in the legacy report: the
    // reader checking an assumption wants the cost base in the same eyeful.
    withFurniture(page('Inputs and costs', flow([
      heading('Input summary', 'Every figure below drives the projection. Change one and the whole model moves.'),
      kpis(HEADLINE_KPIS),
      inputGrid(INPUT_PAIRS),
      table(['Upfront cost', 'Amount'], UPFRONT_ROWS, [0.7, 0.3]),
      callout(
        'Total overall expenditure to completion',
        '{{tenYear.upfront.overall}} — purchase price plus stamp duty, conveyancing and agent fee.',
        'warning', 72,
      ),
    ])), FOOT),
    // Matrix and outcome cards together, as on legacy page two.
    withFurniture(page('Projections', flow([
      heading('Ten-year projections', 'Milestone years. The Matrix edition of this template carries all ten.'),
      matrixTable({
        headers: MILESTONE_HEADERS,
        groups: matrixGroups(milestoneRow),
        columnWidths: [0.28, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12],
        fontSize: 8,
        rowHeight: 17,
      }),
      summaryCards(OUTCOME_CARDS),
    ])), FOOT),
    withFurniture(page('Trends', flow([
      heading('Ten-year trends', 'Property value appreciation, equity growth and the after-tax position across the horizon.'),
      lineChart({
        title: 'Equity position by year',
        caption: 'Property value less loan balance',
        dataPath: 'tenYear.equitySeries',
        data: [],
        height: 186,
      }),
      callout('Property value growth', '{{tenYear.insight.value}}', 'info', 78),
      callout('Equity accumulation', '{{tenYear.insight.equity}}', 'info', 78),
      callout('Cash flow trajectory', '{{tenYear.insight.cashFlow}}', 'info', 90),
    ])), FOOT),
    withFurniture(page('Yield', flow([
      heading('Yield analysis', 'Gross and net yield against current market value, showing yield compression as the asset appreciates.'),
      lineChart({
        title: 'Gross and net yield',
        caption: 'Percentage of current market value',
        dataPath: 'tenYear.grossYieldSeries',
        data: [],
        height: 186,
      }),
      callout('Gross yield', '{{tenYear.insight.grossYield}}', 'info', 82),
      callout('Net yield', '{{tenYear.insight.netYield}}', 'info', 78),
      callout('Expense drag', '{{tenYear.insight.expenseDrag}}', 'info', 82),
    ])), FOOT),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'cash-flow-ledger',
    name: 'Cash Flow Ledger',
    description: 'The full ten-year analysis: inputs, costs, the banded projection matrix, outcome and yield.',
    longDescription:
      'The complete ten-year cash flow report, carried over from the generator the business '
      + 'already sends. Opens with every input on one page so the assumptions are arguable, '
      + 'states the upfront and total expenditure, then runs the banded projection matrix — '
      + 'statistics, cash deductions, non-cash deductions and summary — before closing on the '
      + 'ten-year outcome, the equity curve and a yield analysis. Negative figures print red. '
      + 'Milestone years are shown; the Matrix edition carries all ten.',
    category: 'cash_flow',
    reportType: 'cashflow',
    tier: 'ledger',
    industry: ['property', 'finance'],
    tags: ['cash-flow', 'projection', 'legacy', 'comprehensive', 'tax'],
    style: 'technical',
    accessTier: 'standard',
    schema: schemaFor('Cash Flow Ledger', pages),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cash Flow Matrix — landscape, all ten years
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The analyst's edition. Landscape, so all twelve columns fit.
 *
 * This is the variation the data shape actually asks for: at 758pt of content
 * width each year gets 63pt instead of 42pt, which is the difference between
 * `$1,372,108` sitting on one line and wrapping. The only template in the
 * catalogue that is landscape, and it is landscape for a reason rather than
 * for variety.
 */
function cashFlowMatrix(): SeedTemplate {
  beginTemplate('technical', 'gold', 'cash_flow');
  useLandscape(true);
  const pages = [
    cover({
      eyebrow: '10-Year Cash Flow Matrix',
      title: '{{property.address}}',
      subtitle: 'Full projection · prepared for {{client.name}}',
      footnote: 'Generated {{report.generatedDate | date}}',
      titleSize: 32,
    }),
    withFurniture(page('Matrix', flow([
      heading(
        'Ten-year projections',
        'Every year, every row. Figures are set in a monospaced face so the columns align.',
        44,
      ),
      matrixTable({
        headers: FULL_HEADERS,
        groups: matrixGroups(fullRow),
        columnWidths: [0.16, 0.07, ...Array.from({ length: 10 }, () => 0.077)],
        fontSize: 7,
        rowHeight: 14,
      }),
    ])), FOOT),
    // Landscape leaves ~350pt of usable height once the heading is placed, so
    // these pages carry less than their portrait equivalents by design.
    withFurniture(page('Inputs', flow([
      heading('Inputs and cost base', 'Every figure that drives the projection, and what has to be funded before settlement.', 44),
      kpis(HEADLINE_KPIS, 84),
      inputGrid(INPUT_PAIRS),
    ])), FOOT),
    withFurniture(page('Position', flow([
      heading('Where it lands', 'The ten-year outcome and the trend that produced it.', 44),
      summaryCards(OUTCOME_CARDS, 84),
      lineChart({
        title: 'Equity position by year',
        caption: 'Property value less loan balance',
        dataPath: 'tenYear.equitySeries',
        data: [],
        height: 172,
      }),
    ])), FOOT),
    withFurniture(page('Read', flow([
      heading('What the numbers say', '', 30),
      callout('Cash flow trajectory', '{{tenYear.insight.cashFlow}}', 'info', 86),
      callout('Equity accumulation', '{{tenYear.insight.equity}}', 'info', 74),
      callout('Expense drag', '{{tenYear.insight.expenseDrag}}', 'info', 78),
      callout('Yield compression', '{{tenYear.insight.grossYield}}', 'info', 78),
    ])), FOOT),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];
  useLandscape(false);

  return {
    slug: 'cash-flow-matrix',
    name: 'Cash Flow Matrix',
    description: 'Landscape. All ten years of the projection across a full spread, nothing abbreviated.',
    longDescription:
      'The analyst\'s edition of the ten-year cash flow. Landscape A4, because a twelve-column '
      + 'projection gets 63pt per column across the long edge and 42pt across the short one — '
      + 'the difference between a seven-figure value fitting on one line and wrapping. Carries '
      + 'the complete banded matrix with every year shown, then the ten-year outcome and the '
      + 'equity curve. Figures are set in a monospaced face so the columns align down the page.',
    category: 'cash_flow',
    reportType: 'cashflow',
    tier: 'matrix',
    industry: ['property', 'finance'],
    tags: ['cash-flow', 'projection', 'landscape', 'analyst', 'legacy'],
    style: 'technical',
    accessTier: 'standard',
    schema: schemaFor('Cash Flow Matrix', pages),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Cash Flow Position — the client-facing read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The same analysis for someone who is not going to read a matrix.
 *
 * Chancery rather than Cadastre: this one gets read in a meeting, not audited
 * at a desk. The matrix is reduced to the seven rows a client actually asks
 * about, and the written insight the legacy report buried under its charts is
 * promoted to the body of the document.
 */
function cashFlowPosition(): SeedTemplate {
  beginTemplate('corporate', 'gold', 'cash_flow');
  const pages = [
    cover({
      eyebrow: '10-Year Cash Flow',
      title: '{{property.address}}',
      subtitle: 'Prepared for {{client.name}}',
      footnote: 'Generated {{report.generatedDate | date}}',
    }),
    withFurniture(page('Contents', flow([contents('Contents')])), FOOT),
    withFurniture(page('The position', flow([
      heading('The position', 'What the property costs to hold, and what it is projected to be worth.'),
      kpis(HEADLINE_KPIS),
      prose('{{cashflow.narrative}}', 64),
      summaryCards(OUTCOME_CARDS),
      callout('Cash flow trajectory', '{{tenYear.insight.cashFlow}}', 'info', 82),
    ])), FOOT),
    withFurniture(page('The numbers', flow([
      heading('The numbers that matter', 'The rows clients ask about, at milestone years.'),
      matrixTable({
        headers: MILESTONE_HEADERS,
        groups: [{
          rows: [
            milestoneRow('Property Value $', 'propertyValue', '{{tenYear.today.propertyValue}}'),
            milestoneRow('Loan Amount $', 'loanAmount', '{{tenYear.today.loanAmount}}'),
            milestoneRow('Equity $', 'equity', '{{tenYear.today.equity}}'),
            milestoneRow('Rental Income $', 'rentalIncome', '{{tenYear.today.rentalIncome}}'),
            milestoneRow('Gross Yield %', 'grossYield'),
            milestoneRow('After-Tax Cash Flow p/a $', 'afterTaxPA'),
            milestoneRow('After-Tax Cash Flow p/w $', 'afterTaxPW'),
          ],
        }],
        // The label column carries "After-Tax Cash Flow p/a $"; at 0.28 of the
        // column it wraps, which costs a line on every row of the table.
        columnWidths: [0.34, 0.11, 0.11, 0.11, 0.11, 0.11, 0.11],
        fontSize: 9,
        rowHeight: 20,
      }),
      callout('Equity accumulation', '{{tenYear.insight.equity}}', 'info', 78),
      callout('Cash flow trajectory', '{{tenYear.insight.cashFlow}}', 'info', 90),
      callout('Expense drag', '{{tenYear.insight.expenseDrag}}', 'info', 82),
    ])), FOOT),
    withFurniture(page('Growth', flow([
      heading('Value and yield over ten years', 'How the asset is projected to behave.'),
      barChart({
        title: 'Projected property value',
        caption: 'End of each year',
        dataPath: 'tenYear.valueSeries',
        data: [],
        height: 186,
      }),
      callout('Property value growth', '{{tenYear.insight.value}}', 'info', 78),
      callout('Yield compression', '{{tenYear.insight.grossYield}}', 'info', 86),
      callout('Net yield', '{{tenYear.insight.netYield}}', 'info', 78),
    ])), FOOT),
    withFurniture(page('The read', flow([
      heading('Our read', ''),
      decision('{{cashflow.conclusion.headline}}', '{{cashflow.conclusion.body}}', 96),
      callout('Break-even', '{{cashflow.breakEvenNote}}', 'success', 74),
      definitions('Assumptions this rests on', [
        { term: 'Capital growth', definition: '{{tenYear.inputs.capitalGrowth}} per annum' },
        { term: 'CPI growth', definition: '{{tenYear.inputs.cpiGrowth}} per annum' },
        { term: 'Interest rate', definition: '{{tenYear.inputs.interestRate}}' },
        { term: 'Marginal tax rate', definition: '{{tenYear.inputs.taxRate}}' },
      ]),
    ])), FOOT),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'cash-flow-position',
    name: 'Cash Flow Position',
    description: 'The client-facing read: headline numbers, the seven rows that matter, and what it means.',
    longDescription:
      'The ten-year analysis for a reader who wants the conclusion, not the spreadsheet. Leads '
      + 'with the holding cost and the ten-year outcome, reduces the projection to the seven '
      + 'rows clients actually ask about, and promotes the written interpretation that the '
      + 'legacy report buried beneath its charts into the body of the document. Closes on an '
      + 'explicit read and the assumptions it rests on.',
    category: 'cash_flow',
    reportType: 'cashflow',
    tier: 'position',
    industry: ['property', 'finance'],
    tags: ['cash-flow', 'client-facing', 'concise', 'decision', 'legacy'],
    style: 'corporate',
    accessTier: 'standard',
    schema: schemaFor('Cash Flow Position', pages),
  };
}

export const CASH_FLOW_TEMPLATES: SeedTemplate[] = [
  cashFlowLedger(),
  cashFlowMatrix(),
  cashFlowPosition(),
];
