/**
 * Who a report is issued BY, and the disclaimer that party is entitled to speak.
 *
 * ## The defect this exists to end
 *
 * A disclaimer is not a block of boilerplate. It is **a statement by the issuer
 * about the issuer** — what it does, what it is not, and what it will not answer
 * for. So the identity on the document and the disclaimer under it are one
 * decision, and this product had them as two unrelated defaults that disagreed.
 *
 * Rendered on 2026-09-08 through the production renderer with the settings a
 * freshly provisioned clone actually holds — `contact_details.company_name`
 * empty, no white-label brand, the seeded `professional_disclaimer` row — one
 * report of one property came out carrying **three different businesses that do
 * not exist or are not the issuer**:
 *
 * | where | what it printed |
 * | --- | --- |
 * | watermark, tiled over every body page | `NPC` |
 * | PDF `Author` / `dcterms.creator` | `NPC Property` |
 * | back-page masthead | `PROPERTY` / `CONSULTING` |
 *
 * `NPC` and `NPC Property` are another tenant's trading name — the prime's —
 * baked in as `contact.company_name || brandName || "NPC"`. `Property
 * Consulting` is a name no business holds; it is a placeholder that reads as a
 * firm.
 *
 * The fourth copy is the worst, because it is the one a lawyer reads.
 * `useGlobalReportSettings.defaultDisclaimer` was the prime's own wording,
 * verbatim:
 *
 * > *As a Professional Property Consultant & Buyers Agent, we provide
 * > information and advice based on our expertise… Our services include
 * > assisting you in identifying and evaluating potential opportunities,
 * > negotiating purchase terms, and navigating the transaction process… By
 * > engaging our services, you acknowledge…*
 *
 * Under an unbranded clone's masthead every clause of that is false. The
 * platform is not engaged by the reader, holds itself out as nobody's buyer's
 * agent, and negotiates nothing. Printing it is not a cosmetic slip: acting as
 * or holding oneself out as a real estate or buyer's agent is licensed conduct
 * in every Australian state.
 *
 * ## The rule
 *
 * **An identity and its disclaimer travel together.** There are exactly two
 * issuers and never a third:
 *
 *  - **`workspace`** — the deployment has said who it is (a report contact
 *    company name, or a white-label brand name). The document is issued under
 *    that name and the disclaimer is that business's own.
 *  - **`platform`** — the deployment has said nothing. The document is issued
 *    under **Aurixa Systems**, and the disclaimer is the technology provider's.
 *
 * There is no invented trading name, no other tenant's name, and no blank
 * masthead. An unbranded clone is an Aurixa deployment, not a deployment with no
 * identity — the same rule `platformBrand.ts` applies to the favicon and
 * `submissionRecordBrand.ts` applies to the AML submission record.
 *
 * ## Why the platform disclaimer ignores a stored one
 *
 * Fixing the *default* would not have been enough. A clone whose
 * `global_report_settings` were seeded from the prime carries the prime's text
 * in the row, so no default ever fires and the leak survives the fix. The switch
 * therefore sits on the **read**, keyed on the resolved issuer.
 *
 * The rule that makes that safe to state: *a deployment that has not said who it
 * is cannot have a disclaimer of its own.* A disclaimer written by an
 * unidentified party, printed under Aurixa's name, is exactly the confusion this
 * closes — and the escape is one keystroke, because typing a company name moves
 * the whole document to the `workspace` issuer.
 *
 * ## What does NOT change
 *
 * A deployment that has a name keeps every byte it prints today. Stored text
 * wins on the `workspace` issuer, and where there is none the fallback is the
 * literal `render-investment-report-pdf` already carried. The prime has held
 * `company_name: "Naidu Property Consulting Services"` since 2026-02-19, so
 * nothing in this module can reach its documents.
 */

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The platform's own identity — what an unbranded deployment issues under. */
export const PLATFORM_ISSUER_NAME = 'Aurixa Systems';

/**
 * Names that are the absence of a brand rather than a brand.
 *
 * `''` is the seeded value. `dashboard` is what the brand store ships with, so
 * a deployment still carrying it has integrated nothing — the same set
 * `submissionRecordBrand.ts` refuses, kept in step deliberately because a
 * document and its compliance record must not disagree about who issued them.
 *
 * The four placeholders below are the invented names this module replaces. They
 * are listed rather than merely removed from the call sites: a restored backup,
 * a hand-edited settings row or a copied clone can put one back into the
 * database, and a placeholder read out of a row is the same false masthead as a
 * placeholder read out of code.
 */
const NON_IDENTITIES = new Set([
  '',
  'dashboard',
  'property consulting',
  'property report',
  'npc',
  'npc property',
]);

/**
 * Is this name the absence of a brand rather than a brand?
 *
 * Exported so the presentation layer asks the same question the issuer line
 * does. `companyBlock.pure.ts` carried its own fallback — the literal
 * `'Property Consulting'`, which is IN the set below — so an unbranded
 * deployment printed "Property Consulting" in the running foot of every body
 * page and as the closing page's lockup while the issuer line beside them said
 * "Aurixa Systems". Two answers to one question, in one document.
 */
export function isNonIdentity(name: unknown): boolean {
  if (!isNonEmpty(name)) return true;
  return NON_IDENTITIES.has(name.trim().toLowerCase());
}

export type IssuerKind = 'workspace' | 'platform';

export interface ReportIssuer {
  /** The name printed on the document. Never empty. */
  name: string;
  kind: IssuerKind;
}

export interface IssuerInput {
  /** `global_report_settings.contact_details.company_name`. */
  companyName?: unknown;
  /** The white-label brand name, where the caller has one. */
  brandName?: unknown;
}

/**
 * Resolve the issuing identity.
 *
 * The contact name outranks the brand name because that is the order every
 * report surface already read them in (`contact.company_name || brandName`);
 * this changes only what happens when both are absent.
 */
export function resolveReportIssuer(input: IssuerInput): ReportIssuer {
  for (const candidate of [input.companyName, input.brandName]) {
    if (!isNonEmpty(candidate)) continue;
    const name = candidate.trim();
    if (NON_IDENTITIES.has(name.toLowerCase())) continue;
    return { name, kind: 'workspace' };
  }
  return { name: PLATFORM_ISSUER_NAME, kind: 'platform' };
}

/**
 * What a named business's report says when the business has written nothing.
 *
 * Verbatim the literal `render-investment-report-pdf` already fell through to,
 * so a branded deployment with no configured disclaimer prints exactly what it
 * printed before this module existed.
 */
export const WORKSPACE_DEFAULT_DISCLAIMER =
  'This report is provided for general informational purposes only and does not '
  + 'constitute financial, taxation, legal, or investment advice. All figures, '
  + 'projections, and market commentary are derived from publicly available data '
  + 'and reasonable assumptions at the time of writing, and may change. Recipients '
  + 'should seek independent professional advice before making any investment '
  + 'decisions.';

/**
 * What a report issued under the platform's own name says.
 *
 * Five paragraphs, each closing something the consultancy wording left open:
 *
 *  1. **What the document is** — assembled by software from sources the
 *     deployment chose. A reader otherwise has no way to know the analysis was
 *     not authored by an adviser who visited the property.
 *  2. **What Aurixa is not.** Stated as role and conduct ("is not… does not
 *     provide") rather than as a claim about which registrations the company
 *     holds, because the licensing question turns on what is *provided*, and
 *     because this module cannot verify a corporate registration.
 *  3. **The data.** Third-party and public sources, unverified, possibly stale;
 *     a projection rests on assumptions and is not a forecast. This report
 *     prints ten-year cash flow tables, so the distinction is load-bearing.
 *  4. **Responsibility — and its limit.** Aurixa answers for nothing arising
 *     from reliance on the document, *and that does not extinguish the reader's
 *     rights against whoever gave it to them.* A platform disclaimer that
 *     appeared to wipe out the operator's own obligations would be a worse
 *     document than the one it replaces.
 *  5. **What to do instead** — independent advice and the reader's own enquiries.
 *
 * The word "we" appears nowhere: the issuer is a party the reader has no
 * relationship with, and "we" is what made the consultancy wording read as an
 * engagement.
 */
export const PLATFORM_DISCLAIMER = [
  'This report was produced using the Aurixa Systems reporting platform. Aurixa '
  + 'Systems supplies the software that assembled this document from data sources '
  + 'and inputs selected by, or supplied on behalf of, the business that generated '
  + 'it. The analysis has not been prepared by Aurixa Systems, and no Aurixa '
  + 'Systems representative has inspected the property.',

  'Aurixa Systems is a technology provider. It is not a real estate agent, '
  + "buyer's agent, property manager or licensed valuer, does not provide financial "
  + 'product, credit, taxation or legal advice, and is not a party to any property '
  + 'transaction. Nothing in this report is advice, and nothing in it is a '
  + 'recommendation to acquire, dispose of or hold any property or financial product.',

  'The information here is drawn from public registers, third-party data providers '
  + 'and details entered into the platform. It may be incomplete, superseded or '
  + 'inaccurate, and it has not been independently verified. Any projection or '
  + 'modelled figure rests on the assumptions stated alongside it; assumptions are '
  + 'not predictions, and actual outcomes will differ, sometimes materially.',

  'To the extent permitted by law, Aurixa Systems accepts no responsibility for any '
  + 'loss arising from reliance on this report. That does not limit the obligations '
  + 'of the business that provided this report to you, whose own terms of engagement '
  + 'govern its relationship with you.',

  'Before acting on anything in this report, obtain independent advice from '
  + 'appropriately licensed or qualified professionals and carry out your own '
  + 'enquiries and due diligence.',
].join('\n\n');

export interface StoredDisclaimer {
  text?: unknown;
  is_enabled?: unknown;
}

export interface ResolvedDisclaimer {
  /** The text to print. Empty only when a named issuer switched it off. */
  text: string;
  /** Where it came from — for logs and tests, never for the page. */
  source: 'stored' | 'workspace_default' | 'platform' | 'disabled';
}

/**
 * The disclaimer a document actually prints.
 *
 * `is_enabled: false` is honoured for a named business — switching off its own
 * wording is its call. It is NOT honoured for the platform issuer, because that
 * setting was made by a deployment that has not identified itself, and a report
 * going out under Aurixa's name with no statement of what Aurixa is would be the
 * defect this module exists to close, arrived at by a different route.
 */
export function resolveReportDisclaimer(
  issuer: ReportIssuer,
  stored?: StoredDisclaimer | null,
): ResolvedDisclaimer {
  if (issuer.kind === 'platform') return { text: PLATFORM_DISCLAIMER, source: 'platform' };
  if (stored?.is_enabled === false) return { text: '', source: 'disabled' };
  if (isNonEmpty(stored?.text)) return { text: stored.text.trim(), source: 'stored' };
  return { text: WORKSPACE_DEFAULT_DISCLAIMER, source: 'workspace_default' };
}
