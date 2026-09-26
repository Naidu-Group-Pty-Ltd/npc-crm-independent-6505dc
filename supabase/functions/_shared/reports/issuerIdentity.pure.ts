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

// ── The house: NPC's identity belongs to the prime ─────────────────────────
//
// This repository ships with one business's identity inside it: Naidu Property
// Consulting Services, which also trades as NPC Services — its cover artwork,
// its name and its disclaimer wording. The prime is that business's own
// deployment; every clone is somebody else's, built from the same tree.
//
// A clone's settings rows can still carry the house's values: a row seeded from
// the prime's, a restored backup, a disclaimer copied across by hand. So "is
// this the house?" is never answered from a row. The caller says which
// deployment it is (`IssuerDeployment`, from the backend it talks to), and
// on a clone the house's name is not an identity and the house's wording is not
// the issuer's own — the owner's rule, 26 Sep 2026: NPC's artwork, and "the
// Disclaimer that might be hardcoded as NPC Services or Naidu property
// consulting services", are available on the prime and hidden on the clone.

/** Which deployment a document is drawn on — the prime, or a clone. */
export interface IssuerDeployment {
  /** True only where the backend is the prime's own (never judged from a name). */
  prime: boolean;
}

/** The names the house trades under, normalised (`normaliseCompanyName`). */
const HOUSE_NAMES: ReadonlySet<string> = new Set([
  'naidu property consulting services',
  'naidu property consulting',
  'npc services',
]);

/** A trailing legal form, which does not change which business a name is. */
const LEGAL_FORM = /\s+(pty\s+ltd|pty\s+limited|proprietary\s+limited|ltd|limited)$/;

/** A company name reduced to the words that identify it. */
export function normaliseCompanyName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEGAL_FORM, '')
    .trim();
}

/**
 * Is this the house's own name?
 *
 * `NPC` and `NPC Property` alone are not here: they are placeholders
 * (`NON_IDENTITIES`), which no deployment issues under.
 */
export function isHouseName(name: unknown): boolean {
  return HOUSE_NAMES.has(normaliseCompanyName(name));
}

/**
 * The ways running text names the house: its two trading names, its web and
 * mail domain, and its initials set as a word in capitals.
 *
 * "Naidu" alone is a surname and is not enough; "NPC" in lower case is too
 * ordinary to be a name. Both of those would condemn a stranger's wording.
 */
const HOUSE_MENTIONS: readonly RegExp[] = [
  /\bnaidu\s+property\b/i,
  /\bnpc\s+services\b/i,
  /\bnpcservices\b/i,
  /\bNPC\b/,
];

/** Does this text name the house? */
export function namesTheHouse(text: unknown): boolean {
  if (!isNonEmpty(text)) return false;
  return HOUSE_MENTIONS.some((re) => re.test(text));
}

/**
 * The line NPC's artwork sets under its name, which the generators also used
 * to print as a fallback cover's tagline and prepend to a report's opening.
 * It is the house's own words, not a phrase any issuer happens to share.
 */
export const HOUSE_TAGLINE = 'YOUR DEDICATED PROPERTY PARTNER';

/** Is this the house's tagline, however it is cased or spaced? */
export function isHouseTagline(text: unknown): boolean {
  return typeof text === 'string'
    && text.replace(/\s+/g, ' ').trim().toUpperCase() === HOUSE_TAGLINE;
}

/**
 * Is this company name the house trading under some variation — "NPC Services
 * Melbourne", "Naidu Property Consulting Services Group"?
 *
 * Narrower than `namesTheHouse`: the house's initials alone do not make a
 * business name the house's, because "NPC Realty" is a stranger's name and a
 * clone may well belong to one. The two trading names and the domain do.
 */
export function isHouseTradingName(name: unknown): boolean {
  if (!isNonEmpty(name)) return false;
  return isHouseName(name) || HOUSE_MENTIONS.slice(0, 3).some((re) => re.test(name));
}

/**
 * Resolve the issuing identity.
 *
 * The contact name outranks the brand name because that is the order every
 * report surface already read them in (`contact.company_name || brandName`);
 * this changes only what happens when both are absent.
 *
 * Given the deployment, a clone never issues under the house's name: a row
 * that says it is NPC is passed over like a placeholder, and the next name —
 * or the platform — issues instead. Without it, every name reads as it always
 * did, which is what every caller that has not been told about deployments
 * relies on.
 */
export function resolveReportIssuer(input: IssuerInput, deployment?: IssuerDeployment | null): ReportIssuer {
  for (const candidate of [input.companyName, input.brandName]) {
    if (!isNonEmpty(candidate)) continue;
    const name = candidate.trim();
    if (NON_IDENTITIES.has(name.toLowerCase())) continue;
    if (deployment && !deployment.prime && isHouseTradingName(name)) continue;
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
  /**
   * Where it came from — for logs and tests, never for the page.
   * `house_withheld` is stored wording that named the house, on a document the
   * house does not issue.
   */
  source: 'stored' | 'workspace_default' | 'platform' | 'disabled' | 'house_withheld';
}

/**
 * Is this stored wording the house's, on a document the house does not issue?
 *
 * On a clone a disclaimer that names NPC Services is never the clone's own:
 * the clone is somebody else's business, whatever its rows say. On the prime
 * nothing is withheld — the prime's documents read every word of its settings
 * exactly as they always have, which is the owner's rule for the prime ("no
 * changes of the content"), and the prime's wording is the prime's to write.
 */
export function houseWordingWithheld(
  text: unknown,
  _issuer: ReportIssuer,
  deployment: IssuerDeployment,
): boolean {
  if (deployment.prime) return false;
  return namesTheHouse(text);
}

/** The contact fields a closing page prints, in `global_report_settings.contact_details`. */
const CONTACT_FIELDS = ['website', 'email', 'phone', 'address', 'abn'] as const;

/**
 * Is this contact row the house's own — a seeded or restored copy of the
 * prime's settings?
 *
 * Its company name says so, and that is the only way to tell: the house's
 * phone line, its office address and its ABN are digits and a street, which
 * name nobody, so no reading of the VALUE can recognise them. A row that names
 * the house as its company describes the house, so every contact value in it
 * is the house's — measured on the seeded case, a clone printed NPC's landline,
 * office and ABN under the platform's name with only the mailbox and website
 * withheld.
 */
export function isHouseContactRow(contact: unknown): boolean {
  if (!contact || typeof contact !== 'object') return false;
  return isHouseTradingName((contact as Record<string, unknown>).company_name);
}

/**
 * The contact details a document prints under its issuer's name.
 *
 * The name is always the issuer's, so the lockup on the closing page and the
 * cover cannot name two businesses. On a clone a field that belongs to the
 * house is left out — one that names it (NPC's web address or its mailbox),
 * and every field of a row that is the house's own (`isHouseContactRow`): it
 * would send the clone's client to another business. On the prime, and
 * wherever no deployment is given, every field reads as stored.
 */
export function issuerContactDetails<C extends object>(
  contact: C | null | undefined,
  issuer: ReportIssuer,
  deployment?: IssuerDeployment | null,
): C & { company_name: string } {
  const details = { ...(contact ?? {}), company_name: issuer.name } as C & { company_name: string };
  if (!deployment || deployment.prime) return details;
  const houseRow = isHouseContactRow(contact);
  const fields = details as unknown as Record<string, unknown>;
  for (const field of CONTACT_FIELDS) {
    if (houseRow || namesTheHouse(fields[field])) fields[field] = '';
  }
  return details;
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
  deployment?: IssuerDeployment | null,
): ResolvedDisclaimer {
  if (issuer.kind === 'platform') return { text: PLATFORM_DISCLAIMER, source: 'platform' };
  if (stored?.is_enabled === false) return { text: '', source: 'disabled' };
  if (isNonEmpty(stored?.text)) {
    // The house's wording is the house's statement about the house; under
    // anybody else's name it is the defect this module was written against.
    // Given no deployment, stored text reads as it always did.
    if (deployment && houseWordingWithheld(stored.text, issuer, deployment)) {
      return { text: WORKSPACE_DEFAULT_DISCLAIMER, source: 'house_withheld' };
    }
    return { text: stored.text.trim(), source: 'stored' };
  }
  return { text: WORKSPACE_DEFAULT_DISCLAIMER, source: 'workspace_default' };
}

/**
 * The name and contact line a server-drawn document prints, from the brand
 * configuration its function reads (`brand-config.ts`).
 *
 * That configuration falls back to the house's mailbox where a deployment has
 * stored none, and to a placeholder name — right for the prime, whose mail it
 * is, and never right on a clone's document. So on a clone the name is the
 * issuer the one resolver answers and a contact value that names the house is
 * left out; on the prime every value reads as it always did.
 */
export function documentLetterhead(
  config: { companyName?: unknown; contactEmail?: unknown; contactPhone?: unknown },
  deployment: IssuerDeployment,
): { name: string; email: string; phone: string } {
  const value = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  if (deployment.prime) {
    return { name: value(config.companyName), email: value(config.contactEmail), phone: value(config.contactPhone) };
  }
  const issuer = resolveReportIssuer({ companyName: config.companyName }, deployment);
  // A configuration that names the house is the house's, line and mailbox alike.
  const houseRow = isHouseTradingName(config.companyName);
  const own = (v: unknown): string => (houseRow || namesTheHouse(v) ? '' : value(v));
  return { name: issuer.name, email: own(config.contactEmail), phone: own(config.contactPhone) };
}

/**
 * The masthead a freshly generated Investment narrative opens with.
 *
 * Both generators (`generate-investment-report`, `regenerate-report-qualitative`)
 * open `report_content` with the brand as a heading, the house's tagline and
 * the report's title, closed by a rule. On the prime that is the block it has
 * always written, byte for byte. On a clone the heading is the issuer the one
 * resolver answers — never the house's name, which a seeded settings row can
 * still hold — and NPC's tagline is left out, because it is NPC's own words.
 * The title line stays on both: it is how every reader recognises the block
 * (`narrativeClean.pure.ts`), and what the document is about is not branding.
 */
export function investmentReportMasthead(
  brandName: string,
  subject: string,
  deployment: IssuerDeployment,
): string {
  if (deployment.prime) {
    return `# ${brandName.toUpperCase()}\n\n${HOUSE_TAGLINE}\n\n# Investment Report: ${subject}\n\n---\n\n`;
  }
  const issuer = resolveReportIssuer({ companyName: brandName }, deployment);
  return `# ${issuer.name.toUpperCase()}\n\n# Investment Report: ${subject}\n\n---\n\n`;
}

/** A line of the masthead read as words: its heading marks removed. */
const mastheadWords = (line: string): string => line.trim().replace(/^#{1,6}\s+/, '');

/**
 * A stored narrative as a clone may show it on screen.
 *
 * Every renderer already drops the generator's masthead (`stripBakedCover`, and
 * the section filters of the two older presentations), but the report viewer
 * shows the stored text, and a clone's reports written before
 * `investmentReportMasthead` carry NPC's tagline under the clone's name — or
 * NPC's name itself. So on a clone the tagline, and a heading that is the
 * house trading under some name, are left out of that opening block. Only the
 * block: the lines above its closing rule, the way the generator wrote it. A
 * document that opens with prose, or the same words anywhere below the block,
 * is returned untouched, and on the prime nothing is.
 */
export function withoutHouseMasthead(markdown: string, deployment: IssuerDeployment): string {
  if (deployment.prime || !markdown) return markdown;
  const lines = markdown.split('\n');
  let end = -1;
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^---+$/.test(t)) { end = i; break; }
    if (/^#{1,6}\s+\S/.test(t) || isHouseTagline(t)) continue;
    return markdown;
  }
  if (end < 0) return markdown;
  const kept = lines.filter((line, i) => {
    if (i >= end) return true;
    const words = mastheadWords(line);
    if (isHouseTagline(words)) return false;
    return !(/^#{1,6}\s+\S/.test(line.trim()) && isHouseTradingName(words));
  });
  return kept.length === lines.length ? markdown : kept.join('\n');
}
