/**
 * What the document contains, and in what order.
 *
 * ## The person first, the portfolio last and only if there is one
 *
 * The generator this replaces opens on Properties Overview. Measured against the
 * record, 745 of 771 clients have no property — so for almost everybody the
 * shipping document leads with, and then spends several pages on, nothing.
 *
 * Here sections 1 and 8 are unconditional and everything between them appears
 * only when the record holds it. A client with a name and an address produces a
 * five-page document that reads as finished, because it is: it says who they
 * are and where they stand, and it does not pretend to a portfolio.
 *
 * ## Where they stand is always last, and always there
 *
 * Even for a record with nothing but a name. The position is then all zeroes and
 * says so in one line, which is a true and useful statement — "we hold no
 * financial information for this client" is exactly what an adviser about to
 * send this to a broker needs to see before they send it.
 */
import type { ReportArchetypeId, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { ClientDetails } from './payload.pure.ts';
import { MAX_ROWS } from './payload.pure.ts';

export const ARCHETYPE_ID: ReportArchetypeId = 'client-details';

export interface ClientDetailsSection {
  id: string;
  title: string;
  /** One line under the section number, and on the contents page. */
  note: string;
  pageBudget: number;
  /** Opens the landscape page. Only the portfolio matrix does. */
  wide?: boolean;
}

/**
 * How many rows of each kind fit on a page.
 *
 * Three rates rather than one, because these tables are not the same shape and a
 * single rate was wrong in both directions at once. Measured by rendering the
 * five distinct record shapes through WeasyPrint and reading the section
 * boundaries off the running heads:
 *
 *   address history   two columns of dates, a situation, a long address — 12
 *   ledger rows       assets and liabilities, five columns with a basis — 16
 *   expense lines     four narrow columns, the densest table here — 24
 *
 * A budget is an expectation checked against a band, not a page prediction, so
 * these are set to land at or slightly above the real count. Under-declaring is
 * the dangerous direction: it lets a large record render past the ceiling while
 * the spine says it did not.
 */
const HISTORY_ROWS_PER_PAGE = 12;
const LEDGER_ROWS_PER_PAGE = 16;
const EXPENSE_ROWS_PER_PAGE = 24;

/**
 * Pages a table of `rowCount` needs, on top of the section's own first page.
 *
 * Deliberately does **not** assume the first rows share the chapter's opening
 * page. They sometimes do and sometimes do not — it depends on how much
 * introductory content sits above them — and an earlier version that assumed
 * they did under-declared three of the five measured shapes by a page each.
 * Over-declaring costs nothing but a slightly wider band; under-declaring lets a
 * large record render past the ceiling while the spine reports that it did not.
 */
const pagesForRows = (rowCount: number, perPage: number): number =>
  Math.ceil(Math.max(0, rowCount) / perPage);

/** The sections this record has content for. */
export function clientDetailsSections(p: ClientDetails): ClientDetailsSection[] {
  const sections: ClientDetailsSection[] = [{
    id: 'who',
    title: 'Who this is about',
    note: p.meta.hasSecondaryContact
      ? 'Both contacts, where they live, and the household.'
      : 'Contact details, where they live, and the household.',
    // A second person adds a contact block and a residence block; the address
    // history is the only table here that runs long — 18 rows is the record's
    // maximum and it takes two pages on its own.
    pageBudget: 1
      + (p.meta.hasSecondaryContact ? 1 : 0)
      + pagesForRows(p.household.history.length, HISTORY_ROWS_PER_PAGE),
  }];

  if (p.ownerOccupied) {
    sections.push({
      id: 'home',
      title: 'Where they live',
      note: 'The home, what it is worth, and what is owed on it.',
      pageBudget: 1,
    });
  }

  if (p.employment.length || p.income.totalMonthly.value > 0) {
    sections.push({
      id: 'income',
      title: 'Work and income',
      note: 'Employment, salary, and every other income line recorded.',
      pageBudget: 1 + pagesForRows(
        p.employment.length + p.income.otherIncome.length, LEDGER_ROWS_PER_PAGE),
    });
  }

  if (p.assets.length || p.liabilities.length) {
    sections.push({
      id: 'balance',
      title: 'What they own and owe',
      note: 'Assets outside property, and every liability with what it costs to hold.',
      pageBudget: 1
        + pagesForRows(p.assets.length + p.liabilities.length, LEDGER_ROWS_PER_PAGE)
        // The estimated-servicing callout is a block of its own.
        + (p.liabilitiesIncludeEstimates ? 1 : 0),
    });
  }

  if (p.expenses.length) {
    sections.push({
      id: 'spending',
      title: 'What they spend',
      note: 'Recorded household expenses, by category.',
      // The category summary and the composition chart take a page before the
      // line-by-line table starts.
      pageBudget: 2 + pagesForRows(p.expenses.length, EXPENSE_ROWS_PER_PAGE),
    });
  }

  if (p.properties.length) {
    sections.push({
      id: 'portfolio',
      title: 'The property portfolio',
      note: 'Every holding on one page: value, debt, equity and what it returns.',
      // A chapter-header page plus the landscape matrix. Learnt from the Cash
      // Flow Comparison, whose first estimate had a wide section at one page and
      // measured three.
      pageBudget: 2,
      wide: true,
    });
    sections.push({
      id: 'holdings',
      title: 'Each property in turn',
      note: 'The particulars of each holding, including any fund that holds it.',
      pageBudget: p.properties.length,
    });
  }

  sections.push({
    id: 'position',
    title: 'Where they stand',
    note: 'Net worth, and income against everything committed against it.',
    // The balance table, then the income-against-commitments chart and its own
    // table beneath it. One page only when there is nothing to say at all.
    pageBudget: p.position.netWorth.value === 0 && p.position.incomeMonthly.value === 0 ? 1 : 2,
  });

  return sections;
}

/** The spine, cover and closing page included. */
export function clientDetailsSpine(p: ClientDetails): SpineEntry[] {
  return buildSpine({
    archetype: ARCHETYPE_ID,
    chapters: clientDetailsSections(p).map((s) => ({
      id: s.id,
      title: s.title,
      pageBudget: s.pageBudget,
      note: s.note,
      wide: s.wide,
    })),
  });
}

/**
 * Every way this document violates its own archetype. Empty means valid.
 *
 * Deliberately permissive about *content* and strict about *structure*. A record
 * with nothing in it is a valid document — that is the 97% case — so there is no
 * "has at least one section" rule here. What is refused is a payload that could
 * not have come from `buildClientDetails`: no client name to put on the cover,
 * or a collection large enough to be a paste rather than a client.
 */
export function validateClientDetailsSpine(p: ClientDetails): string[] {
  const problems = validateSpine(ARCHETYPE_ID, clientDetailsSpine(p));

  if (!p.meta.clientId) problems.push('the record has no client id');
  if (!p.meta.clientName) problems.push('the record has no name to put on the cover');

  for (const [label, length] of [
    ['properties', p.properties.length],
    ['assets', p.assets.length],
    ['liabilities', p.liabilities.length],
    ['expenses', p.expenses.length],
    ['employment', p.employment.length],
  ] as const) {
    if (length > MAX_ROWS) {
      problems.push(`${label} carries ${length} rows; at most ${MAX_ROWS} are accepted`);
    }
  }

  return problems;
}
