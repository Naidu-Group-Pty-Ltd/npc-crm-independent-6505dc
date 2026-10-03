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
  renderSidenote,
  SECTION_SUBHEAD_CLASS,
  type DataTableOptions,
  type KpiCell,
  type TableColumn,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import { keptTable } from '../../reportDesign/tableKeeping.pure.ts';
import {
  PORTRAIT_MATRIX_MAX,
  portraitMatrixCss,
  renderPortraitMatrix,
} from '../../reportDesign/portraitMatrix.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { aud, audPerMonth, formatAmount, formatMeasure } from '../../reportDesign/measure.pure.ts';

import type { ClientDetails, Contact } from './payload.pure.ts';
import { recordHoldsFinancials } from './payload.pure.ts';
import { addressLine, streetLine } from './normalise.pure.ts';
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
 * A subhead inside a section.
 *
 * `h2`, not `h3`. Six of these formats grew their own `const h3` helper for
 * "a subhead" while the design system's actual subhead went unused in every one
 * of them. A section title is an `h1`, so an `h3` under it skips a level, and
 * PDF/UA 7.4.2 fails on exactly that: "heading level 2 is skipped in a
 * descending sequence".
 *
 * Set one modular step below the section title (`SECTION_SUBHEAD_CLASS`): the
 * sections are memo sections now (see `renderClientDetailsBody`), and an `h2`
 * at the full subhead size read as a rival title — "Primary contact" and
 * "Liabilities" set within a point of the section they belong to.
 */
const subhead = (text: string) => `<h2 class="${SECTION_SUBHEAD_CLASS}">${escapeHtml(text)}</h2>`;

/** An em dash for what is not recorded, so a cell is never silently blank. */
const show = (m: Measure | null): string => (m ? formatMeasure(m) : '—');
const orDash = (s: string): string => (s ? s : '—');

/**
 * This document's tables are sized by their content — a ten-character label
 * beside a fifty-character address — so their height is estimated that way,
 * and a long one leaves at least three rows under its head at the foot of a
 * page rather than two (`tableKeeping.pure.ts`).
 */
const TABLE_KEEP = { widths: 'content', leadRows: 2 } as const;

/**
 * A data table, kept whole when it is short and never left with one row
 * stranded when it is not — the Intelligence Hub's rule, one implementation.
 * Measured before: 55 tables across the five record shapes and 51 designs left
 * a single row alone at the head or foot of a page.
 */
function table(cols: TableColumn[], rows: TableRow[], opts?: DataTableOptions): string {
  return keptTable(renderDataTable(cols, rows, opts), { cols, rows }, TABLE_KEEP);
}

/** A two-column "term / value" table, the shape most of this document uses. */
function definitionTable(
  rows: Array<{ item: string; value: string; total?: boolean }>,
  caption: string,
  valueHeading = 'Detail',
): string {
  const kept = rows.filter((r) => r.value && r.value !== '—');
  if (!kept.length) return '';
  const cols: TableColumn[] = [
    { key: 'item', label: 'Term', align: 'left' },
    { key: 'value', label: valueHeading, align: 'right' },
  ];
  return table(
    cols,
    kept.map((r) => ({ item: r.item, value: r.value, ...(r.total ? { __total: true } : {}) })),
    { caption, signedKeys: ['value'] },
  );
}

/**
 * Whose a row is, by first name, for a column that says so. "Primary" and
 * "Second" made a broker look up which of two people each one was.
 *
 * `role` is a `string` because the payload types a row's contact as
 * `ContactRole | string`, though the normaliser only ever writes the two roles.
 */
function whose(cf: ClientDetails, role: string): string {
  const contact = cf.household.contacts.find((c) => c.role === role);
  return contact?.name.split(/\s+/)[0] || (role === 'secondary' ? 'Second contact' : 'Primary contact');
}

/** Any property is held, the home included. */
const holdsProperty = (cf: ClientDetails): boolean =>
  cf.properties.length > 0 || cf.ownerOccupied !== null;

// ── Section renderers ───────────────────────────────────────────────────────

function contactBlock(contact: Contact, residence: ClientDetails['household']['residences'][number] | undefined): string {
  const heading = contact.role === 'primary' ? 'Primary contact' : 'Second contact';
  // The subhead names the person; the captions say which of their details a
  // table holds, where they used to repeat the subhead ("Primary contact —
  // details" under "Primary contact").
  const details = definitionTable([
    { item: 'Name', value: orDash(contact.name) },
    { item: 'Mobile', value: orDash(contact.mobile) },
    { item: 'Email', value: orDash(contact.email) },
    { item: 'Date of birth', value: orDash(contact.dateOfBirth) },
    { item: 'Gender', value: orDash(contact.gender) },
  ], 'Details');

  if (!residence) return subhead(heading) + details;

  const r = residence.residence;
  const where = residence.sharedWithPrimary
    ? p('Lives at the same address as the primary contact.')
    : definitionTable([
      { item: 'Address', value: orDash(addressLine(r.address, r.suburb, r.state, r.postcode, r.country)) },
      { item: 'Living situation', value: orDash(r.livingSituation) },
      { item: 'Residential status', value: orDash(r.residentialStatus) },
    ], 'Address and status');

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

  const twoPeople = cf.meta.hasSecondaryContact;
  const history = h.history.length
    ? subhead('Address history')
      + table(
        [
          { key: 'address', label: 'Address', align: 'left' },
          ...(twoPeople ? [{ key: 'who', label: 'Contact', align: 'left' as const }] : []),
          { key: 'situation', label: 'Situation', align: 'left' },
          { key: 'from', label: 'From', align: 'right' },
          { key: 'to', label: 'To', align: 'right' },
        ],
        h.history.map((period) => ({
          address: period.address,
          ...(twoPeople ? { who: whose(cf, period.contact) } : {}),
          situation: orDash(period.livingSituation),
          from: orDash(period.startDate),
          to: period.isCurrent ? 'Current' : orDash(period.endDate),
        })),
        { caption: 'Where they have lived, as recorded' },
      )
    : '';

  // The record's summary sits under the contents (`renderClientDetailsBody`);
  // this section opens on the people it is about.
  return cf.household.contacts.map((c) => contactBlock(c, byRole.get(c.role))).join('')
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

  // Only where there is a portfolio for the home to be kept out of; it used to
  // explain "the portfolio tables" to a client who has none, and it printed
  // `*invests*` with its asterisks, because the sentence was escaped as text.
  const aside = cf.properties.length
    ? renderSidenote(
      'Why the home is not in the portfolio',
      '<p>A home is somewhere to live before it is an asset. It is counted in net '
        + 'worth, because it is owned, but it is kept out of the portfolio tables '
        + 'so that what the client <em>invests</em> is not overstated by what they '
        + 'live in.</p>',
    )
    : '';

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
    + aside;
}

function incomeSection(cf: ClientDetails): string {
  const inc = cf.income;
  const twoPeople = cf.meta.hasSecondaryContact;

  const employment = cf.employment.length
    ? table(
      [
        ...(twoPeople ? [{ key: 'who', label: 'Contact', align: 'left' as const }] : []),
        { key: 'employer', label: 'Employer', align: 'left' },
        { key: 'role', label: 'Role', align: 'left' },
        { key: 'basis', label: 'Basis', align: 'left' },
        { key: 'salary', label: 'Gross salary', align: 'right' },
      ],
      cf.employment.map((e) => ({
        ...(twoPeople ? { who: whose(cf, e.contact) } : {}),
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
      + table(
        [
          { key: 'label', label: 'Source', align: 'left' },
          ...(twoPeople ? [{ key: 'who', label: 'Contact', align: 'left' as const }] : []),
          { key: 'monthly', label: 'Per month', align: 'right' },
        ],
        inc.otherIncome.map((line) => ({
          label: line.label,
          ...(twoPeople ? { who: whose(cf, line.contact) } : {}),
          monthly: formatAmount(line.monthly),
        })),
        { caption: 'Income recorded outside employment', signedKeys: ['monthly'] },
      )
    : '';

  // A line for each kind of income the record holds. "Rental income $0" for a
  // client with no property, or "Other income $0" beside no other income, is
  // not a figure about the client; the totals are always printed.
  const lines = [
    {
      item: twoPeople ? `Employment (${whose(cf, 'primary')})` : 'Employment',
      value: inc.primaryEmploymentMonthly,
    },
    ...(twoPeople
      ? [{ item: `Employment (${whose(cf, 'secondary')})`, value: inc.secondaryEmploymentMonthly }]
      : []),
    { item: 'Other income', value: inc.totalOtherMonthly },
    { item: 'Rental income', value: inc.rentalMonthly },
  ].filter((l) => l.value.value !== 0);

  return definitionTable([
    ...lines.map((l) => ({ item: l.item, value: formatAmount(l.value) })),
    { item: 'Total per month', value: formatAmount(inc.totalMonthly), total: true },
    { item: 'Total per year', value: formatAmount(inc.totalGrossAnnual) },
  ], 'Income, per month', 'Per month')
    + employment
    + other;
}

function balanceSection(cf: ClientDetails): string {
  // Both tables carry a total row, because the closing section prints both
  // totals ("Other assets", "Other liabilities") and a sum that appears nowhere
  // above it was a figure the reader had to take on trust.
  const assetTotal = cf.assets.reduce((sum, a) => sum + a.value.value, 0);
  const assets = cf.assets.length
    ? table(
      [
        { key: 'type', label: 'Asset', align: 'left' },
        { key: 'description', label: 'Detail', align: 'left' },
        { key: 'value', label: 'Value', align: 'right' },
      ],
      [
        ...cf.assets.map((a) => ({
          type: a.type,
          description: orDash(a.description),
          value: formatMeasure(a.value),
        })),
        { type: 'Total', description: '', value: formatMeasure(aud(assetTotal)), __total: true },
      ],
      { caption: 'Assets held outside property', signedKeys: ['value'] },
    )
    : '';

  const owed = cf.liabilities.reduce((sum, l) => sum + l.balance.value, 0);
  const servicing = cf.liabilities.reduce((sum, l) => sum + l.monthlyServicing.value, 0);
  const liabilities = cf.liabilities.length
    ? subhead('Liabilities')
      + table(
        [
          { key: 'type', label: 'Liability', align: 'left' },
          { key: 'provider', label: 'Provider', align: 'left' },
          { key: 'balance', label: 'Balance', align: 'right' },
          { key: 'servicing', label: 'Per month', align: 'right' },
          { key: 'basis', label: 'Basis', align: 'left' },
        ],
        [
          ...cf.liabilities.map((l) => ({
            type: l.type,
            provider: orDash(l.provider),
            balance: formatMeasure(l.balance),
            servicing: formatAmount(l.monthlyServicing),
            // In words, from the normaliser: it says "Estimated" itself where
            // the figure is a model (`liabilityBasis`).
            basis: l.basis,
          })),
          {
            type: 'Total',
            provider: '',
            balance: formatMeasure(aud(owed)),
            servicing: formatAmount(audPerMonth(servicing)),
            basis: '',
            __total: true,
          },
        ],
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
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const rank = new Map(ranked.map(([category], i) => [category, i]));

  // Every line, grouped by category in the summary's order and largest first
  // within each — the record's own order interleaved the categories, so a
  // reader checking a category total had to hunt for its lines down three pages.
  const lines = [...cf.expenses].sort((a, b) =>
    (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0)
    || b.monthly.value - a.monthly.value);

  return table(
    [
      { key: 'category', label: 'Category', align: 'left' },
      { key: 'monthly', label: 'Per month', align: 'right' },
    ],
    [
      ...ranked.map(([category, monthly]) => ({
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
    + table(
      [
        { key: 'category', label: 'Category', align: 'left' },
        { key: 'name', label: 'Expense', align: 'left' },
        { key: 'essential', label: 'Essential', align: 'left' },
        { key: 'monthly', label: 'Per month', align: 'right' },
      ],
      lines.map((x) => ({
        category: x.category,
        name: orDash(x.name),
        // The word, not a tick. The legacy prints `✓`, which is tofu in a real
        // text PDF and unreadable to a screen reader in any format.
        essential: x.isEssential ? 'Yes' : 'No',
        monthly: formatAmount(x.monthly),
      })),
      { caption: 'As recorded, by category', signedKeys: ['monthly'] },
    );
}

/**
 * The class the portrait holdings matrix is styled by (`portraitMatrixCss`).
 */
const HOLDINGS_MATRIX_CLASS = 'holdings-matrix';

/**
 * Every holding side by side, on the page the section is already on.
 *
 * It took a landscape sheet of its own, which at the record's largest
 * portfolio — four holdings — held one table a third of a page tall. Up to
 * `PORTRAIT_MATRIX_MAX` holdings fit the portrait measure in every design, and
 * the record's largest portfolio is four; past that the landscape sheet stays.
 */
function portfolioSection(cf: ClientDetails): string {
  if (!cf.properties.length) return '';

  const lines = [
    { label: 'Type', values: cf.properties.map((x) => x.kindLabel) },
    { label: 'Value', values: cf.properties.map((x) => formatMeasure(x.value)) },
    { label: 'Owing', values: cf.properties.map((x) => formatMeasure(x.loanRemaining)) },
    { label: 'Equity', values: cf.properties.map((x) => formatMeasure(x.equity)), total: true },
    { label: 'LVR', values: cf.properties.map((x) => formatMeasure(x.lvr)) },
    { label: 'Rent', values: cf.properties.map((x) => formatAmount(x.rentMonthly)) },
    { label: 'Outgoings', values: cf.properties.map((x) => formatAmount(x.expensesMonthly)) },
    { label: 'Net per month', values: cf.properties.map((x) => formatAmount(x.netMonthly)), total: true },
  ];
  // The standfirst already says "every holding side by side", and the caption
  // said it again before explaining that the net "cannot disagree with the two
  // rows above it" — a guarantee of the software, not a fact about the client.
  // What the reader needs from it is which lines are monthly.
  const caption = 'Rent, outgoings and the net between them are per month.';

  if (cf.properties.length > PORTRAIT_MATRIX_MAX) {
    return renderBandedMatrix('The portfolio', cf.properties.map((x) => x.shortAddress), lines, { caption });
  }
  return renderPortraitMatrix({
    lineLabel: 'Line',
    // Unclipped: the heads wrap here, and a clipped street named nothing.
    headings: cf.properties.map((x) => streetLine(x.address) || x.shortAddress),
    lines,
    caption,
    className: HOLDINGS_MATRIX_CLASS,
    // Whole: eight lines read across as one comparison, and split six and two
    // the net figures turned over to a page of their own.
    keep: { ...TABLE_KEEP, wholeUpToRows: lines.length },
  });
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
 * Including for a record with nothing in it, where it says so in one callout.
 * That is a true and useful statement: an adviser about to send this to a
 * broker should see that the record is empty *before* they send it, not after.
 */
function positionSection(cf: ClientDetails, palette: ResolvedReportPalette): string {
  const pos = cf.position;

  if (!recordHoldsFinancials(cf)) {
    return renderCallout(
      'caution',
      'No financial information is recorded for this client',
      p('The record holds contact details but no income, assets, liabilities, '
        + 'expenses or property. Everything above is what we have. This document '
        + 'is complete — the record is not.'),
    );
  }

  // Property lines only where property is held. A client with none read
  // "Property value $0", "Property debt $0" and "Property equity $0", and a
  // "$0 held" figure at the head of the section — three rows and a figure about
  // something the record does not contain.
  const property = holdsProperty(cf);
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
    ...(property
      ? [{
        label: 'Property equity',
        value: formatMeasure(pos.propertyEquity),
        foot: `${formatMeasure(pos.propertyValue)} held`,
      }]
      : pos.commitmentRatio
        ? [{
          label: 'Committed',
          value: formatMeasure(pos.commitmentRatio),
          foot: 'of monthly income',
        }]
        : []),
  ];

  return renderKpiStrip(kpis)
    + definitionTable([
      ...(property
        ? [
          { item: 'Property value', value: formatMeasure(pos.propertyValue) },
          { item: 'Property debt', value: formatMeasure(pos.propertyDebt) },
          { item: 'Property equity', value: formatMeasure(pos.propertyEquity), total: true },
        ]
        : []),
      { item: property ? 'Other assets' : 'Assets', value: formatMeasure(pos.otherAssets) },
      { item: property ? 'Other liabilities' : 'Liabilities', value: formatMeasure(pos.otherLiabilities) },
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
  //
  // The record's summary sits beneath it, as the Portfolio review's opening
  // does: a two- to five-entry list left half the page white, and the summary
  // opened the first section above the contact details it summarises. An empty
  // record has no summary (`describeClient`), and the page is the list alone.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(clientDetailsSpine(cf)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
    undefined,
    cf.narrative ? `<div class="eyebrow">About this record</div>${p(cf.narrative)}` : null,
  );

  // Each section opened a page of its own. A name-only record was three body
  // pages holding a table and a callout between them, and over the five record
  // shapes and 51 designs 699 body pages ended more than a quarter empty, the
  // worst 94% blank (CLIENT_DETAILS.md §12). The sections run on now, as a
  // memo's do (`RUN_ON_CHAPTER_CLASS`, `MEMO_CHAPTER_CLASS`): each keeps its
  // number, its contents entry and its running head, and its title is set one
  // step above its subheads rather than at the chapter-opener size. The first
  // still opens its page, after the contents.
  const body = clientDetailsSections(cf).map((section, index) => {
    const inner = SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title, 'body', { runOn: index > 0, memo: true })
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
    }) + portraitMatrixCss(HOLDINGS_MATRIX_CLASS),
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
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
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
