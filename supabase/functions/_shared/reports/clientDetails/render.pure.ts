/**
 * The client's record as HTML, through the design system.
 *
 * ## What this replaces, and what was actually wrong with it
 *
 * Not the design. `FormaraPDFGenerator` builds careful HTML — per-property
 * blocks, equity bars, cash-flow indicators — and then does something to it that
 * throws all of that away: it writes the markup into a hidden iframe, rasterises
 * every page with html2canvas, and pastes the images into jsPDF.
 *
 * So a client's fact-find arrives as a stack of **pictures**. No selectable
 * text, no search, no copy, no accessibility, no tagged structure. The broker on
 * the other end of "Send to Finance" cannot lift a single figure out of it. That
 * is the whole of this migration's value.
 *
 * Three more fall out of the same step and are fixed by not taking it:
 *
 *  - the render scale was chosen from `totalHtmlElements > 8` and
 *    `navigator.deviceMemory`, so a client with more properties got a *lower
 *    resolution* document and two advisers produced different files;
 *  - a two-minute cap turned the longest records into "PDF generation timed out";
 *  - the cover was `/templates/npc-formara-cover.jpg`, our own letterhead, on
 *    every white-label tenant's document.
 *
 * Here the cover art comes from the tenant's own asset and nowhere else, and
 * WeasyPrint sets real text at a resolution that has nothing to do with anyone's
 * laptop.
 *
 * ## No emoji
 *
 * The legacy headings carry `🏠 Owner Occupied`, `📈 Investment`, `🏛️ SMSF`,
 * `💸 Personal Expenses`, and `✓ ✗ ⏳ ▲ ▼ ●` for compliance and direction. Safe
 * in a raster of the browser's own rendering; tofu the moment the page is real
 * text, because the design system's faces carry no emoji coverage. Every one is
 * a word or a sign here, and `normalise.pure.ts` is where that happens so it
 * cannot be undone by a renderer.
 *
 * ## The legacy generator stays
 *
 * This is a second path. `FormaraPDFGenerator` still draws its document, both
 * its buttons still work, and both email paths still reach it.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderBandedMatrix,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type KpiCell,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { formatAmount, formatMeasure } from '../../reportDesign/measure.pure.ts';

import type { ClientDetails, Contact, PropertyRow } from './payload.pure.ts';
import {
  clientDetailsSections,
  clientDetailsSpine,
  validateClientDetailsSpine,
} from './sections.pure.ts';
import {
  expenseCompositionChart,
  incomeAgainstCommitmentsChart,
  valueAgainstDebtChart,
} from './charts.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['client-details'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-08-02T…` → `02 August 2026`.
 *
 * Parsed rather than handed to `Date`: this module is pure, and
 * `toLocaleDateString` depends on the runtime's ICU build, so the same record
 * would date itself differently in Deno and in Node.
 */
export { formatReportDate };

// ── Escaping helpers ────────────────────────────────────────────────────────

const p = (t: string) => (t ? `<p>${escapeHtml(t)}</p>` : '');
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

/** An em dash for what is not recorded, so a cell is never silently blank. */
const show = (m: Measure | null): string => (m ? formatMeasure(m) : '—');
const orDash = (s: string): string => (s ? s : '—');

/** A two-column "term / value" table, the shape most of this document uses. */
function definitionTable(
  rows: Array<{ item: string; value: string; total?: boolean }>,
  caption: string,
  valueHeading = 'Detail',
): string {
  const kept = rows.filter((r) => r.value && r.value !== '—');
  if (!kept.length) return '';
  return renderDataTable(
    [
      { key: 'item', label: 'Term', align: 'left' },
      { key: 'value', label: valueHeading, align: 'right' },
    ],
    kept.map((r) => ({ item: r.item, value: r.value, ...(r.total ? { __total: true } : {}) })),
    { caption, signedKeys: ['value'] },
  );
}

// ── Section renderers ───────────────────────────────────────────────────────

function contactBlock(contact: Contact, residence: ClientDetails['household']['residences'][number] | undefined): string {
  const heading = contact.role === 'primary' ? 'Primary contact' : 'Second contact';
  const details = definitionTable([
    { item: 'Name', value: orDash(contact.name) },
    { item: 'Mobile', value: orDash(contact.mobile) },
    { item: 'Email', value: orDash(contact.email) },
    { item: 'Date of birth', value: orDash(contact.dateOfBirth) },
    { item: 'Gender', value: orDash(contact.gender) },
  ], `${heading} — details`);

  if (!residence) return subhead(heading) + details;

  const r = residence.residence;
  const address = [r.address, r.suburb, `${r.state} ${r.postcode}`.trim(), r.country]
    .map((x) => x.trim()).filter(Boolean).join(', ');

  const where = residence.sharedWithPrimary
    ? p('Lives at the same address as the primary contact.')
    : definitionTable([
      { item: 'Address', value: orDash(address) },
      { item: 'Living situation', value: orDash(r.livingSituation) },
      { item: 'Residential status', value: orDash(r.residentialStatus) },
    ], `${heading} — address and status`);

  return subhead(heading) + details + where;
}

function whoSection(cf: ClientDetails): string {
  const h = cf.household;
  const byRole = new Map(h.residences.map((x) => [x.contact, x]));

  const household = definitionTable([
    { item: 'Marital status', value: orDash(h.maritalStatus) },
    { item: 'Dependents', value: h.dependents ? formatMeasure(h.dependents) : '—' },
    { item: 'People on this record', value: String(h.contacts.length) },
  ], 'The household');

  const history = h.history.length
    ? subhead('Address history')
      + renderDataTable(
        [
          { key: 'address', label: 'Address', align: 'left' },
          { key: 'situation', label: 'Situation', align: 'left' },
          { key: 'from', label: 'From', align: 'right' },
          { key: 'to', label: 'To', align: 'right' },
        ],
        h.history.map((period) => ({
          address: period.address,
          situation: orDash(period.livingSituation),
          from: orDash(period.startDate),
          to: period.isCurrent ? 'Current' : orDash(period.endDate),
        })),
        { caption: 'Where they have lived, as recorded' },
      )
    : '';

  return renderLede(cf.narrative)
    + cf.household.contacts.map((c) => contactBlock(c, byRole.get(c.role))).join('')
    + household
    + history;
}

/** The home. Its own section, because a home is not a holding. */
function homeSection(cf: ClientDetails): string {
  const home = cf.ownerOccupied;
  if (!home) return '';

  const kpis: KpiCell[] = [
    { label: 'Value', value: formatMeasure(home.value) },
    {
      label: 'Equity',
      value: formatMeasure(home.equity),
      tone: home.equity.value >= 0 ? 'positive' : 'negative',
      foot: `${formatMeasure(home.lvr)} LVR`,
    },
    { label: 'Owing', value: formatMeasure(home.loanRemaining) },
  ];

  return renderKpiStrip(kpis)
    + definitionTable([
      { item: 'Address', value: orDash(home.address) },
      { item: 'Value', value: formatMeasure(home.value) },
      { item: 'Loan remaining', value: formatMeasure(home.loanRemaining) },
      { item: 'Equity', value: formatMeasure(home.equity), total: true },
      { item: 'Loan to value', value: formatMeasure(home.lvr) },
      { item: 'Lender', value: orDash(home.lender) },
      { item: 'Interest rate', value: show(home.interestRate) },
      { item: 'Repayment type', value: orDash(home.repaymentType) },
      { item: 'Monthly outgoings', value: formatAmount(home.expensesMonthly) },
    ], 'The home')
    + renderSidenote(
      'Why the home is not in the portfolio',
      p('A home is somewhere to live before it is an asset. It is counted in net '
        + 'worth, because it is owned, but it is kept out of the portfolio tables '
        + 'so that what the client *invests* is not overstated by what they '
        + 'live in.'),
    );
}

function incomeSection(cf: ClientDetails): string {
  const inc = cf.income;

  const employment = cf.employment.length
    ? renderDataTable(
      [
        { key: 'who', label: 'Contact', align: 'left' },
        { key: 'employer', label: 'Employer', align: 'left' },
        { key: 'role', label: 'Role', align: 'left' },
        { key: 'basis', label: 'Basis', align: 'left' },
        { key: 'salary', label: 'Gross salary', align: 'right' },
      ],
      cf.employment.map((e) => ({
        who: e.contact === 'secondary' ? 'Second' : 'Primary',
        employer: orDash(e.employer),
        role: orDash(e.role),
        basis: [e.employmentType, e.isCurrent ? '' : 'Former'].filter(Boolean).join(' · ') || '—',
        salary: formatAmount(e.grossAnnual),
      })),
      { caption: 'Employment, per year', signedKeys: ['salary'] },
    )
    : '';

  const other = inc.otherIncome.length
    ? subhead('Other income')
      + renderDataTable(
        [
          { key: 'label', label: 'Source', align: 'left' },
          { key: 'who', label: 'Contact', align: 'left' },
          { key: 'monthly', label: 'Per month', align: 'right' },
        ],
        inc.otherIncome.map((line) => ({
          label: line.label,
          who: line.contact === 'secondary' ? 'Second' : 'Primary',
          monthly: formatAmount(line.monthly),
        })),
        { caption: 'Income recorded outside employment', signedKeys: ['monthly'] },
      )
    : '';

  return definitionTable([
    { item: 'Primary employment', value: formatAmount(inc.primaryEmploymentMonthly) },
    ...(cf.meta.hasSecondaryContact
      ? [{ item: 'Second contact employment', value: formatAmount(inc.secondaryEmploymentMonthly) }]
      : []),
    { item: 'Other income', value: formatAmount(inc.totalOtherMonthly) },
    { item: 'Rental income', value: formatAmount(inc.rentalMonthly) },
    { item: 'Total per month', value: formatAmount(inc.totalMonthly), total: true },
    { item: 'Total per year', value: formatAmount(inc.totalGrossAnnual) },
  ], 'Income, per month', 'Per month')
    + employment
    + other;
}

function balanceSection(cf: ClientDetails): string {
  const assets = cf.assets.length
    ? renderDataTable(
      [
        { key: 'type', label: 'Asset', align: 'left' },
        { key: 'description', label: 'Detail', align: 'left' },
        { key: 'value', label: 'Value', align: 'right' },
      ],
      cf.assets.map((a) => ({
        type: a.type,
        description: orDash(a.description),
        value: formatMeasure(a.value),
      })),
      { caption: 'Assets held outside property', signedKeys: ['value'] },
    )
    : '';

  const liabilities = cf.liabilities.length
    ? subhead('Liabilities')
      + renderDataTable(
        [
          { key: 'type', label: 'Liability', align: 'left' },
          { key: 'provider', label: 'Provider', align: 'left' },
          { key: 'balance', label: 'Balance', align: 'right' },
          { key: 'servicing', label: 'Per month', align: 'right' },
          { key: 'basis', label: 'Basis', align: 'left' },
        ],
        cf.liabilities.map((l) => ({
          type: l.type,
          provider: orDash(l.provider),
          balance: formatMeasure(l.balance),
          servicing: formatAmount(l.monthlyServicing),
          basis: l.isEstimated ? `Estimated — ${l.basis}` : l.basis,
        })),
        { caption: 'What is owed, and what it costs to hold', signedKeys: ['balance', 'servicing'] },
      )
    : '';

  // Stated where the figures are, not in a footnote nobody reaches. A servicing
  // figure that is a model rather than a record changes what the number means.
  const estimates = cf.liabilitiesIncludeEstimates
    ? renderCallout(
      'neutral',
      'Some servicing figures are estimated',
      p('Where a liability records no monthly repayment, the amount shown is '
        + 'modelled from its balance or credit limit and the basis column says '
        + 'how. Those figures are what it would cost to service, not what the '
        + 'client has told us they pay.'),
    )
    : '';

  return assets + liabilities + estimates;
}

function spendingSection(cf: ClientDetails, palette: ResolvedReportPalette): string {
  if (!cf.expenses.length) return '';

  const byCategory = new Map<string, number>();
  for (const row of cf.expenses) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.monthly.value);
  }
  const total = [...byCategory.values()].reduce((s, v) => s + v, 0);

  return renderDataTable(
    [
      { key: 'category', label: 'Category', align: 'left' },
      { key: 'monthly', label: 'Per month', align: 'right' },
    ],
    [
      ...[...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([category, monthly]) => ({
          category,
          monthly: formatAmount({ value: monthly, unit: 'aud/month' }),
        })),
      {
        category: 'Total',
        monthly: formatAmount({ value: total, unit: 'aud/month' }),
        __total: true,
      },
    ],
    { caption: 'Household expenses by category', signedKeys: ['monthly'] },
  )
    + expenseCompositionChart(cf, palette)
    + subhead('Every line')
    + renderDataTable(
      [
        { key: 'category', label: 'Category', align: 'left' },
        { key: 'name', label: 'Expense', align: 'left' },
        { key: 'essential', label: 'Essential', align: 'left' },
        { key: 'monthly', label: 'Per month', align: 'right' },
      ],
      cf.expenses.map((x) => ({
        category: x.category,
        name: orDash(x.name),
        // The word, not a tick. The legacy prints `✓`, which is tofu in a real
        // text PDF and unreadable to a screen reader in any format.
        essential: x.isEssential ? 'Yes' : 'No',
        monthly: formatAmount(x.monthly),
      })),
      { caption: 'As recorded', signedKeys: ['monthly'] },
    );
}

/** The portfolio, on one landscape page. */
function portfolioSection(cf: ClientDetails): string {
  if (!cf.properties.length) return '';

  const labels = cf.properties.map((x) => x.shortAddress);
  const line = (label: string, of: (x: PropertyRow) => string, total = false) => ({
    label,
    values: cf.properties.map(of),
    total,
  });

  return renderBandedMatrix(
    'The portfolio',
    labels,
    [
      line('Type', (x) => x.kindLabel),
      line('Value', (x) => formatMeasure(x.value)),
      line('Owing', (x) => formatMeasure(x.loanRemaining)),
      line('Equity', (x) => formatMeasure(x.equity), true),
      line('LVR', (x) => formatMeasure(x.lvr)),
      line('Rent', (x) => formatAmount(x.rentMonthly)),
      line('Outgoings', (x) => formatAmount(x.expensesMonthly)),
      line('Net per month', (x) => formatAmount(x.netMonthly), true),
    ],
    {
      caption: 'Every holding, side by side. Rent and outgoings are monthly; the '
        + 'net figure is one less the other, so it cannot disagree with the two '
        + 'rows above it.',
    },
  );
}

/** Each holding's particulars, including any fund that holds it. */
function holdingsSection(cf: ClientDetails, palette: ResolvedReportPalette): string {
  if (!cf.properties.length) return '';

  return valueAgainstDebtChart(cf, palette) + cf.properties.map((x) => {
    const smsf = x.smsf
      ? subhead('The fund')
        + definitionTable([
          { item: 'Fund name', value: orDash(x.smsf.fundName) },
          { item: 'Trustee', value: orDash(x.smsf.trusteeName) },
          { item: 'Trustee type', value: orDash(x.smsf.trusteeType) },
          { item: 'ABN', value: orDash(x.smsf.abn) },
          // The word, never a tick or an hourglass.
          { item: 'Compliance status', value: orDash(x.smsf.complianceStatus) },
          { item: 'Auditor', value: orDash(x.smsf.auditorName) },
        ], 'Self-managed super fund particulars')
      : '';

    return subhead(`${x.kindLabel} — ${x.address || 'address not recorded'}`)
      + definitionTable([
        { item: 'Value', value: formatMeasure(x.value) },
        { item: 'Loan remaining', value: formatMeasure(x.loanRemaining) },
        { item: 'Equity', value: formatMeasure(x.equity), total: true },
        { item: 'Loan to value', value: formatMeasure(x.lvr) },
        { item: 'Ownership', value: show(x.ownershipPercentage) },
        { item: 'Lender', value: orDash(x.lender) },
        { item: 'Interest rate', value: show(x.interestRate) },
        { item: 'Repayment type', value: orDash(x.repaymentType) },
        { item: 'Rent, per week', value: formatMeasure(x.rentWeekly) },
        { item: 'Rent, per month', value: formatAmount(x.rentMonthly) },
        { item: 'Outgoings, per month', value: formatAmount(x.expensesMonthly) },
        { item: 'Net, per month', value: formatAmount(x.netMonthly), total: true },
      ], 'What it is worth and what it returns')
      + smsf;
  }).join('');
}

/**
 * Where they stand — the only section besides the first that is always here.
 *
 * Including for a record with nothing in it, where every figure is zero. That is
 * a true and useful statement: an adviser about to send this to a broker should
 * see that the record is empty *before* they send it, not after.
 */
function positionSection(cf: ClientDetails, palette: ResolvedReportPalette): string {
  const pos = cf.position;
  const empty = pos.netWorth.value === 0
    && pos.incomeMonthly.value === 0
    && pos.commitmentsMonthly.value === 0;

  if (empty) {
    return renderCallout(
      'caution',
      'No financial information is recorded for this client',
      p('The record holds contact details but no income, assets, liabilities, '
        + 'expenses or property. Everything above is what we have. This document '
        + 'is complete — the record is not.'),
    );
  }

  const kpis: KpiCell[] = [
    {
      label: 'Net worth',
      value: formatMeasure(pos.netWorth),
      tone: pos.netWorth.value >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Monthly surplus',
      value: formatMeasure(pos.surplusMonthly),
      tone: pos.surplusMonthly.value >= 0 ? 'positive' : 'negative',
      foot: `${formatAmount(pos.incomeMonthly)} in, ${formatAmount(pos.commitmentsMonthly)} out`,
    },
    {
      label: 'Property equity',
      value: formatMeasure(pos.propertyEquity),
      foot: `${formatMeasure(pos.propertyValue)} held`,
    },
  ];

  return renderKpiStrip(kpis)
    + definitionTable([
      { item: 'Property value', value: formatMeasure(pos.propertyValue) },
      { item: 'Property debt', value: formatMeasure(pos.propertyDebt) },
      { item: 'Property equity', value: formatMeasure(pos.propertyEquity), total: true },
      { item: 'Other assets', value: formatMeasure(pos.otherAssets) },
      { item: 'Other liabilities', value: formatMeasure(pos.otherLiabilities) },
      { item: 'Net worth', value: formatMeasure(pos.netWorth), total: true },
    ], 'What is owned, less what is owed', 'Amount')
    + subhead('Income against commitments')
    + incomeAgainstCommitmentsChart(cf, palette)
    + definitionTable([
      { item: 'Income', value: formatAmount(pos.incomeMonthly) },
      { item: 'Committed', value: formatAmount(pos.commitmentsMonthly) },
      { item: 'Surplus', value: formatAmount(pos.surplusMonthly), total: true },
      {
        item: 'Committed, as a share of income',
        value: pos.commitmentRatio ? formatMeasure(pos.commitmentRatio) : '—',
      },
    ], 'Per month', 'Per month')
    + renderCallout(
      'caution',
      'This is a record, not an assessment',
      p('Every figure here is what the client has told us and what we have '
        + 'recorded, totalled. It is not a borrowing capacity assessment, it '
        + 'applies no lender policy, and it is not financial advice.'),
    );
}

const SECTION_BODY: Record<
  string,
  (cf: ClientDetails, palette: ResolvedReportPalette) => string
> = {
  who: whoSection,
  home: homeSection,
  income: incomeSection,
  balance: balanceSection,
  spending: spendingSection,
  portfolio: portfolioSection,
  holdings: holdingsSection,
  position: positionSection,
};

// ── The document ────────────────────────────────────────────────────────────

export interface RenderClientDetailsInput {
  details: ClientDetails;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  edition?: string | null;
  reference?: string | null;
  confidentiality?: string | null;
}

/** The body — cover, contents, sections, closing — without the stylesheet. */
export function renderClientDetailsBody(input: RenderClientDetailsInput): string {
  const cf = input.details;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The client is the subject, so the client is the title. The legacy prints
    // "CLIENT PORTFOLIO FORM" over a raster of our own letterhead — a form
    // standard's name, on a document about a person.
    title: cf.meta.clientName,
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    meta: [
      { label: 'Prepared on', value: formatReportDate(cf.meta.preparedOn) },
      ...(cf.meta.propertyCount
        ? [{ label: 'Properties held', value: String(cf.meta.propertyCount) }]
        : []),
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  // Derived from the spine, not counted by hand — so the contents cannot list a
  // section that was not built, which for a format whose sections are mostly
  // conditional is the failure most likely to happen.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(clientDetailsSpine(cf)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
  );

  const body = clientDetailsSections(cf).map((section, index) => {
    const inner = SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title)
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${inner}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + contents + body + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path, so a document that is wrong is better as an error here — where the
 * message names the problem — than as a PDF a broker opens.
 */
export function renderClientDetailsDocument(input: RenderClientDetailsInput): string {
  const problems = validateClientDetailsSpine(input.details);
  if (problems.length) {
    throw new Error(`${DOCUMENT_NAME} has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.details.meta.clientName}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderClientDetailsBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderClientDetailsFromBrandInput {
  details: ClientDetails;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /**
   * The **tenant's** cover art, inlined. Never the house art.
   *
   * This is the parameter that closes the legacy's fourth defect: it hardcodes
   * `/templates/npc-formara-cover.jpg` and puts our letterhead on every
   * white-label tenant's client record.
   */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
}

export interface ClientDetailsRenderResult {
  html: string;
  /** What the brand snapshot was missing. Reported, never thrown. */
  gaps: string[];
}

export function renderClientDetailsFromBrand(
  input: RenderClientDetailsFromBrandInput,
): ClientDetailsRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderClientDetailsDocument({
      details: input.details,
      palette: brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: input.options ?? null,
      edition: input.edition ?? null,
      reference: input.reference ?? null,
    }),
    gaps: brand.gaps,
  };
}
