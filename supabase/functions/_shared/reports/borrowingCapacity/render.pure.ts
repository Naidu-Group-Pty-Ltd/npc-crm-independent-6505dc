/**
 * The Snapshot as HTML, through the design system.
 *
 * Nothing here positions anything. The shipping generator places every value at
 * a hard-coded millimetre offset, which is why `Balance` and `Monthly
 * Repayment` render as `BalanceMonthly Repayment` and why "Selected Lender:
 * Example Bank — Investor P&I" runs off the edge of the box meant to contain it
 * (`BORROWING_CAPACITY.md` F3, F4). Those are not bugs to fix one at a time;
 * they are what happens when a document is drawn instead of laid out.
 *
 * Nothing here names a colour either. Every colour comes from the resolved
 * palette, which is contrast-checked as a whole — seven of the shipping
 * generator's nine colour pairs fail 4.5:1, all of them at 7–8pt, on a document
 * that gets printed (F5).
 *
 * And nothing here colours a number by its sign. Direction is carried on the
 * payload and printed **in words** — see `AUDIT_EFFECT` below.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  KEEP_TOGETHER_CLASS,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type CalloutTone,
  type KpiCell,
  type TableColumn,
  type TableRow,
  type ValueTone,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock } from '../../reportDesign/companyBlock.pure.ts';
import { REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import type { CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';

import type { Measure } from '../../reportDesign/measure.pure.ts';
import { aud, formatAmount, formatDelta, formatMeasure, periodLabel } from '../../reportDesign/measure.pure.ts';
import type { Direction } from './audit.pure.ts';
import type {
  AuditRow,
  Band,
  BorrowingCapacitySnapshot,
  IncomeRow,
  LedgerRow,
  LiabilityRow,
  ScenarioRow,
} from './payload.pure.ts';
import { snapshotSections, validateSnapshotSpine } from './sections.pure.ts';
import { headroomChart, incomeMixChart } from './charts.pure.ts';
import { formatReportDate as formatAssessedOn } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['borrowing-capacity'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = 'Borrowing Capacity Snapshot';

// ── Judgements, rendered ────────────────────────────────────────────────────

/** How each band reads, and how much confidence its colour should carry. */
const BAND: Record<Band, { label: string; tone: ValueTone; callout: CalloutTone }> = {
  strong: { label: 'Strong', tone: 'positive', callout: 'positive' },
  moderate: { label: 'Moderate', tone: 'neutral', callout: 'caution' },
  limited: { label: 'Limited', tone: 'negative', callout: 'negative' },
};

/**
 * A direction, in words.
 *
 * The shipping report says this with colour alone, and says it wrong: a HEM
 * floor that *reduces* capacity is drawn green because its delta is positive
 * (F6). Words are also the version that survives a monochrome printer and a
 * reader who cannot separate red from green — which, on a document about
 * someone's borrowing, is not a small consideration.
 */
export const AUDIT_EFFECT: Record<Direction, string> = {
  favourable: 'Increases',
  adverse: 'Reduces',
  neutral: '—',
};

/**
 * What the effect column is short for. Printed above the table, because
 * "Reduces" on its own is a word, not a statement.
 */
export const AUDIT_EFFECT_LEGEND =
  'The effect column says which way each adjustment moves the borrowing capacity — '
  + 'an adjustment can be an increase and still reduce what can be borrowed.';

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-08-01T00:00:00.000Z` → `01 August 2026`.
 *
 * Parsed rather than passed to `Date`, for two reasons: this module must stay
 * pure, and `toLocaleDateString` depends on the runtime's ICU build — the same
 * document would date itself differently in Deno and in Node.
 */
export { formatAssessedOn };

// ── Input ───────────────────────────────────────────────────────────────────

export interface RenderSnapshotInput {
  payload: BorrowingCapacitySnapshot;
  /** From the report's brand snapshot. Phase 3 wires that up. */
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  /** Full-bleed cover art as a `data:` URI. */
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  /** `VOL. 2026 · ED. 08`. Supplied, never computed — this module has no clock. */
  edition?: string | null;
  /** Printed at the foot of the cover, right side. An assessment id, typically. */
  reference?: string | null;
  /** Cover foot, left. The snapshot's wording; defaults to the house line. */
  confidentiality?: string | null;
}

// ── Section renderers ───────────────────────────────────────────────────────

const p = (text: string) => (text ? `<p>${escapeHtml(text)}</p>` : '');
/**
 * A subhead inside a chapter.
 *
 * `h2`, not `h3`. Six of these formats grew their own `const h3` helper for
 * "a subhead" while the design system's actual subhead — `h2` at 17pt, whose
 * rule in `css.pure.ts` carries a paragraph explaining that it is a different
 * object from a chapter title — went unused in every one of them. A chapter
 * title is an `h1`, so an `h3` under it skips a level, and PDF/UA 7.4.2 fails
 * on exactly that: "heading level 2 is skipped in a descending sequence".
 *
 * Seven of the ten documents failed the same rule and no other. Named
 * `subhead` rather than `h2` so the next person reaches for the level the
 * design system defines instead of inventing one.
 */
const subhead = (text: string) => `<h2>${escapeHtml(text)}</h2>`;

/** A list where an empty list should print nothing at all. */
function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function capacitySection(s: BorrowingCapacitySnapshot, palette: ResolvedReportPalette): string {
  const band = BAND[s.headline.band];

  const capacityFoot = !s.income.recorded
    ? 'No income recorded'
    : s.headline.stressTested && s.headline.stressRate
      ? `At ${formatMeasure(s.headline.stressRate)}: ${formatMeasure(s.headline.stressTested)}`
      : s.headline.stressTested
        ? `Stress tested ${formatMeasure(s.headline.stressTested)}`
        : undefined;

  const kpis: KpiCell[] = [
    {
      label: 'Borrowing capacity',
      value: formatMeasure(s.headline.capacity),
      foot: capacityFoot,
    },
    {
      label: 'Monthly surplus',
      value: formatMeasure(s.headline.monthlySurplus),
      tone: s.headline.monthlySurplus.value >= 0 ? 'positive' : 'negative',
      foot: 'After tax and commitments',
    },
    {
      label: 'Serviceability',
      value: band.label,
      tone: band.tone,
      foot: s.headline.dti ? `DTI ${formatMeasure(s.headline.dti)}` : undefined,
    },
  ];

  const terms: TableRow[] = [
    { item: 'Interest rate', value: formatMeasure(s.headline.interestRate) },
    { item: 'Servicing buffer', value: formatMeasure(s.headline.bufferRate) },
    { item: 'Assessment rate', value: formatMeasure(s.headline.assessmentRate) },
    { item: 'Loan term', value: formatMeasure(s.headline.loanTerm) },
    { item: 'Living expenses', value: s.expenses.method },
  ];
  if (s.meta.lenderName) terms.push({ item: 'Lender policy', value: s.meta.lenderName });

  const termsTable = renderDataTable(
    [{ key: 'item', label: 'Term', align: 'left' }, { key: 'value', label: 'Value', align: 'right' }],
    terms,
    { caption: 'Assessment terms' },
  );

  // The chart and the sentence that reads it are one statement: the first
  // production render put the assessment terms between them, and the sentence
  // landed on the next page, alone at its head.
  //
  // The chart is the headroom bars — capacity, stress-tested capacity and the
  // proposed loan, each labelled with its figure — and not the utilisation
  // bullet it replaces here. The bullet's three shaded bands carried no labels
  // and meant nothing a reader could name, and the bars said the same thing
  // again two pages later: one picture, where the answer is, with its numbers
  // on it.
  const headroom = headroomChart(s, palette);
  const utilisation = s.utilisation
    ? keepTogether(
        headroom
        + renderSidenote(
          'Proposed loan',
          p(`${formatMeasure(s.utilisation.proposedLoan)} of ${formatMeasure(s.utilisation.capacity)}`
            + ` — ${formatMeasure(s.utilisation.share)} of the assessed capacity, which`
            + ` ${s.utilisation.withinCapacity ? 'falls within' : 'exceeds'} the limit.`),
        ),
      )
    : headroom;

  const lmi = s.lmi
    ? renderCallout(
        'informative',
        'Lenders Mortgage Insurance',
        renderDataTable(
          [{ key: 'item', label: 'Item', align: 'left' }, { key: 'value', label: 'Amount', align: 'right' }],
          [
            { item: 'Premium', value: formatMeasure(s.lmi.premium) },
            ...(s.lmi.lvr ? [{ item: 'LVR at trigger', value: formatMeasure(s.lmi.lvr) }] : []),
            ...(s.lmi.propertyValue ? [{ item: 'Property value', value: formatMeasure(s.lmi.propertyValue) }] : []),
            ...(s.lmi.deposit ? [{ item: 'Deposit', value: formatMeasure(s.lmi.deposit) }] : []),
            ...(s.lmi.netForPurchase ? [{ item: 'Net for purchase', value: formatMeasure(s.lmi.netForPurchase) }] : []),
          ],
        )
        + p(s.lmi.mode === 'debt_capitalised'
          ? 'The premium is capitalised onto the loan, so it increases total debt and is carried into the DTI.'
          : 'The premium is taken from the deposit, so it reduces the amount available for the purchase.'),
      )
    : '';

  // Deliberately not a two-column grid. `renderGrid12` lays out as a CSS table,
  // and a table cell cannot be split across pages — so when one column fits at
  // the foot of a page and the other does not, WeasyPrint moves that column
  // whole and the layout tears in half. The first render of this document put
  // the assessment terms on the page after the sidenote they were beside.
  //
  // The settings the engine recorded are not here any more: seventeen rows of
  // them opened the document and ran onto a page of their own. They are the
  // last section, "On what basis", read in the report's words (`basis.pure.ts`).
  return renderLede(s.narrative)
    + renderKpiStrip(kpis)
    + utilisation
    + keepTogether(termsTable)
    + lmi;
}

/**
 * Binds a short block to one page.
 *
 * Used only around things a reader takes in at once — a table of five rows, a
 * chart and its sentence, the advice at the end — never around a long table,
 * which would move whole and leave a hole (`KEEP_TOGETHER_CLASS`).
 */
function keepTogether(html: string): string {
  return html ? `<div class="${KEEP_TOGETHER_CLASS}">${html}</div>` : '';
}

/** A short table stays whole; a long one may break, and repeats its head. */
const SHORT_TABLE_ROWS = 12;

function incomeSection(s: BorrowingCapacitySnapshot, palette: ResolvedReportPalette): string {
  // The period belongs in the header, once, rather than repeated down every
  // row — but only because the header states it. A bare `$124,000` beside a
  // bare `$4,820` with no period anywhere is the ambiguity `Measure` exists to
  // remove, so `formatAmount` is only ever used under a header that says so.
  const perYear = periodLabel('aud/year');
  const incomeCols: TableColumn[] = [
    { key: 'component', label: 'Income component', align: 'left' },
    { key: 'gross', label: `Gross ${perYear}`, align: 'right' },
    { key: 'shading', label: 'Assessed at', align: 'right' },
    { key: 'assessed', label: `Assessed ${perYear}`, align: 'right' },
  ];
  const incomeRows: TableRow[] = s.income.rows.map((r: IncomeRow) => ({
    component: r.label,
    gross: formatAmount(r.gross),
    shading: formatMeasure(r.shading),
    assessed: formatAmount(r.shaded),
  }));
  incomeRows.push({
    component: 'Total',
    gross: formatAmount(s.income.gross),
    shading: '',
    assessed: formatAmount(s.income.shaded),
    __total: true,
  });

  const liabilityCols: TableColumn[] = [
    { key: 'liability', label: 'Liability', align: 'left' },
    { key: 'balance', label: 'Balance', align: 'right' },
    { key: 'limit', label: 'Limit', align: 'right' },
    { key: 'servicing', label: `Servicing ${periodLabel('aud/month')}`, align: 'right' },
  ];
  const liabilityRows: TableRow[] = s.expenses.liabilities.map((l: LiabilityRow) => ({
    liability: l.provider ? `${l.kind} — ${l.provider}` : l.kind,
    balance: l.balance ? formatAmount(l.balance) : '—',
    limit: l.limit ? formatAmount(l.limit) : '—',
    servicing: formatAmount(l.monthlyServicing),
  }));
  if (liabilityRows.length) {
    liabilityRows.push({
      liability: 'Total',
      balance: '',
      limit: '',
      servicing: formatAmount(s.expenses.monthlyCommitments),
      __total: true,
    });
  }

  const shaded = s.income.rows.filter((r) => r.shading.value < 1);
  const shadingNote = shaded.length
    ? renderSidenote(
        'On shading',
        p('A lender counts some income at less than face value. '
          + `${shaded.length === 1 ? 'One component is' : `${shaded.length} components are`} `
          + 'assessed below 100% here; the assessed column is what the serviceability '
          + 'calculation uses.'),
      )
    : '';

  // No income recorded: a table holding nothing but "Total $0 $0" says the
  // same thing worse. Said once, and what to do about it.
  const incomeBlock = s.income.recorded
    ? (incomeRows.length <= SHORT_TABLE_ROWS ? keepTogether : (h: string) => h)(
        renderDataTable(incomeCols, incomeRows, { caption: 'Income, before and after shading' }),
      )
      + incomeMixChart(s, palette)
      + shadingNote
    : renderCallout(
        'caution',
        'No income recorded',
        p('This assessment holds no income for the household, so there is nothing to assess a loan '
          + 'against. The living expenses below are what the assessment applied; recording the income '
          + 'and recalculating is what produces a borrowing capacity.'),
      );

  return incomeBlock
    + subhead('Expenses and commitments')
    // Short labels on purpose. A KPI label that wraps to two lines pushes its
    // own value down while its neighbours stay put, and the strip's baselines
    // stop lining up — visible in the first render of this document.
    + renderKpiStrip([
      { label: 'Living expenses', value: formatMeasure(s.expenses.monthlyLiving) },
      { label: 'Commitments', value: formatMeasure(s.expenses.monthlyCommitments) },
      { label: 'Method', value: s.expenses.method },
    ])
    + (liabilityRows.length <= SHORT_TABLE_ROWS ? keepTogether : (h: string) => h)(
      renderDataTable(liabilityCols, liabilityRows, { caption: 'Existing liabilities' }),
    );
}

function ledgerSection(s: BorrowingCapacitySnapshot, _palette: ResolvedReportPalette): string {
  const rows: TableRow[] = s.ledger.map((r: LedgerRow) => ({
    line: r.label,
    amount: formatMeasure(r.amount),
    __total: r.emphasis === 'total',
  }));

  const dti = s.debtToIncome;
  const dtiNote = dti
    ? renderSidenote(
        'The debt-to-income ratio',
        p(`${formatMeasure(dti.ratio)} is every debt the assessment counted, divided by `
          + `${formatMeasure(aud(dti.income.value))} of annual income. `
          + (dti.existingDebt
            ? `That is about ${formatMeasure(dti.existingDebt)} already owed`
              + (dti.includesPropertyLoans ? ', including the loans on properties held,' : '')
              + ` plus the ${formatMeasure(dti.capacity)} of new borrowing assessed here.`
            : `The debt counted is the ${formatMeasure(dti.capacity)} of new borrowing assessed here.`)),
      )
    : '';

  const recommendations = s.recommendations.length
    ? renderCallout('positive', 'What would move this', renderList(s.recommendations))
    : '';
  const warnings = s.warnings.length
    ? renderCallout('caution', 'Worth knowing', renderList(s.warnings))
    : '';

  return keepTogether(renderDataTable(
      [{ key: 'line', label: 'Monthly working', align: 'left' }, { key: 'amount', label: 'Amount', align: 'right' }],
      rows,
      { caption: 'From income to maximum capacity', signedKeys: ['amount'] },
    ))
    + keepTogether(dtiNote)
    // Each callout whole, but not bound to each other: bound, the pair moved
    // as one and left a third of a page empty above it. "Worth knowing" alone
    // at the head of a page — what the first production render did — cannot
    // happen now, because "On what basis" follows it.
    + keepTogether(recommendations)
    + keepTogether(warnings);
}

/**
 * The settings the assessment was run under, last.
 *
 * They are the answer to "on what basis?", which a reader asks after the
 * figures and not before them.
 */
function basisSection(s: BorrowingCapacitySnapshot): string {
  if (!s.assumptions.length) return '';
  return keepTogether(renderDataTable(
    [{ key: 'item', label: 'Setting', align: 'left' }, { key: 'value', label: 'As applied', align: 'right' }],
    s.assumptions.map((a) => ({ item: a.label, value: a.value })),
    { caption: 'The policy this assessment was run under' },
  ));
}

function explanationSection(s: BorrowingCapacitySnapshot): string {
  const e = s.explanation;
  if (!e) return '';
  const headline = e.headline ? renderCallout('neutral', 'In short', p(e.headline)) : '';
  const steps = e.steps.map((step, i) => {
    const figures = step.figures.length
      ? renderDataTable(
          [{ key: 'item', label: 'Figure', align: 'left' }, { key: 'value', label: 'Amount', align: 'right' }],
          step.figures.map((f) => ({ item: f.label, value: formatMeasure(f.value) })),
        )
      : '';
    return subhead(`${i + 1}. ${step.title}`) + p(step.narrative) + figures;
  }).join('');
  return headline + steps;
}

function auditSection(s: BorrowingCapacitySnapshot): string {
  const a = s.audit;
  if (!a) return '';

  const summary = renderKpiStrip([
    { label: 'Income shading', value: formatMeasure(a.summary.incomeShading) },
    { label: 'Expenses', value: formatMeasure(a.summary.expenseAdjustments) },
    { label: 'Liabilities', value: formatMeasure(a.summary.liabilityAdjustments) },
    { label: 'Tax', value: formatMeasure(a.summary.taxImpact) },
  ]);

  const cols: TableColumn[] = [
    { key: 'item', label: 'Item', align: 'left' },
    { key: 'raw', label: 'Provided', align: 'right' },
    { key: 'assessed', label: 'Assessed', align: 'right' },
    { key: 'change', label: 'Change', align: 'right' },
    { key: 'effect', label: 'Effect', align: 'left' },
    { key: 'rule', label: 'Rule', align: 'left' },
  ];

  // One table, not one per category.
  //
  // Rendering a table per group repeats the six-column header five times in
  // half a page, and each block is separately unbreakable, so a group that does
  // not fit moves whole and strands the rest. The category rides in the item
  // label instead; the rows are already grouped, so it reads as a heading
  // without being one.
  const rows: TableRow[] = a.groups.flatMap((g) =>
    g.rows.map((r: AuditRow): TableRow => ({
      item: `${categoryCaption(g.category)} — ${r.label}`,
      raw: formatMeasure(r.raw),
      assessed: formatMeasure(r.assessed),
      change: r.delta ? formatDelta(r.delta) : '—',
      effect: AUDIT_EFFECT[r.direction],
      rule: r.rule,
    })));
  const groups = renderDataTable(cols, rows, { caption: 'Every adjustment, in order' });

  return renderCallout(
    'neutral',
    'Reading this table',
    p('"Provided" is the figure as it was given to us. "Assessed" is what the '
      + `lender's policy allows to be counted. ${AUDIT_EFFECT_LEGEND}`),
  ) + summary + groups;
}

const CATEGORY_CAPTION: Record<string, string> = {
  income: 'Income',
  tax: 'Tax',
  expense: 'Expenses',
  property: 'Property cashflow',
  liability: 'Liabilities',
  constraint: 'Constraints',
  policy: 'Lender policy',
};

function categoryCaption(category: string): string {
  return CATEGORY_CAPTION[category] ?? category;
}

function scenarioSection(s: BorrowingCapacitySnapshot): string {
  const rows = s.scenarios;
  if (!rows) return '';

  const cols: TableColumn[] = [
    { key: 'scenario', label: 'Scenario', align: 'left' },
    { key: 'capacity', label: 'Capacity', align: 'right' },
    { key: 'surplus', label: `Surplus ${periodLabel('aud/month')}`, align: 'right' },
    { key: 'band', label: 'Serviceability', align: 'left' },
    { key: 'change', label: 'Against base', align: 'right' },
  ];

  const tableRows: TableRow[] = rows.map((r: ScenarioRow) => ({
    scenario: r.name,
    capacity: formatMeasure(r.capacity),
    surplus: formatAmount(r.monthlySurplus),
    band: BAND[r.band].label,
    change: r.change ? formatDelta(r.change) : '—',
  }));

  // What moved reads as prose, not as a table cell: in a narrow column
  // "Commitments -$240/mo" breaks after the hyphen and the figure lands on its
  // own line. It has room here, beside the rest of the scenario's detail.
  const details = rows
    .filter((r) => r.adjustments.length || r.details.length)
    .map((r) => subhead(r.name) + renderList([
      ...(r.adjustments.length ? [`Changed: ${r.adjustments.join(' · ')}`] : []),
      ...r.details,
    ]))
    .join('');

  return renderDataTable(cols, tableRows, { caption: 'Modelled scenarios', signedKeys: ['change'] })
    + details
    + renderCallout(
      'caution',
      'These are models',
      p('Scenario figures are estimates based on modelled adjustments. Actual lending '
        + 'outcomes depend on the lender\'s credit assessment at the time of application.'),
    );
}

const SECTION_BODY: Record<
  string,
  (s: BorrowingCapacitySnapshot, palette: ResolvedReportPalette) => string
> = {
  capacity: capacitySection,
  income: incomeSection,
  ledger: ledgerSection,
  explanation: explanationSection,
  audit: auditSection,
  scenarios: scenarioSection,
  basis: (s) => basisSection(s),
};

// ── The document ────────────────────────────────────────────────────────────

/**
 * The body — cover, sections, closing — without the shell.
 *
 * Separate from `renderBorrowingCapacityDocument` so a test can assert on the
 * markup without carrying 30KB of stylesheet through every assertion.
 */
export function renderSnapshotBody(input: RenderSnapshotInput): string {
  const { payload } = input;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    title: payload.meta.clientName,
    // The masthead is the *tenant's* company, resolved from the brand snapshot.
    // The shipping cover is a raster of ours, and prints our name on every
    // white-label tenant's report (F1).
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    // No "prepared by": the masthead at the head of the cover is the issuing
    // company, and printing it twice on one page reads as a mistake.
    meta: [
      { label: 'Assessment date', value: formatAssessedOn(payload.meta.assessedOn) },
      { label: 'Assessment rate', value: formatMeasure(payload.headline.assessmentRate) },
      { label: 'Loan term', value: formatMeasure(payload.headline.loanTerm) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const sections = snapshotSections(payload).map((section, index) => {
    const body = SECTION_BODY[section.id]?.(payload, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    // The running head's eyebrow is the document, not `Section 01` — the page
    // prints that immediately below in the chapter header, and the two sat
    // 150px apart in the first render.
    // Sections run on under one another (`RUN_ON_CHAPTER_CLASS`): each opened a
    // page, and a two-page answer printed on six to eight sheets — a page
    // holding one liabilities total, another one "Worth knowing" callout.
    return openChapter(DOCUMENT_NAME, number, section.title, 'body', { runOn: index > 0 })
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${body}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + sections + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path — `render-investment-report-pdf` re-throws when WeasyPrint fails — so a
 * document that is wrong is better as an error here, where the message names the
 * problem, than as a PDF a client opens.
 */
export function renderBorrowingCapacityDocument(input: RenderSnapshotInput): string {
  const problems = validateSnapshotSpine(input.payload);
  if (problems.length) {
    throw new Error(`Borrowing Capacity Snapshot has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.payload.meta.clientName}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderSnapshotBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderSnapshotFromBrandInput {
  payload: BorrowingCapacitySnapshot;
  /**
   * The brand, as it was at generation time.
   *
   * This is the input the render path uses. Everything the document looks like
   * — the palette, the marks, the company on the cover and the closing page,
   * the running foot — comes from here, so a report re-issued a year later
   * reproduces the brand it was issued under rather than today's.
   */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art — see `brand.pure.ts`. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
}

/**
 * The document and whatever the snapshot was missing.
 *
 * The gaps travel beside the HTML rather than being thrown or swallowed: "no
 * ABN on an Australian advisory document" is worth a line in a log, and is not
 * worth failing a client's report over.
 */
export interface SnapshotRenderResult {
  html: string;
  gaps: string[];
}

export function renderSnapshotFromBrand(input: RenderSnapshotFromBrandInput): SnapshotRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderBorrowingCapacityDocument({
      payload: input.payload,
      palette: input.design?.palette ?? brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: withDesignOptions(input.options, input.design),
      edition: input.edition ?? null,
      reference: input.reference ?? null,
    }),
    gaps: brand.gaps,
  };
}

/** Re-exported so a caller does not need `measure.pure.ts` just to label a KPI. */
export { formatMeasure, formatDelta };
export type { Measure };
