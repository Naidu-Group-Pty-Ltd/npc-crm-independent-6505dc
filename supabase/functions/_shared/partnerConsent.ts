/**
 * Partner referral consent — shared primitives (Phase 3).
 *
 * The consent statement is the artefact that proves a client agreed, before any
 * of their information crossed the boundary, to be referred. It must be stored
 * verbatim on the request row: a later dispute is about what the client was
 * shown, not about what the current template happens to say.
 */

export const CONSENT_STATEMENT_VERSION = 'v2.0';

export interface ConsentStatementParams {
  clientName: string;
  direction: 'inbound_property_referral' | 'outbound_finance_referral';
  referringEntity?: string | null;
  receivingEntity?: string | null;
  generalPurpose?: string | null;
}

const NPC = 'NPC Services Pty Ltd';

/** Verbatim consent wording (Annexure A of both partner agreement templates). */
export function buildConsentStatement(p: ConsentStatementParams): string {
  const inbound = p.direction === 'inbound_property_referral';
  const from = (inbound ? p.referringEntity : NPC) || (inbound ? 'the referring partner' : NPC);
  const to = (inbound ? NPC : p.receivingEntity) || (inbound ? NPC : 'the receiving finance partner');
  const purpose = inbound
    ? 'property research, strategy and acquisition support'
    : 'credit assistance, including assessing my borrowing capacity and loan options';

  return [
    `I, ${p.clientName}, consent to ${from} disclosing my name and contact details to ${to} for the purpose of being contacted about ${purpose}.`,
    `I understand that only my name, contact details and a general description of what I am seeking${p.generalPurpose ? ` (“${p.generalPurpose}”)` : ''} will be shared at this stage. No financial position, identification or credit information is shared as part of this referral.`,
    `I understand that a referral fee or commission may be payable between the parties in connection with this referral, and that this does not change the fees or interest I pay.`,
    `I understand that I am under no obligation to proceed, that I may choose a different provider at any time, and that I may withdraw this consent by contacting either party.`,
  ].join('\n\n');
}

/** Short benefit / conflict disclosure shown alongside the statement. */
export function buildDisclosureText(direction: string, feeSummary?: string | null): string {
  const base = direction === 'inbound_property_referral'
    ? `${NPC} may pay the referring party a referral fee if you become a client and a qualifying event occurs.`
    : `${NPC} may receive a referral fee or a share of commission from the finance partner if you proceed and a qualifying event occurs.`;
  return feeSummary ? `${base} ${feeSummary}` : base;
}

/** URL-safe opaque token — never stored, only its SHA-256 digest is persisted. */
export function generateConsentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashConsentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.trim()));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const APP_ORIGIN_FALLBACK = 'https://command-centre.npcservices.com.au';

export function consentLinkFor(token: string, requestOrigin?: string | null): string {
  const configured = (globalThis as any).Deno?.env?.get?.('PUBLIC_APP_URL');
  const origin = (configured || requestOrigin || APP_ORIGIN_FALLBACK).replace(/\/+$/, '');
  return `${origin}/partner-consent/${token}`;
}

/** A consent request only counts while it is pending/viewed and unexpired. */
export function isConsentRequestLive(row: { status: string; expires_at: string }): boolean {
  if (!['pending', 'viewed'].includes(row.status)) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}
