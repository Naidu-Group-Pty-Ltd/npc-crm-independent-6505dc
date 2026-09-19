/**
 * Agreement Centre — the field registry.
 *
 * Every configurable value in the two locked templates, with: the label the
 * template gives it, the ORIGINAL `<<INSERT>>`-style bracket text (printed
 * whenever the field is unfilled, so an incomplete document looks exactly like
 * the supplied template), where it is stored on the `partner_agreements` row,
 * which section it belongs to (validation jump links), and whether issue is
 * blocked without it.
 *
 * `requiredForIssue` is derived strictly from the supplied documents — a field
 * is required when the template says the schedule must be completed before
 * execution or a clause cannot operate without it (a termination clause with no
 * notice period is not a term). No invented mandatory legal fields.
 *
 * Storage note: fields map either to a real `partner_agreements` column
 * (`db: { column }`) or to a namespaced key in the row's `schedule_extras`
 * jsonb (`db: { extra }`). Derived fields (`db: 'derived'`) are computed by
 * `projectFieldValues` and never stored — display names, brand contact rows,
 * the cover's document version.
 *
 * PURE — shared verbatim between the edge functions and the browser bridges.
 */

import type { AgreementFieldValues, AgreementTemplateKey } from './types.pure.ts';
import {
  CONTENT_OVERRIDES_EXTRA_KEY,
  CONTENT_OVERRIDES_VALUE_KEY,
  coerceContentOverrides,
} from './contentOverrides.pure.ts';
import {
  ADDITIONAL_CLAUSES_EXTRA_KEY,
  ADDITIONAL_CLAUSES_VALUE_KEY,
  coerceAdditionalClauses,
} from './additionalClauses.pure.ts';


export type AgreementFieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'percent'
  | 'date'
  | 'choice'
  | 'boolean';

export interface AgreementFieldOption {
  value: string;
  label: string;
}

export type AgreementFieldStorage =
  | { column: string }
  | { extra: string }
  | 'derived';

export interface AgreementFieldDef {
  key: string;
  /** The template's own label for this value. */
  label: string;
  type: AgreementFieldType;
  options?: AgreementFieldOption[];
  /** The verbatim bracket text the template prints where this value goes. */
  placeholder: string;
  /** Section anchor (see the content modules) — validation jump links. */
  sectionId: string;
  requiredForIssue?: boolean;
  db: AgreementFieldStorage;
  /**
   * Conditional field: only collected (and only validated / stored) when the
   * named field currently holds one of these values. This is how an "Other"
   * choice grows its own free-text box — the box is meaningless, and its stored
   * text misleading, when a preset option is selected.
   */
  visibleWhen?: { field: string; equals: string[] };
  /**
   * Wizard grouping: party fields prefill from the tenant / the selected
   * partner record; commercial fields are the negotiable schedule.
   */
  group: 'agreement' | 'issuer' | 'counterparty' | 'commercial' | 'clauses' | 'execution' | 'supporting';
}

/**
 * Is this field currently in play?
 *
 * Used by the wizard (what to render), by `rowPatchFromValues` (a hidden
 * conditional field is stored as null, so switching away from "Other" cannot
 * leave stale free text cascading into the executed document) and by
 * `validateForIssue` (never demand a field nobody can see).
 */
export function isAgreementFieldVisible(
  def: AgreementFieldDef,
  values: AgreementFieldValues,
): boolean {
  if (!def.visibleWhen) return true;
  const current = String(values[def.visibleWhen.field] ?? '');
  return def.visibleWhen.equals.includes(current);
}


// ── Shared field fragments ───────────────────────────────────────────────────

const INSERT = '<<INSERT>>';

function party(
  prefix: 'ba' | 'fp',
  column: 'principal' | 'partner',
  group: 'issuer' | 'counterparty',
  sectionId: string,
  labels: Record<string, string>,
  required: string[],
): AgreementFieldDef[] {
  const defs: AgreementFieldDef[] = [
    { key: `${prefix}_legal_name`, label: labels.legal, type: 'text', placeholder: INSERT, sectionId, db: { column: `${column}_legal_name` }, group },
    { key: `${prefix}_trading_name`, label: labels.trading, type: 'text', placeholder: INSERT, sectionId, db: { column: `${column}_trading_name` }, group },
    { key: `${prefix}_abn_acn`, label: 'ABN / ACN', type: 'text', placeholder: INSERT, sectionId, db: { column: `${column}_abn` }, group },
    { key: `${prefix}_address`, label: 'REGISTERED ADDRESS', type: 'text', placeholder: INSERT, sectionId, db: { column: `${column}_address` }, group },
    { key: `${prefix}_email`, label: 'PRIMARY EMAIL', type: 'text', placeholder: INSERT, sectionId, db: { column: `${column}_contact_email` }, group },
  ];
  return defs.map((def) => required.includes(def.key) ? { ...def, requiredForIssue: true } : def);
}

const EXECUTION_PREFILL: AgreementFieldDef[] = [
  { key: 'principal_signatory_name', label: 'Name of signatory:', type: 'text', placeholder: INSERT, sectionId: 'execution', db: { extra: 'principal_signatory_name' }, group: 'execution' },
  { key: 'principal_signatory_title', label: 'Title / capacity:', type: 'text', placeholder: INSERT, sectionId: 'execution', db: { extra: 'principal_signatory_title' }, group: 'execution' },
  { key: 'partner_signatory_name', label: 'Name of signatory:', type: 'text', placeholder: INSERT, sectionId: 'execution', db: { extra: 'partner_signatory_name' }, group: 'execution' },
  { key: 'partner_signatory_title', label: 'Title / capacity:', type: 'text', placeholder: INSERT, sectionId: 'execution', db: { extra: 'partner_signatory_title' }, group: 'execution' },
];

// ── Agreement 01 — Strategic Property Referral ───────────────────────────────

const STRATEGIC_REFERRAL_FIELDS: AgreementFieldDef[] = [
  { key: 'effective_date', label: 'AGREEMENT DATE', type: 'date', placeholder: '<<DATE>>', sectionId: 'agreement_details', requiredForIssue: true, db: { column: 'effective_date' }, group: 'agreement' },
  { key: 'governing_state', label: 'GOVERNING STATE / TERRITORY', type: 'text', placeholder: INSERT, sectionId: 'agreement_details', requiredForIssue: true, db: { column: 'governing_state' }, group: 'agreement' },

  ...party('ba', 'principal', 'issuer', 'agreement_details', {
    legal: 'BUYER\'S AGENCY LEGAL NAME',
    trading: 'BUYER\'S AGENCY TRADING NAME',
  }, ['ba_legal_name']),
  { key: 'ba_re_licence', label: 'REAL ESTATE LICENCE DETAILS', type: 'text', placeholder: '<<INSERT IF APPLICABLE>>', sectionId: 'agreement_details', db: { column: 'principal_licence_number' }, group: 'issuer' },

  ...party('fp', 'partner', 'counterparty', 'agreement_details', {
    legal: 'FINANCE PARTNER LEGAL NAME',
    trading: 'FINANCE PARTNER TRADING NAME',
  }, ['fp_legal_name']),
  { key: 'fp_acl_crn', label: 'ACL / CREDIT REPRESENTATIVE NUMBER', type: 'text', placeholder: INSERT, sectionId: 'agreement_details', db: { column: 'partner_acl_number' }, group: 'counterparty' },

  {
    key: 'remuneration_model', label: 'REMUNERATION MODEL', type: 'choice', placeholder: '',
    options: [
      { value: 'fixed_fee', label: 'Fixed fee' },
      { value: 'percentage_of_fee', label: 'Percentage of buyer\'s agency fee' },
      { value: 'other', label: 'Other' },
    ],
    sectionId: 'commercial_schedule', requiredForIssue: true, db: { column: 'fee_model' }, group: 'commercial',
  },
  {
    key: 'remuneration_model_other', label: 'REMUNERATION MODEL — Other', type: 'text',
    placeholder: '<<INSERT AGREED REMUNERATION MODEL>>', sectionId: 'commercial_schedule',
    requiredForIssue: true, visibleWhen: { field: 'remuneration_model', equals: ['other'] },
    db: { extra: 'remuneration_model_other' }, group: 'commercial',
  },
  { key: 'agreed_fee_value', label: 'AGREED AMOUNT / PERCENTAGE', type: 'text', placeholder: '<<INSERT AMOUNT OR PERCENTAGE>>', sectionId: 'commercial_schedule', requiredForIssue: true, db: { extra: 'agreed_fee_value' }, group: 'commercial' },
  {
    key: 'gst_treatment', label: 'GST TREATMENT', type: 'choice', placeholder: '',
    options: [
      { value: 'plus_gst', label: 'Plus GST' },
      { value: 'inclusive_of_gst', label: 'GST inclusive' },
      { value: 'not_applicable', label: 'Not applicable' },
    ],
    sectionId: 'commercial_schedule', requiredForIssue: true, db: { column: 'gst_treatment' }, group: 'commercial',
  },
  {
    key: 'qualifying_event', label: 'QUALIFYING EVENT', type: 'choice', placeholder: '',
    options: [
      { value: 'Engagement signed', label: 'Engagement signed' },
      { value: 'Unconditional contract', label: 'Unconditional contract' },
      { value: 'Settlement', label: 'Settlement' },
      { value: 'other', label: 'Other' },
    ],
    sectionId: 'commercial_schedule', requiredForIssue: true, db: { column: 'qualifying_event' }, group: 'commercial',
  },
  {
    key: 'qualifying_event_other', label: 'QUALIFYING EVENT — Other', type: 'text',
    placeholder: '<<INSERT AGREED QUALIFYING EVENT>>', sectionId: 'commercial_schedule',
    requiredForIssue: true, visibleWhen: { field: 'qualifying_event', equals: ['other'] },
    db: { extra: 'qualifying_event_other' }, group: 'commercial',
  },
  { key: 'payment_timeframe_days', label: 'PAYMENT TIMEFRAME', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'commercial_schedule', requiredForIssue: true, db: { column: 'payment_business_days' }, group: 'commercial' },
  {
    key: 'invoice_process', label: 'INVOICE PROCESS', type: 'choice', placeholder: '',
    options: [
      { value: 'tax_invoice', label: 'Tax invoice' },
      { value: 'rcti', label: 'RCTI' },
      { value: 'other', label: 'Other:' },
    ],
    sectionId: 'commercial_schedule', db: { column: 'invoice_process' }, group: 'commercial',
  },
  {
    key: 'invoice_process_other', label: 'INVOICE PROCESS — Other', type: 'text', placeholder: INSERT,
    sectionId: 'commercial_schedule', requiredForIssue: true,
    visibleWhen: { field: 'invoice_process', equals: ['other'] },
    db: { extra: 'invoice_process_other' }, group: 'commercial',
  },
  { key: 'excluded_matters', label: 'EXCLUDED MATTERS', type: 'longtext', placeholder: '<<INSERT EXCLUSIONS OR "NONE">>', sectionId: 'commercial_schedule', db: { column: 'exclusions' }, group: 'commercial' },
  { key: 'duplicate_referral_rule', label: 'DUPLICATE REFERRAL RULE', type: 'longtext', placeholder: '<<INSERT HOW PRIOR OR DUPLICATE CLIENTS ARE TREATED>>', sectionId: 'commercial_schedule', db: { column: 'duplicate_referral_rule' }, group: 'commercial' },
  { key: 'fee_cap_minimum', label: 'FEE CAP / MINIMUM', type: 'text', placeholder: '<<INSERT OR "NOT APPLICABLE">>', sectionId: 'commercial_schedule', db: { extra: 'fee_cap_minimum' }, group: 'commercial' },
  { key: 'post_termination_entitlement', label: 'POST-TERMINATION ENTITLEMENT', type: 'longtext', placeholder: '<<INSERT AGREED TREATMENT OF PRE-TERMINATION REFERRALS>>', sectionId: 'commercial_schedule', db: { column: 'post_termination_entitlement' }, group: 'commercial' },

  { key: 'termination_notice_days', label: 'Termination notice (clause 11.2)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'term_general', requiredForIssue: true, db: { column: 'termination_notice_days' }, group: 'clauses' },
  { key: 'breach_remedy_days', label: 'Breach remedy period (clause 11.3)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'term_general', requiredForIssue: true, db: { extra: 'breach_remedy_days' }, group: 'clauses' },
  { key: 'dispute_resolution_days', label: 'Dispute resolution window (clause 12.2)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'term_general', requiredForIssue: true, db: { column: 'dispute_window_days' }, group: 'clauses' },

  ...EXECUTION_PREFILL,
];

// ── Agreement 02 — Finance Referral & Commission ─────────────────────────────

const FINANCE_REFERRAL_FIELDS: AgreementFieldDef[] = [
  { key: 'effective_date', label: 'AGREEMENT DATE', type: 'date', placeholder: '<<DATE>>', sectionId: 'agreement_details', requiredForIssue: true, db: { column: 'effective_date' }, group: 'agreement' },
  { key: 'governing_state', label: 'GOVERNING STATE / TERRITORY', type: 'text', placeholder: INSERT, sectionId: 'agreement_details', requiredForIssue: true, db: { column: 'governing_state' }, group: 'agreement' },

  ...party('fp', 'partner', 'counterparty', 'agreement_details', {
    legal: 'FINANCE PARTNER LEGAL NAME',
    trading: 'FINANCE PARTNER TRADING NAME',
  }, ['fp_legal_name']),
  { key: 'fp_acl_crn', label: 'ACL / CREDIT REPRESENTATIVE NUMBER', type: 'text', placeholder: INSERT, sectionId: 'agreement_details', db: { column: 'partner_acl_number' }, group: 'counterparty' },
  { key: 'fp_licensee_aggregator', label: 'AUTHORISING LICENSEE / AGGREGATOR', type: 'text', placeholder: '<<INSERT OR N/A>>', sectionId: 'agreement_details', db: { column: 'partner_aggregator' }, group: 'counterparty' },
  { key: 'fp_commission_admin_email', label: 'COMMISSION ADMINISTRATION EMAIL', type: 'text', placeholder: INSERT, sectionId: 'agreement_details', db: { extra: 'fp_commission_admin_email' }, group: 'counterparty' },

  ...party('ba', 'principal', 'issuer', 'agreement_details', {
    legal: 'BUYER\'S AGENCY LEGAL NAME',
    trading: 'BUYER\'S AGENCY TRADING NAME',
  }, ['ba_legal_name']),
  { key: 'ba_property_licence', label: 'PROPERTY LICENCE DETAILS', type: 'text', placeholder: '<<INSERT IF APPLICABLE>>', sectionId: 'agreement_details', db: { column: 'principal_licence_number' }, group: 'issuer' },

  { key: 'upfront_commission_share', label: 'UPFRONT COMMISSION SHARE', type: 'percent', placeholder: '<<INSERT %>>', sectionId: 'commission_schedule', requiredForIssue: true, db: { column: 'upfront_share_pct' }, group: 'commercial' },
  { key: 'trail_commission_share', label: 'TRAIL COMMISSION SHARE', type: 'percent', placeholder: '<<INSERT % OR 0%>>', sectionId: 'commission_schedule', db: { column: 'trail_share_pct' }, group: 'commercial' },
  {
    key: 'commission_basis', label: 'COMMISSION BASIS', type: 'choice', placeholder: '',
    options: [
      { value: 'gross', label: 'Gross received' },
      { value: 'net_of_aggregator', label: 'Net of aggregator / licensee deductions' },
      { value: 'other', label: 'Other' },
    ],
    sectionId: 'commission_schedule', requiredForIssue: true, db: { column: 'commission_basis' }, group: 'commercial',
  },
  {
    key: 'commission_basis_other', label: 'COMMISSION BASIS — Other', type: 'text',
    placeholder: '<<INSERT AGREED COMMISSION BASIS>>', sectionId: 'commission_schedule',
    requiredForIssue: true, visibleWhen: { field: 'commission_basis', equals: ['other'] },
    db: { extra: 'commission_basis_other' }, group: 'commercial',
  },
  { key: 'qualifying_event_override', label: 'QUALIFYING EVENT', type: 'text', placeholder: INSERT, sectionId: 'commission_schedule', db: { extra: 'qualifying_event_override' }, group: 'commercial' },
  { key: 'payment_cycle', label: 'PAYMENT CYCLE', type: 'text', placeholder: '<<INSERT MONTHLY / SPECIFIC BUSINESS DAYS / OTHER>>', sectionId: 'commission_schedule', requiredForIssue: true, db: { column: 'payment_cycle' }, group: 'commercial' },
  {
    key: 'cleared_funds_condition', label: 'CLEARED FUNDS CONDITION', type: 'choice', placeholder: '',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    sectionId: 'commission_schedule', db: { column: 'cleared_funds_required' }, group: 'commercial',
  },
  {
    key: 'invoice_process', label: 'GST / TAX INVOICE PROCESS', type: 'choice', placeholder: '',
    options: [
      { value: 'tax_invoice', label: 'Tax invoice' },
      { value: 'rcti', label: 'RCTI' },
      { value: 'other', label: 'Other:' },
    ],
    sectionId: 'commission_schedule', db: { column: 'invoice_process' }, group: 'commercial',
  },
  {
    key: 'invoice_process_other', label: 'GST / TAX INVOICE PROCESS — Other', type: 'text', placeholder: INSERT,
    sectionId: 'commission_schedule', requiredForIssue: true,
    visibleWhen: { field: 'invoice_process', equals: ['other'] },
    db: { extra: 'invoice_process_other' }, group: 'commercial',
  },
  { key: 'clawback_treatment', label: 'CLAWBACK TREATMENT', type: 'longtext', placeholder: '<<INSERT PROPORTIONAL REPAYMENT / OFFSET / OTHER>>', sectionId: 'commission_schedule', requiredForIssue: true, db: { column: 'clawback_treatment' }, group: 'commercial' },
  { key: 'clawback_repayment_days', label: 'CLAWBACK REPAYMENT TIMEFRAME', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'commission_schedule', requiredForIssue: true, db: { column: 'clawback_repayment_days' }, group: 'commercial' },
  { key: 'refinance_treatment', label: 'REFINANCES / TOP-UPS / SUBSEQUENT LOANS', type: 'longtext', placeholder: '<<INSERT WHETHER INCLUDED OR EXCLUDED>>', sectionId: 'commission_schedule', db: { extra: 'refinance_treatment' }, group: 'commercial' },
  { key: 'duplicate_referral_rule', label: 'DUPLICATE REFERRAL RULE', type: 'longtext', placeholder: '<<INSERT HOW EXISTING OR DUPLICATE CLIENTS ARE TREATED>>', sectionId: 'commission_schedule', db: { column: 'duplicate_referral_rule' }, group: 'commercial' },
  { key: 'post_termination_entitlement', label: 'POST-TERMINATION ENTITLEMENT', type: 'longtext', placeholder: '<<INSERT AGREED TREATMENT OF PRE-TERMINATION REFERRALS>>', sectionId: 'commission_schedule', db: { column: 'post_termination_entitlement' }, group: 'commercial' },

  { key: 'fp_contact_timeframe', label: 'Client contact timeframe (clause 4.2)', type: 'text', placeholder: '<<TIMEFRAME>>', sectionId: 'referral_requirements', requiredForIssue: true, db: { extra: 'fp_contact_timeframe' }, group: 'clauses' },
  { key: 'payment_dispute_days', label: 'Payment dispute window (clause 5.3)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'commission_admin', requiredForIssue: true, db: { column: 'dispute_window_days' }, group: 'clauses' },
  { key: 'termination_notice_days', label: 'Termination notice (clause 12.2)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'term_general', requiredForIssue: true, db: { column: 'termination_notice_days' }, group: 'clauses' },
  { key: 'breach_remedy_days', label: 'Breach remedy period (clause 12.3)', type: 'number', placeholder: '<<NUMBER>>', sectionId: 'term_general', requiredForIssue: true, db: { extra: 'breach_remedy_days' }, group: 'clauses' },

  { key: 'lw_entity', label: 'LOAN WRITER / REPRESENTATIVE ENTITY', type: 'text', placeholder: INSERT, sectionId: 'form_loan_writer', db: { extra: 'lw_entity' }, group: 'supporting' },
  { key: 'lw_crn', label: 'CREDIT REPRESENTATIVE NUMBER', type: 'text', placeholder: INSERT, sectionId: 'form_loan_writer', db: { extra: 'lw_crn' }, group: 'supporting' },

  ...EXECUTION_PREFILL,
];

export function agreementFieldDefs(key: AgreementTemplateKey): readonly AgreementFieldDef[] {
  return key === 'strategic_property_referral' ? STRATEGIC_REFERRAL_FIELDS : FINANCE_REFERRAL_FIELDS;
}

// ── Projection: DB row → field values ────────────────────────────────────────

/** The subset of a `partner_agreements` row the projection reads. */
export interface AgreementRowLike {
  [key: string]: unknown;
  schedule_extras?: Record<string, unknown> | null;
  document_version?: string | null;
}

export interface IssuerContext {
  /** Tenant contact rows from the brand snapshot — email-pack sender lines. */
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  senderName?: string | null;
  senderTitle?: string | null;
}

function firstWord(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text.split(/\s+/)[0] : null;
}

function displayName(trading: unknown, legal: unknown): string | null {
  const t = String(trading ?? '').trim();
  const l = String(legal ?? '').trim();
  return t || l || null;
}

/** `12` → `12%`; `12.5` → `12.5%`; non-numeric passes through untouched. */
function percentDisplay(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : value;
}

/** ISO date → `8 August 2026`, for the printed document. */
export function formatAgreementDate(value: unknown): unknown {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return value ?? null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * Everything a renderer can substitute, from the working row.
 *
 * Includes every registered field plus the derived values the templates'
 * bracket tokens name: display names, the cover's document version, and the
 * email-pack sender lines from the issuer context.
 */
export function projectFieldValues(
  key: AgreementTemplateKey,
  row: AgreementRowLike,
  issuer: IssuerContext = {},
  options: { raw?: boolean } = {},
): AgreementFieldValues {
  const extras = (row.schedule_extras ?? {}) as Record<string, unknown>;
  const values: AgreementFieldValues = {};

  for (const def of agreementFieldDefs(key)) {
    if (def.db === 'derived') continue;
    let value = 'column' in def.db ? row[def.db.column] : extras[def.db.extra];
    if (!options.raw) {
      if (def.type === 'percent') value = percentDisplay(value);
      if (def.type === 'date') value = formatAgreementDate(value);
    } else if (def.type === 'date' && value) {
      value = String(value).slice(0, 10);
    }
    if (def.type === 'choice' && typeof value === 'boolean') value = value ? 'yes' : 'no';
    values[def.key] = value ?? null;
  }

  const baDisplay = displayName(row.principal_trading_name, row.principal_legal_name);
  const fpDisplay = displayName(row.partner_trading_name, row.partner_legal_name);

  values.ba_display_name = baDisplay;
  values.consent_referring_agency = baDisplay;
  values.fp_display_name = fpDisplay;
  // The white-label cover: the issuing organisation. Agreement 01 is issued by
  // the buyer's agency; Agreement 02 by the finance partner.
  values.company_name = key === 'strategic_property_referral'
    ? (baDisplay ?? issuer.companyName ?? null)
    : (fpDisplay ?? null);
  values.document_version = row.document_version ?? '2.0';
  values.recipient_first_name = firstWord(row.partner_contact_name);
  values.sender_name = issuer.senderName ?? null;
  values.sender_title = issuer.senderTitle ?? null;
  values.company_phone = issuer.phone ?? null;
  values.company_email = issuer.email ?? null;
  values.company_website = issuer.website ?? null;

  /**
   * The agreement's negotiated wording amendments travel WITH its values, not
   * beside them: a version row freezes `field_values`, so freezing the values
   * freezes the amended clauses too. Re-downloading version 1.0 after a later
   * negotiation cannot repaint the document somebody signed.
   */
  values[CONTENT_OVERRIDES_VALUE_KEY] = coerceContentOverrides(extras[CONTENT_OVERRIDES_EXTRA_KEY]);
  // Special conditions travel the same way, for the same reason.
  values[ADDITIONAL_CLAUSES_VALUE_KEY] = coerceAdditionalClauses(extras[ADDITIONAL_CLAUSES_EXTRA_KEY]);


  return values;
}

// ── Reverse mapping: wizard values → row patch ───────────────────────────────

export interface AgreementRowPatch {
  columns: Record<string, unknown>;
  extras: Record<string, unknown>;
}

function parsePercent(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(/%$/, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Register columns that `partner_agreements` declares NOT NULL.
 *
 * An empty field becomes `null` a few lines below, which is right for almost
 * every column and fatal for these: Postgres rejects the **entire** statement
 * with `23502`, so one blank issuer name discards every other edit in the same
 * step and the save fails with a message nobody can act on.
 *
 * It used to be invisible. `principal_legal_name` carried a column DEFAULT of
 * the founding tenant's own name, so a freshly created agreement was never
 * empty, the wizard read that value back, and the patch never sent null. The
 * white-label audit removed that default — correctly; it was printing one
 * agency's name on another agency's contract — and in doing so removed the
 * thing that had been accidentally keeping the column populated. Three
 * consecutive `23502`s in the production log, on a draft nobody could save,
 * are what that cost.
 *
 * The value is therefore **omitted rather than nulled**: the column keeps what
 * it has, which on a new row is its own default. Blanking a NOT NULL column is
 * not a thing the register supports in any case, and `validateForIssue` — not
 * a constraint violation — is what should stop an agreement going out with a
 * party missing.
 */
const NOT_NULL_COLUMNS: ReadonlySet<string> = new Set([
  'principal_legal_name',
  'partner_legal_name',
  'governing_state',
  'termination_notice_days',
  'dispute_window_days',
  'cleared_funds_required',
]);

/**
 * Turn edited field values into a `partner_agreements` update.
 *
 * Two rules with reasons:
 *  - The commission engine and the activation gate read the NUMERIC columns
 *    (`fee_amount`, `fee_percentage`), so Agreement 01's single "agreed amount
 *    or percentage" entry is mirrored into whichever numeric column the chosen
 *    remuneration model reads. One input for the person, both stores agreed.
 *  - Agreement 02's qualifying event defaults, in the template's own words, to
 *    "Settled loan and first drawdown" unless otherwise stated — so that is
 *    what the column carries when the override is empty.
 */
export function rowPatchFromValues(
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): AgreementRowPatch {
  const columns: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};

  for (const def of agreementFieldDefs(key)) {
    if (def.db === 'derived') continue;
    const hidden = !isAgreementFieldVisible(def, values);
    if (!hidden && !(def.key in values)) continue;
    let value = hidden ? null : values[def.key];
    if (value === '' || value === undefined) value = null;
    if (def.type === 'percent') value = parsePercent(value);
    if (def.type === 'number' && value !== null) {
      const n = parseInt(String(value), 10);
      value = Number.isFinite(n) ? n : null;
    }
    if ('column' in def.db) {
      if (def.db.column === 'cleared_funds_required') {
        columns[def.db.column] = value === 'yes' || value === true;
      } else if (value === null && NOT_NULL_COLUMNS.has(def.db.column)) {
        // Leave it alone rather than fail the whole statement. See the note on
        // NOT_NULL_COLUMNS — a null here costs the user every other edit in
        // the step, not just this one.
        continue;
      } else {
        columns[def.db.column] = value;
      }
    } else {
      extras[def.db.extra] = value;
    }
  }

  if (key === 'strategic_property_referral') {
    const model = String(values.remuneration_model ?? '');
    const agreed = String(values.agreed_fee_value ?? '').trim();
    const numeric = agreed ? Number(agreed.replace(/[$,%\s]/g, '')) : NaN;
    columns.fee_amount = model === 'fixed_fee' && Number.isFinite(numeric) ? numeric : null;
    columns.fee_percentage = model === 'percentage_of_fee' && Number.isFinite(numeric) ? numeric : null;
  }

  if (key === 'finance_referral_commission' && 'qualifying_event_override' in values) {
    const override = String(values.qualifying_event_override ?? '').trim();
    columns.qualifying_event = override || 'Settled loan and first drawdown';
  }

  // Clause amendments are stored (and re-read) as one map. Written only when
  // the caller actually carried it, so a partial values object — the wizard's
  // per-step forms — cannot wipe an existing amendment set.
  if (CONTENT_OVERRIDES_VALUE_KEY in values) {
    const overrides = coerceContentOverrides(values[CONTENT_OVERRIDES_VALUE_KEY]);
    extras[CONTENT_OVERRIDES_EXTRA_KEY] = Object.keys(overrides).length ? overrides : null;
  }

  // Additional clauses, likewise written only when the caller carried them.
  if (ADDITIONAL_CLAUSES_VALUE_KEY in values) {
    const clauses = coerceAdditionalClauses(values[ADDITIONAL_CLAUSES_VALUE_KEY]);
    extras[ADDITIONAL_CLAUSES_EXTRA_KEY] = clauses.length ? clauses : null;
  }


  return { columns, extras };
}

// ── Pre-issue validation ─────────────────────────────────────────────────────

export interface IssueValidationItem {
  key: string;
  label: string;
  sectionId: string;
}

export interface IssueValidation {
  ok: boolean;
  missing: IssueValidationItem[];
}

/**
 * What still needs attention before this agreement may be approved for issue.
 *
 * Enforced server-side on `approve_for_issue` and rendered as the validation
 * panel in the wizard, from the same list — the panel can never promise what
 * the server refuses.
 */
export function validateForIssue(
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): IssueValidation {
  const missing: IssueValidationItem[] = [];
  for (const def of agreementFieldDefs(key)) {
    if (!def.requiredForIssue) continue;
    if (!isAgreementFieldVisible(def, values)) continue;
    const value = values[def.key];
    const empty = value === null || value === undefined || String(value).trim() === '';
    if (empty) missing.push({ key: def.key, label: def.label, sectionId: def.sectionId });
  }
  return { ok: missing.length === 0, missing };
}

// ── Token substitution (plain text) ──────────────────────────────────────────

/** Placeholders for derived tokens that have no registry entry. */
export const DERIVED_TOKEN_PLACEHOLDERS: Record<string, string> = {
  ba_display_name: '<<BUYER\'S AGENCY NAME>>',
  // The client consent declaration names the agency that actually made the
  // referral, which in a blank template is nobody. Its own token, because
  // `ba_display_name` is gap-filled from the tenant's brand for the cover and
  // the correspondence — correct there, wrong in a declaration a third party
  // administers and a client signs. Bracket text supplied by the document owner.
  consent_referring_agency: '<< BUYERS AGENT PARTNER NAME>>',
  fp_display_name: '<<FINANCE PARTNER NAME>>',
  company_name: '<<COMPANY NAME>>',
  recipient_first_name: '<<FIRST NAME>>',
  sender_name: '<<SENDER NAME>>',
  sender_title: '<<TITLE>>',
  company_phone: '<<PHONE>>',
  company_email: '<<EMAIL>>',
  company_website: '<<WEBSITE>>',
  document_version: '2.0',
};

const FIELD_TOKEN = /\{\{([a-z0-9_]+)\}\}/g;

/** The template's original bracket text for a token — printed when unfilled. */
export function placeholderForToken(key: AgreementTemplateKey, token: string): string {
  const def = agreementFieldDefs(key).find((f) => f.key === token);
  return def?.placeholder || DERIVED_TOKEN_PLACEHOLDERS[token] || `<<${token.toUpperCase()}>>`;
}

/** Bound value, or the original bracket text. No markup — DOCX, file names. */
export function substitutePlain(
  text: string,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): string {
  return text.replace(FIELD_TOKEN, (_, token: string) => {
    const value = values[token];
    const filled = value !== null && value !== undefined && String(value).trim() !== '';
    return filled ? String(value) : placeholderForToken(key, token);
  });
}

// ── Change-request section buckets ───────────────────────────────────────────

export const CHANGE_REQUEST_SECTIONS = [
  { key: 'commercial_schedule', label: 'Commercial Schedule' },
  { key: 'agreement_details', label: 'Agreement Details' },
  { key: 'execution_details', label: 'Execution Details' },
  { key: 'other', label: 'Other' },
] as const;

export type ChangeRequestSectionKey = (typeof CHANGE_REQUEST_SECTIONS)[number]['key'];

/**
 * Field-level diff between two issued versions — the "Updated in Version 1.1"
 * summary. UI metadata only; the wording around a field never changes.
 */
export function diffFieldValues(
  key: AgreementTemplateKey,
  previous: AgreementFieldValues,
  next: AgreementFieldValues,
): { field: string; label: string; previous: unknown; updated: unknown }[] {
  const changes: { field: string; label: string; previous: unknown; updated: unknown }[] = [];
  for (const def of agreementFieldDefs(key)) {
    if (def.db === 'derived') continue;
    const before = previous[def.key] ?? null;
    const after = next[def.key] ?? null;
    if (String(before ?? '') !== String(after ?? '')) {
      changes.push({ field: def.key, label: def.label, previous: before, updated: after });
    }
  }
  return changes;
}
