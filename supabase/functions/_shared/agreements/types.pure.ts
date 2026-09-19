/**
 * Agreement Centre — the shared type model for the two locked agreement
 * templates and everything that renders or binds them.
 *
 * ## The one rule everything below serves
 *
 * The legal wording of the two supplied agreements is LOCKED. Nothing in this
 * codebase may rewrite, paraphrase, shorten, renumber or "improve" a clause, a
 * heading, a checkbox label, a disclosure or an execution provision. The only
 * permitted transformation is the one the templates themselves invite: their
 * `<<INSERT>>`-style brackets become bound fields. In the content modules those
 * brackets are written as `{{field_key}}` tokens — a purely technical binding —
 * and every field carries the ORIGINAL bracket text as its `placeholder`, so an
 * unfilled document prints exactly what the supplied template printed.
 *
 * Because the content is data rather than markup, one definition feeds every
 * representation: the live preview in the Command Centre wizard, the partner's
 * review room in the Finance Portal, the WeasyPrint PDF, the DOCX export and
 * the executed master copy. They cannot drift apart, because there is nothing
 * to drift — see `contentHash` below for how that is made checkable.
 *
 * PURE, and imported by the browser through `src/lib/agreements/` bridge
 * re-exports (the `partnerAgreementRevision.pure.ts` pattern). No Deno APIs,
 * no network, no clock.
 */

// ── Template identity ────────────────────────────────────────────────────────

export type AgreementTemplateKey =
  | 'strategic_property_referral'
  | 'finance_referral_commission';

export type PartnerAgreementDirection =
  | 'inbound_property_referral'
  | 'outbound_finance_referral';

/**
 * The register's `direction` column IS the template selector.
 *
 * Agreement 01 (Strategic Property Referral) is issued by the Buyer's Agency
 * and covers partners referring clients IN; Agreement 02 (Finance Referral &
 * Commission) covers the agency referring clients OUT to the finance partner.
 * Deriving one from the other means a row can never carry a template that
 * contradicts its direction.
 */
export function templateKeyForDirection(direction: PartnerAgreementDirection): AgreementTemplateKey {
  return direction === 'inbound_property_referral'
    ? 'strategic_property_referral'
    : 'finance_referral_commission';
}

export function directionForTemplateKey(key: AgreementTemplateKey): PartnerAgreementDirection {
  return key === 'strategic_property_referral'
    ? 'inbound_property_referral'
    : 'outbound_finance_referral';
}

// ── Field values ─────────────────────────────────────────────────────────────

/** Bound values keyed by field key. Everything dynamic about a document. */
export type AgreementFieldValues = Record<string, unknown>;

// ── Content blocks ───────────────────────────────────────────────────────────
//
// Text in any block may carry `{{field_key}}` tokens. A renderer substitutes
// the bound value, or the field's original placeholder text when unbound.

/** One line of the cover's particulars panel — `BETWEEN`, `DATED`, …. */
export interface CoverParticular {
  label: string;
  /** Text with `{{field_key}}` tokens; unbound fields print their brackets. */
  value: string;
}

export interface CoverBlock {
  kind: 'cover';
  /** `[ INSERT COMPANY LOGO ]` in the source — replaced by the tenant's mark. */
  logoPlaceholder: string;
  /** `{{company_name}}` — the issuing organisation's name. */
  companyNameToken: string;
  titleLines: string[];
  issuedByLine: string;
  /**
   * Who is bound, and on what terms — the block a legal instrument's cover
   * exists to carry.
   *
   * This replaced a template descriptor and a row of `EDITABLE` /
   * `BRAND-READY` chips. Those described the *product* to somebody choosing a
   * template; on the cover of an executed agreement they are marketing, and a
   * counterparty's lawyer reading "BRAND-READY" above the parties' names
   * learns nothing and thinks less of the document. The particulars are the
   * opposite: every line is a fact about this agreement, bound from the
   * register, and printing its own `<<INSERT>>` bracket while unfilled.
   */
  particulars: CoverParticular[];
  /** e.g. `VERSION {{version_label}}  |  EFFECTIVE DATE: {{effective_date}}` */
  versionLine: string;
  /** The template/legal-review statement. Kept verbatim on every output. */
  reviewStatement: string;
}

/** A labelled information panel — "Completion standard", "Parties", …. */
export interface NoteBlock {
  kind: 'note';
  label: string;
  body: string;
}

export interface EmailChecklistStep {
  step: string;
  title: string;
  detail: string;
}

/** Section E — the partner email template page. */
export interface EmailTemplateBlock {
  kind: 'emailTemplate';
  subjectLabel: string;
  subject: string;
  bodyParagraphs: string[];
  signoffLines: string[];
  checklistTitle: string;
  checklist: EmailChecklistStep[];
  attachmentsTitle: string;
  attachments: string[];
}

export interface GridChoiceOption {
  value: string;
  label: string;
}

/**
 * One cell of a details / schedule / form grid. Exactly one content mode:
 *  - `fieldKey` — a simple bound value;
 *  - `template` — verbatim text carrying `{{field_key}}` tokens;
 *  - `choice`   — a locked checkbox group whose selection is the bound value;
 *  - `text`     — fully static content.
 */
export interface GridCellDef {
  label: string;
  fieldKey?: string;
  template?: string;
  choice?: {
    /** Static sentence set before the options, verbatim from the cell. */
    lead?: string;
    fieldKey: string;
    options: GridChoiceOption[];
    /** Trailing free-text of an "Other: <<INSERT>>" option. */
    otherFieldKey?: string;
    multi?: boolean;
  };
  text?: string;
}

/** Rows of one or two cells, exactly as the source tables lay them out. */
export interface GridBlock {
  kind: 'grid';
  rows: GridCellDef[][];
}

/** Side-by-side responsibility panels ("MAY" / "MUST NOT", …). */
export interface DualPanelBlock {
  kind: 'dualPanel';
  left: { title: string; bullets: string[] };
  right: { title: string; bullets: string[] };
}

export interface ClauseDef {
  number: string;
  heading: string;
  subclauses: { number: string; text: string }[];
}

export interface ClauseGroupBlock {
  kind: 'clauses';
  clauses: ClauseDef[];
}

/** The seven-stage referral workflow graphic. */
export interface WorkflowBlock {
  kind: 'workflow';
  steps: { num: string; title: string; text: string }[];
}

export type ExecutionPartyRole = 'principal' | 'partner' | 'loan_writer' | 'client';

export interface ExecutionPartyDef {
  role: ExecutionPartyRole;
  /** `SIGNED FOR THE BUYER'S AGENCY` — verbatim. */
  title: string;
}

/**
 * An execution block: one or two signature panels side by side. The line
 * labels inside every panel are identical across the templates and live once
 * in `EXECUTION_PANEL_LINES`. At execution time a renderer fills a panel from
 * the recorded signature; before it, the panel prints the template's blank
 * lines and placeholders.
 */
export interface ExecutionBlock {
  kind: 'execution';
  parties: ExecutionPartyDef[];
}

/** The verbatim line labels of a signature panel. One definition, all panels. */
export const EXECUTION_PANEL_LINES = {
  legalEntity: 'Legal entity:',
  signatoryName: 'Name of signatory:',
  signatoryTitle: 'Title / capacity:',
  signature: 'Signature:',
  date: 'Date:',
  witness: 'Witness (if required):',
} as const;

/** A client-consent declaration with its own signature row (Agreement 02, Form A). */
export interface ConsentBlock {
  kind: 'consent';
  label: string;
  /** Verbatim declaration; carries `{{field}}` tokens for the party names. */
  body: string;
  signatureLabel: string;
  dateLabel: string;
}

export type AgreementBlock =
  | CoverBlock
  | NoteBlock
  | EmailTemplateBlock
  | GridBlock
  | DualPanelBlock
  | ClauseGroupBlock
  | WorkflowBlock
  | ExecutionBlock
  | ConsentBlock;

// ── Sections ─────────────────────────────────────────────────────────────────

export interface SectionHeaderMeta {
  /** The badge in the source header — `1`, `2A`, `5-7`, `E`, `A`, `B5`, `C`. */
  badge: string;
  heading: string;
  /** The trailing hint set beside the heading — "Complete before issue". */
  hint?: string;
  /** The second header line — "Core entity and authority information". */
  sub?: string;
}

/**
 * Who a section is for.
 *
 * `template_pack` marks the partner-email page and its "How to use this page"
 * card: material the template itself instructs is prepared-and-removed before
 * issue ("… and delete this guidance card before issue"). It is included in
 * template previews and in the downloadable DOCX/PDF pack — where a user works
 * the manual path the template was written for — and excluded from digitally
 * issued and executed documents, which is the template's own instruction
 * applied, not an edit to its content.
 */
export type SectionAudience = 'always' | 'template_pack';

export interface AgreementSectionDef {
  /** Stable anchor id — navigation, validation jump links, change requests. */
  id: string;
  header: SectionHeaderMeta | null;
  audience: SectionAudience;
  blocks: AgreementBlock[];
}

export interface AgreementTemplateContent {
  key: AgreementTemplateKey;
  /** `Strategic Property Referral Agreement` — the document's own name. */
  title: string;
  /** The register direction this template binds to. */
  direction: PartnerAgreementDirection;
  /** Who issues it, verbatim from the cover. */
  issuedByLine: string;
  /** The template's own document version marker ("2.0"). */
  documentVersion: string;
  sections: AgreementSectionDef[];
}

// ── Content hashing ──────────────────────────────────────────────────────────

/**
 * 64-bit FNV-1a over the serialised template content — the same construction
 * `report_brand_snapshots` uses for its fingerprint. Frozen onto every issued
 * version row, so an audit can state that the wording a partner reviewed is the
 * wording this build carries, and a content edit is visible as a hash change
 * on the next issue rather than silently absorbed.
 */
export function agreementContentHash(content: AgreementTemplateContent): string {
  const text = JSON.stringify(content);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i) & 0xff);
    hash = (hash * prime) & mask;
    // Fold the high byte of multi-byte characters in as well, so two strings
    // differing only above 0xff cannot collide by truncation.
    const high = text.charCodeAt(i) >> 8;
    if (high) {
      hash ^= BigInt(high);
      hash = (hash * prime) & mask;
    }
  }
  return hash.toString(16).padStart(16, '0');
}
