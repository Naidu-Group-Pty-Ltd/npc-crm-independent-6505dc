/**
 * Whether a render route may draw in the `report_templates` row it was asked
 * for.
 *
 * A render request may name a design (`templateDesign.pure.ts`): one of the
 * catalogue's fifty in one of its colourways, or a `report_templates` row. A
 * catalogue design is anybody's. A row is honoured only where the Template
 * Builder would list it for this person and the chooser would offer it for this
 * report type — the two rules here. The read is in `templateDesignRead.ts`, and
 * what the response says back (`DesignEcho`) is in `templateDesign.pure.ts`
 * beside the refusals it describes.
 *
 * A design that cannot be applied never costs the document: the route draws
 * the standard one and says why.
 *
 * Pure: no I/O, so the edge function and the browser share it.
 */
import {
  isSelectableTemplate,
  normaliseReportType,
  type SelectableTemplateRow,
} from './reportTemplateSelection.pure.ts';

/** The parts of a `report_templates` row the route reads before it reads a design. */
export interface DesignTemplateRow extends SelectableTemplateRow {
  owner_user_id?: string | null;
}

/**
 * Whether a template row is the caller's to draw in.
 *
 * The same rule the Template Builder applies to the rows it lists
 * (`manage-templates`' read scope): every global template, the caller's own
 * user-scoped ones, and everything for a superadmin. An agency template is a
 * superadmin's alone, because nothing in the schema says which agency a person
 * belongs to, and a caller-supplied agency is not evidence of one.
 */
export function templateVisibleTo(
  row: Pick<DesignTemplateRow, 'scope' | 'owner_user_id'>,
  userId: string,
  isSuperadmin: boolean,
): boolean {
  if (isSuperadmin) return true;
  // Exactly the Builder's filter (`scope.eq.global`, or `scope.eq.user` owned by
  // the caller). The column is NOT NULL DEFAULT 'global', so a row with no
  // scope was not read from the table, and is not treated as global.
  if (row.scope === 'global') return true;
  if (row.scope === 'user') return Boolean(row.owner_user_id) && row.owner_user_id === userId;
  return false;
}

/**
 * Report types drawn in another report type's chosen design when they have no
 * choice of their own.
 *
 * A Cash Flow Comparison is made in the Cash Flow modal, beside the 10 Year
 * Cash Flow and from the same projections. Its templates are preview-only —
 * no comparison is persisted anywhere a template's pages could read — so none
 * can be adopted for it, and without this it could never be drawn in anything
 * but the house design. With it, the comparison wears the design the person
 * chose for the report it is made from, and a choice made for the comparison
 * itself, were one ever possible, would still win.
 *
 * Read by the browser (which choice to send) and the route (whether a row may
 * be drawn for this report type), so the two cannot disagree.
 */
export const DESIGN_BORROWED_FROM: Readonly<Record<string, string>> = Object.freeze({
  cash_flow_comparison: 'cashflow',
});

/** The report type whose choice this one borrows, or null. */
export function designLenderFor(reportType: string): string | null {
  return DESIGN_BORROWED_FROM[normaliseReportType(reportType)] ?? null;
}

/** What each report type that borrows a design is called where the choice is made. */
const BORROWER_LABEL: Readonly<Record<string, string>> = Object.freeze({
  cash_flow_comparison: 'Cash Flow Comparison',
});

/** The report types that wear this one's chosen design (`DESIGN_BORROWED_FROM`). */
export function designBorrowersOf(reportType: string): string[] {
  const lender = normaliseReportType(reportType);
  return Object.keys(DESIGN_BORROWED_FROM).filter((borrower) => DESIGN_BORROWED_FROM[borrower] === lender);
}

/**
 * The sentence the chooser shows for a report type whose choice another one
 * wears too, or null. Said where the choice is made, because a choice that
 * quietly changes a second document is one nobody knowingly made.
 */
export function borrowedDesignNote(reportType: string): string | null {
  const names = designBorrowersOf(reportType).map((borrower) => BORROWER_LABEL[borrower] ?? borrower);
  if (names.length === 0) return null;
  return `Also sets the design of the ${names.join(' and ')}, which is made from this report.`;
}

/**
 * Whether a visible row may be drawn in for this report type.
 *
 * The chooser's own rule (`isSelectableTemplate`): active, published, and for
 * this format across every spelling of it — or for the format this one
 * borrows its design from. A row the chooser would not offer is not honoured
 * here either, so the two cannot disagree about what a choice means.
 */
export function designRowUsableFor(row: DesignTemplateRow, reportType: string): boolean {
  if (isSelectableTemplate(row, reportType)) return true;
  const lender = designLenderFor(reportType);
  return lender !== null && isSelectableTemplate(row, lender);
}

// ── Documents drawn in the browser ───────────────────────────────────────────

/**
 * The documents that are drawn rather than typeset, and the report type whose
 * chosen design each one wears.
 *
 * None of them is a report type: no template is written for any of them, and
 * a chooser for each would offer templates that do not exist. Each is made
 * from what one of the chosen-for report types is made from, and wears the
 * design chosen for that report type (`drawnDesign.pure.ts`), so the documents
 * a client receives about one matter look like one set:
 *
 *  - the Strategy Rationale from the borrowing capacity assessment the
 *    Borrowing Capacity report draws;
 *  - the Commercial and Industrial documents from the C&I property, deal and
 *    assessment the C&I Capacity report is drawn from, through the same engines;
 *  - Client Property Analysis from one of the client's own holdings, with the
 *    per-holding figures the Portfolio Performance Review reports;
 *  - the quantitative market report and the Overview snapshot from the
 *    aggregated listings Market Intelligence reads;
 *  - the call log export from the contacts the Client Details form is about.
 *
 * Read by the browser (which choice a document wears) and by the chooser (what
 * it says a choice reaches), so the two cannot disagree.
 *
 * The lender packet's cover sheet is deliberately NOT here. It is drawn in the
 * finance partner's portal, in the partner's own session, and a choice is the
 * adviser's — stored against the adviser and readable by nobody else — so the
 * partner's browser cannot know it. Listing it would have the chooser promise
 * a design the document can never wear. Dressing it needs the packet's server
 * to read the adviser's choice for the client the packet is about, which is a
 * decision about whose choice a partner's document wears, not a wiring step.
 */
export const DRAWN_DOCUMENTS = Object.freeze([
  { key: 'strategy_rationale', label: 'Strategy Rationale', designFrom: 'borrowing_capacity' },
  { key: 'commercial_investment_report', label: 'Commercial Investment Report', designFrom: 'commercial_capacity' },
  { key: 'industrial_investment_report', label: 'Industrial Investment Report', designFrom: 'commercial_capacity' },
  { key: 'commercial_cash_flow', label: 'Commercial 10-year cash flow', designFrom: 'commercial_capacity' },
  { key: 'commercial_intake_pack', label: 'Commercial and Industrial intake pack', designFrom: 'commercial_capacity' },
  { key: 'client_property_analysis', label: 'Client Property Analysis', designFrom: 'portfolio' },
  { key: 'quantitative_report', label: 'Quantitative market report', designFrom: 'market_intelligence' },
  { key: 'overview_snapshot', label: 'Overview snapshot', designFrom: 'market_intelligence' },
  { key: 'call_log_export', label: 'Call log export', designFrom: 'client_details' },
] as const);

export type DrawnDocumentKey = (typeof DRAWN_DOCUMENTS)[number]['key'];

/** The report type whose chosen design a drawn document wears. */
export function drawnDocumentDesignSource(document: DrawnDocumentKey): string {
  const entry = DRAWN_DOCUMENTS.find((d) => d.key === document);
  if (!entry) throw new Error(`No drawn document "${String(document)}"`);
  return entry.designFrom;
}

/** The drawn documents that wear the design chosen for a report type, in the register's order. */
export function drawnDocumentsWearing(reportType: string): ReadonlyArray<(typeof DRAWN_DOCUMENTS)[number]> {
  const key = normaliseReportType(reportType);
  return DRAWN_DOCUMENTS.filter((d) => d.designFrom === key);
}

/**
 * What the chooser says a choice for this report type also reaches, or null
 * where it reaches nothing else.
 *
 * Said in the words a person uses — the documents' own names — and no more
 * than is true: a drawn document takes the design, never pages it never had.
 */
export function drawnDocumentsNote(reportType: string): string | null {
  const names = drawnDocumentsWearing(reportType).map((d) => d.label);
  if (names.length === 0) return null;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names.length === 1
    ? `Also sets the design of the ${list}, which is drawn without a template of its own.`
    : `Also sets the design of the ${list}, which are drawn without templates of their own.`;
}
