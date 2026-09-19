import { mayWriteCrossPortalField } from './crossPortalFieldOwnership.ts';
/**
 * Shared Legal Matter domain helpers (Solicitor Portal — Phase 3).
 *
 * One place for matter enums, field whitelists and normalisation so the
 * portal-facing (`solicitor-portal-matters`) and Command Centre facing
 * (`legal-matters-admin`) functions can never drift apart.
 */

export const LEGAL_MATTER_TYPES = [
  'purchase', 'sale', 'transfer', 'off_the_plan', 'house_and_land',
  'refinance', 'commercial', 'other',
] as const;

export const LEGAL_MATTER_STATUSES = [
  'instructed', 'contract_review', 'exchanged', 'cooling_off', 'conditions',
  'unconditional', 'pre_settlement', 'settled', 'post_settlement',
  'terminated', 'on_hold',
] as const;

export const LEGAL_PARTY_ROLES = [
  'buyer', 'seller', 'buyer_solicitor', 'seller_solicitor', 'agent', 'lender',
  'broker', 'builder', 'guarantor', 'trustee', 'accountant', 'other',
] as const;

export const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

/** Columns a solicitor (or staff) may write on a matter. Links are handled separately. */
export const MATTER_TEXT_FIELDS = [
  'matter_reference', 'title', 'property_address', 'property_suburb',
  'property_postcode', 'title_reference', 'lot_plan', 'pexa_workspace_id',
  'other_side_firm', 'risk_notes', 'shared_summary',
] as const;

export const SOLICITOR_PRIVATE_MATTER_FIELDS = ['internal_notes'] as const;
export const COMMAND_CENTRE_PRIVATE_MATTER_FIELDS = ['npc_internal_notes'] as const;

export const MATTER_NUMERIC_FIELDS = [
  'purchase_price', 'deposit_amount', 'deposit_percent',
] as const;

export const MATTER_DATE_FIELDS = [
  'contract_date', 'exchange_date', 'cooling_off_expiry', 'finance_clause_date',
  'building_pest_date', 'sunset_date', 'settlement_date', 'actual_settlement_date',
] as const;

/** Columns returned to portal + staff callers. Never selects financial-position data. */
const LEGAL_MATTER_SHARED_SELECT = `
  id, matter_reference, title, matter_type, status, client_id, firm_id,
  assigned_solicitor_user_id, purchase_file_id, client_deal_id, build_job_id,
  property_address, property_suburb, property_state, property_postcode,
  title_reference, lot_plan, purchase_price, deposit_amount, deposit_percent,
  contract_date, exchange_date, cooling_off_expiry, finance_clause_date,
  building_pest_date, sunset_date, settlement_date, actual_settlement_date,
  pexa_workspace_id, other_side_firm, risk_flag, risk_notes,
  shared_summary, opened_at, closed_at, kanban_position, stage_entered_at,
  row_version, created_at, updated_at
`;

/** List/search responses intentionally contain no audience-private notes. */
export const LEGAL_MATTER_SOLICITOR_LIST_SELECT = LEGAL_MATTER_SHARED_SELECT;
/** Only the authenticated Solicitor matter-detail contract includes practice notes. */
export const LEGAL_MATTER_SOLICITOR_DETAIL_SELECT = `${LEGAL_MATTER_SHARED_SELECT}, internal_notes`;
/** Command Centre has a separate NPC-owned note and cannot read practice notes. */
export const LEGAL_MATTER_COMMAND_CENTRE_SELECT = `${LEGAL_MATTER_SHARED_SELECT}, npc_internal_notes`;
export const LEGAL_MATTER_FINANCE_SUMMARY_SELECT = `
  id, client_id, matter_reference, status, property_address, settlement_date, updated_at
`;
export const LEGAL_MATTER_CLIENT_PROJECTION_SELECT = `
  case_id, client_id, legal_matter_id, matter_reference, friendly_status,
  shared_summary, property_address, settlement_date, next_client_action, updated_at
`;

/** Compatibility alias is deliberately the safe, note-free list contract. */
export const MATTER_SELECT = LEGAL_MATTER_SOLICITOR_LIST_SELECT;

/** Minimal matter summary returned by solicitor portal list surfaces. */
export const SOLICITOR_MATTER_LIST_SELECT = `
  id, matter_reference, title, matter_type, status, client_id,
  property_address, property_suburb, property_state, property_postcode,
  settlement_date, risk_flag
`;

/**
 * The flagged-matter strip, and the only list read that carries `risk_notes`.
 *
 * The dashboard's "Needs attention" card explains WHY a matter is flagged, so
 * it needs the note — but it shows at most five matters and only flagged ones.
 * Serving it from `list_matters` meant every page of every matter list carried
 * the note for matters nobody had flagged. This is the note plus what the card
 * already renders around it, filtered to `risk_flag` at the query rather than
 * in the client, under the same matter-access and firm scoping as any other
 * read here. It deliberately carries no financial or conveyancing columns.
 */
export const SOLICITOR_MATTER_RISK_SELECT = `
  id, matter_reference, title, matter_type, status, client_id,
  property_address, property_suburb, property_state, property_postcode,
  settlement_date, risk_flag, risk_notes
`;

export const PARTY_SELECT = `
  id, legal_matter_id, role, name, organisation, email, phone, address,
  reference, is_primary_contact, notes, created_at, updated_at
`;

export function cleanText(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().slice(0, max);
  return s.length ? s : null;
}

export function cleanNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function cleanDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function cleanEnum<T extends readonly string[]>(
  value: unknown, allowed: T, fallback: T[number] | null = null,
): T[number] | null {
  const s = String(value ?? '').trim();
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : fallback;
}

export function cleanState(value: unknown): string | null {
  const s = String(value ?? '').trim().toUpperCase();
  return AU_STATES.has(s) ? s : null;
}

/** Build a sanitised matter payload from arbitrary input. */
export function buildMatterPayload(
  body: Record<string, any>,
  { isCreate, audience = 'solicitor' }: { isCreate: boolean; audience?: 'solicitor' | 'command_centre' },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const f of MATTER_TEXT_FIELDS) {
    if (f in body) payload[f] = cleanText(body[f], f === 'shared_summary' || f === 'risk_notes' ? 8000 : 300);
  }
  const privateField = audience === 'solicitor' ? 'internal_notes' : 'npc_internal_notes';
  if (privateField in body) payload[privateField] = cleanText(body[privateField], 8000);
  for (const f of MATTER_NUMERIC_FIELDS) {
    // Transaction financials are Finance/Command Centre owned.
    if (audience === 'command_centre' && f in body && mayWriteCrossPortalField(f, 'command_centre')) payload[f] = cleanNumber(body[f]);
  }
  for (const f of MATTER_DATE_FIELDS) {
    // Finance clause is Finance-owned; the legal domain owns the remaining
    // contractual and settlement dates.
    if ((audience === 'command_centre' || f !== 'finance_clause_date') && f in body && mayWriteCrossPortalField(f, audience)) payload[f] = cleanDate(body[f]);
  }
  if ('property_state' in body) payload.property_state = cleanState(body.property_state);
  if ('matter_type' in body) {
    payload.matter_type = cleanEnum(body.matter_type, LEGAL_MATTER_TYPES, 'purchase');
  }
  if ('risk_flag' in body) payload.risk_flag = !!body.risk_flag;

  if (isCreate) {
    if (!payload.title) payload.title = cleanText(body.property_address, 300) || 'Untitled matter';
    if (!payload.matter_type) payload.matter_type = 'purchase';
  }

  return payload;
}

export function buildPartyPayload(body: Record<string, any>): Record<string, unknown> {
  return {
    role: cleanEnum(body.role, LEGAL_PARTY_ROLES, 'other'),
    name: cleanText(body.name, 200),
    organisation: cleanText(body.organisation, 200),
    email: cleanText(body.email, 200)?.toLowerCase() ?? null,
    phone: cleanText(body.phone, 40),
    address: cleanText(body.address, 400),
    reference: cleanText(body.reference, 120),
    is_primary_contact: !!body.is_primary_contact,
    notes: cleanText(body.notes, 4000),
  };
}

/**
 * Terminal statuses cannot be moved out of by the portal — Command Centre only.
 * Prevents an accidental re-open of a settled/terminated file from the portal.
 */
export const TERMINAL_STATUSES = new Set(['settled', 'post_settlement', 'terminated']);
