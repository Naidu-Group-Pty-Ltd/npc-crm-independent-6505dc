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

import {
  ADVISOR_OPTIONS_NOTE,
  advisorOptionLine,
  type RationaleAdvisorSection,
} from './strategyRationale.pure.ts';
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
  SECTION_SUBHEAD_CLASS,
  type CalloutTone,
  type DataTableOptions,
  type KpiCell,
  type TableColumn,
  type TableRow,
  type ValueTone,
} from '../../reportDesign/primitives.pure.ts';
import { keptTable, type KeepOptions } from '../../reportDesign/tableKeeping.pure.ts';
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
 *
 * Set one modular step below the section title (`SECTION_SUBHEAD_CLASS`): the
 * sections are memo sections (see `renderSnapshotBody`), and an `h2` at the
 * design system's 17pt subhead size read as a rival section title — "1. Income
 * Assessment" eight times in one section, each a point short of the section it
 * sat in (§21).
 */
const subhead = (text: string) => `<h2 class="${SECTION_SUBHEAD_CLASS}">${escapeHtml(text)}</h2>`;

/** A list where an empty list should print nothing at all. */
function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

/**
 * This document's tables are sized by their content — a forty-character
 * address beside a five-character amount — and a long one leaves at least
 * three rows under its head at the foot of a page (`tableKeeping.pure.ts`).
 */
const TABLE_KEEP: KeepOptions = { widths: 'content', leadRows: 2 };

/**
 * A data table, kept whole when it is short and never left with one row
 * stranded when it is not — the rule the Intelligence Hub and the Portfolio
 * Performance Review keep their tables by, one implementation. Measured on a
 * recalculated assessment, the audit trail's eight rows split across a page in
 * sixteen of the 51 renders, and in eleven of them the last row printed alone
 * at the head of the next page (§21).
 */
function table(cols: TableColumn[], rows: TableRow[], opts?: DataTableOptions): string {
  return keptTable(renderDataTable(cols, rows, opts), { cols, rows }, TABLE_KEEP);
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
    // With no income on the record the engine still returns a band, and it
    // is "red": a judgement about serviceability that nothing was assessed to
    // reach. §16 named the red "Limited" among that document's faults and
    // removed the ratio and the stress test beside it; the band went too (§21).
    ...(s.income.recorded
      ? [{
          label: 'Serviceability',
          value: band.label,
          tone: band.tone,
          foot: s.headline.dti ? `DTI ${formatMeasure(s.headline.dti)}` : undefined,
        } satisfies KpiCell]
      : []),
  ];

  const terms: TableRow[] = [
    { item: 'Interest rate', value: formatMeasure(s.headline.interestRate) },
    { item: 'Servicing buffer', value: formatMeasure(s.headline.bufferRate) },
    { item: 'Assessment rate', value: formatMeasure(s.headline.assessmentRate) },
    { item: 'Loan term', value: formatMeasure(s.headline.loanTerm) },
  ];
  if (s.meta.lenderName) terms.push({ item: 'Lender policy', value: s.meta.lenderName });

  const termsTable = table(
    [{ key: 'item', label: 'Term', align: 'left' }, { key: 'value', label: 'Value', align: 'right' }],
    terms,
    { caption: 'Assessment terms' },
  );

  // The chart is the headroom bars — capacity, stress-tested capacity and the
  // proposed loan, each labelled with its figure — and not the utilisation
  // bullet it replaces here. The bullet's three shaded bands carried no labels
  // and meant nothing a reader could name, and the bars said the same thing
  // again two pages later: one picture, where the answer is, with its numbers
  // on it.
  //
  // It stands without a sidenote. The proposed loan's sentence is the opening
  // paragraph's last and its bar is in the chart, and the sidenote that sat
  // under the chart said it a third time on the same page — "$400,000 of
  // $441,146 — 91% of the assessed capacity, which falls within the limit" a
  // few lines below "The proposed loan of $400,000 is 91% of the assessed
  // capacity and falls within the limit" (§21).
  const headroom = headroomChart(s, palette);

  const lmi = s.lmi
    ? renderCallout(
        'informative',
        'Lenders Mortgage Insurance',
        renderDataTable(
          // "LVR at trigger" and "Net for purchase" were the calculator's
          // labels. The first is the purchase's loan-to-value ratio; the second
          // is the capacity less the premium, printed only where the stored
          // figure is that (`provenNetForPurchase`).
          [{ key: 'item', label: 'Item', align: 'left' }, { key: 'value', label: 'Figure', align: 'right' }],
          [
            { item: 'Premium', value: formatMeasure(s.lmi.premium) },
            ...(s.lmi.lvr ? [{ item: 'Loan-to-value ratio', value: formatMeasure(s.lmi.lvr) }] : []),
            ...(s.lmi.propertyValue ? [{ item: 'Property value', value: formatMeasure(s.lmi.propertyValue) }] : []),
            ...(s.lmi.deposit ? [{ item: 'Deposit', value: formatMeasure(s.lmi.deposit) }] : []),
            ...(s.lmi.netForPurchase ? [{ item: 'Capacity left for the purchase', value: formatMeasure(s.lmi.netForPurchase) }] : []),
          ],
        )
        // The calculator's own account of the two modes. The deducted premium
        // is paid from the loan; this said "from the deposit" (§21).
        + p(s.lmi.mode === 'debt_capitalised'
          ? 'The premium is added to the loan, so it is part of the debt the debt-to-income ratio counts, '
            + 'and its repayment is part of the commitments.'
          : 'The premium is paid from the loan, so the capacity is unchanged and less of it is left for the purchase.'),
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
    + headroom
    + termsTable
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
  const incomeLines: IncomeRow[] = s.income.proposedRent ? [...s.income.rows, s.income.proposedRent] : s.income.rows;
  const incomeRows: TableRow[] = incomeLines.map((r: IncomeRow) => ({
    component: r.label,
    gross: formatAmount(r.gross),
    shading: formatMeasure(r.shading),
    assessed: formatAmount(r.shaded),
  }));
  // A total its rows do not reach is the one figure on this page a reader can
  // check and find wrong. Where the calculator's totals and the recorded lines
  // disagree, both are printed and named, and the total is the assessment's
  // (§21).
  if (s.income.itemsTotal) {
    incomeRows.push({
      component: 'Total of the lines above',
      gross: formatAmount(s.income.itemsTotal.gross),
      shading: '',
      assessed: formatAmount(s.income.itemsTotal.shaded),
    });
  }
  incomeRows.push({
    // A "Total" with no lines above it totals nothing. Where the calculator
    // sent an income and the household has no income lines, the one row is
    // the figure the assessment ran on, and says so.
    component: s.income.itemsTotal || !incomeLines.length ? 'Used in this assessment' : 'Total',
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
  const commitmentLines: LiabilityRow[] = s.expenses.capitalisedLmi
    ? [...s.expenses.liabilities, s.expenses.capitalisedLmi]
    : s.expenses.liabilities;
  const liabilityRows: TableRow[] = commitmentLines.map((l: LiabilityRow) => ({
    liability: l.provider ? `${l.kind} — ${l.provider}` : l.kind,
    balance: l.balance ? formatAmount(l.balance) : '—',
    limit: l.limit ? formatAmount(l.limit) : '—',
    servicing: formatAmount(l.monthlyServicing),
  }));
  if (liabilityRows.length) {
    if (s.expenses.itemsTotal) {
      liabilityRows.push({
        liability: 'Total of the lines above',
        balance: '',
        limit: '',
        servicing: formatAmount(s.expenses.itemsTotal),
      });
    }
    liabilityRows.push({
      liability: s.expenses.itemsTotal ? 'Used in this assessment' : 'Total',
      balance: '',
      limit: '',
      servicing: formatAmount(s.expenses.monthlyCommitments),
      __total: true,
    });
  }

  // Said once, under the table it explains, in figures the reader can find on
  // the rows above it.
  const footingNote = (lines: string[]) => lines.length
    ? renderSidenote('Two totals', lines.map((line) => p(line)).join(''))
    : '';
  const incomeFooting = s.income.itemsTotal
    ? [`This assessment was run on the calculator's income: ${formatMeasure(s.income.gross)} gross, `
      + `${formatMeasure(s.income.shaded)} of it assessed. The lines recorded for the household come to `
      + `${formatMeasure(s.income.itemsTotal.gross)} and ${formatMeasure(s.income.itemsTotal.shaded)}. `
      + 'The working uses the figures the assessment ran on.']
    : [];
  const commitmentFooting = s.expenses.itemsTotal
    ? [`This assessment was run on the calculator's commitments of ${formatMeasure(s.expenses.monthlyCommitments)}. `
      + `The lines recorded for the household come to ${formatMeasure(s.expenses.itemsTotal)}. `
      + 'The working uses the figure the assessment ran on.']
    : [];

  const shaded = incomeLines.filter((r) => r.shading.value < 1);
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
    ? table(incomeCols, incomeRows, { caption: 'Income, before and after shading' })
      + footingNote(incomeFooting)
      + incomeMixChart(s, palette)
      + shadingNote
    // The remedy is the advice's to give, once, under the working (§21):
    // this said it here as well, a page after the opening said it first. What
    // the section shows instead is the standfirst's to say
    // (`incomeSectionNote`), so this says only why there is no table.
    : renderCallout(
        'caution',
        'No income recorded',
        p('This assessment holds no income for the household, so there is nothing to assess a loan '
          + 'against.'),
      );

  return incomeBlock
    + subhead('Expenses and commitments')
    // Short labels on purpose. A KPI label that wraps to two lines pushes its
    // own value down while its neighbours stay put, and the strip's baselines
    // stop lining up — visible in the first render of this document.
    //
    // The method is the living-expense figure's note, under the figure it
    // explains. It was a third cell — a word set in the strip's display type
    // where a figure belongs, wrapping to "HEM / benchmark" on two lines — and
    // the assessment terms on the page before said it again (§21).
    + renderKpiStrip([
      { label: 'Living expenses', value: formatMeasure(s.expenses.monthlyLiving), foot: s.expenses.method },
      { label: 'Commitments', value: formatMeasure(s.expenses.monthlyCommitments) },
    ])
    + table(liabilityCols, liabilityRows, { caption: 'Existing liabilities' })
    + footingNote(commitmentFooting);
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
              + ` plus the ${formatMeasure(dti.capacity)} of new borrowing assessed here`
            : `The debt counted is the ${formatMeasure(dti.capacity)} of new borrowing assessed here`)
          // A capitalised premium is in the engine's debt and owed by nobody
          // yet; it was being counted as "already owed" (§21).
          + (dti.capitalisedPremium
            ? `, with the ${formatMeasure(dti.capitalisedPremium)} mortgage insurance premium added to it.`
            : '.')),
      )
    : '';

  const recommendations = s.recommendations.length
    ? renderCallout('positive', 'What would move this', renderList(s.recommendations))
    : '';
  const warnings = s.warnings.length
    ? renderCallout('caution', 'Worth knowing', renderList(s.warnings))
    : '';

  // No caption: the section's standfirst is "The arithmetic from gross income
  // to maximum capacity", and a caption reading "From income to maximum
  // capacity" directly under it said it twice in two lines (§21). The audit
  // trail and the basis lost theirs for the same reason.
  return keepTogether(renderDataTable(
      [{ key: 'line', label: 'Monthly working', align: 'left' }, { key: 'amount', label: 'Amount', align: 'right' }],
      rows,
      { signedKeys: ['amount'] },
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
  return table(
    [{ key: 'item', label: 'Setting', align: 'left' }, { key: 'value', label: 'As applied', align: 'right' }],
    s.assumptions.map((a) => ({ item: a.label, value: a.value })),
  );
}

function auditSection(s: BorrowingCapacitySnapshot): string {
  const a = s.audit;
  if (!a) return '';

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
  // not fit moves whole and strands the rest. The rows stay in category order,
  // and each label now says what its row holds ("Income after tax and the
  // Medicare levy", "Property costs not covered by rent — …"; `AUDIT_LABEL`),
  // so the category no longer rides in front of it: "Income — Property cash
  // flow — 14 Wattle Grove Sampleton" was two dashes and a word the label
  // already said (§21).
  //
  // The engine's four category totals no longer open the table either. Its
  // "Liabilities" total was each repayment less its balance — $417,550 printed
  // beside a $420,000 mortgage — and its "Tax" counted the Medicare levy twice;
  // the rows below carry every figure, each in its own unit.
  const rows: TableRow[] = a.groups.flatMap((g) =>
    g.rows.map((r: AuditRow): TableRow => ({
      item: r.label,
      raw: formatMeasure(r.raw),
      assessed: formatMeasure(r.assessed),
      change: r.delta ? formatDelta(r.delta) : '—',
      effect: AUDIT_EFFECT[r.direction],
      rule: r.rule,
    })));
  const groups = table(cols, rows);

  return renderCallout(
    'neutral',
    'Reading this table',
    p('"Provided" is the figure as it was given to us. "Assessed" is what the '
      + `lender's policy allows to be counted. ${AUDIT_EFFECT_LEGEND}`),
  ) + groups;
}

/**
 * The Strategy Advisor's reasoning for a scenario saved from one of its cards,
 * worded by `composeAdvisorSection` exactly as the Strategy Rationale words it.
 */
function advisorBlock(a: RationaleAdvisorSection): string {
  const para = (t: string) => `<p>${escapeHtml(t)}</p>`;
  const labelled = (title: string, items: string[]) => (items.length
    ? `<p><strong>${escapeHtml(title)}</strong></p>` + renderList(items)
    : '');
  return `<p><strong>${escapeHtml(a.title)}</strong></p>`
    + a.paragraphs.map(para).join('')
    + (a.riskLine ? `<p><strong>${escapeHtml(a.riskLine)}</strong></p>` : '')
    + labelled(a.evidenceTitle, a.evidence)
    + labelled(a.rejectedTitle, a.rejected)
    + labelled(a.cautionsTitle, a.cautions)
    + (a.options.length
      ? labelled(a.optionsTitle, a.options.map(advisorOptionLine)) + `<p><em>${escapeHtml(ADVISOR_OPTIONS_NOTE)}</em></p>`
      : '')
    + a.notes.map((n) => `<p><em>${escapeHtml(n)}</em></p>`).join('');
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
    .filter((r) => r.adjustments.length || r.details.length || r.advisor)
    .map((r) => subhead(r.name)
      + ((r.adjustments.length || r.details.length) ? renderList([
        ...(r.adjustments.length ? [`Changed: ${r.adjustments.join(' · ')}`] : []),
        ...r.details,
      ]) : '')
      + (r.advisor ? advisorBlock(r.advisor) : ''))
    .join('');

  return table(cols, tableRows, { caption: 'Modelled scenarios', signedKeys: ['change'] })
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
    // And they are memo sections (`MEMO_CHAPTER_CLASS`), as the Intelligence
    // Hub's and the Portfolio Performance Review's are: a run-on section's
    // title was still set at the chapter-opener size, so a heading block a
    // sixth of a page tall moved to the next page with the block it opens. On
    // a recalculated assessment that left page 4 holding one liabilities table
    // and 65% white; on a client with no income, three of the four body pages
    // opened on a section title for that reason alone (§21).
    return openChapter(DOCUMENT_NAME, number, section.title, 'body', { runOn: index > 0, memo: true })
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
