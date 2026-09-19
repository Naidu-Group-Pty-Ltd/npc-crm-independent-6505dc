/**
 * Submission review + party reconciliation — pure logic.
 *
 * Kept free of database and network access so every rule below is unit
 * testable: what changed between two immutable submission snapshots, which
 * declared parties need human reconciliation, and which parties are screenable.
 *
 * Reconciliation NEVER merges automatically. Similarity is emitted as a
 * suggestion with a score and must be confirmed by an authorised human; only
 * an exact stable identifier is offered as an exact candidate.
 */

export type PartyRole =
  | 'co_purchaser' | 'director' | 'trustee' | 'beneficial_owner' | 'beneficiary'
  | 'authorised_representative' | 'donor' | 'private_lender' | 'other';

/** Questionnaire role labels → canonical party roles (closed mapping). */
export const DECLARED_ROLE_MAP: Record<string, PartyRole> = {
  'Co-purchaser': 'co_purchaser',
  'Director': 'director',
  'Trustee': 'trustee',
  'Beneficial owner': 'beneficial_owner',
  'Beneficiary': 'beneficiary',
  'Authorised representative': 'authorised_representative',
  'Donor (gift)': 'donor',
  'Private lender': 'private_lender',
  'Other': 'other',
};

/** Party types that must hold identity evidence before a case can clear. */
export const VERIFICATION_REQUIRED_ROLES: PartyRole[] = [
  'co_purchaser', 'director', 'trustee', 'beneficial_owner', 'authorised_representative',
];

/** Party types that must be screened once reconciled. */
export const SCREENING_REQUIRED_ROLES: PartyRole[] = [
  'co_purchaser', 'director', 'trustee', 'beneficial_owner', 'beneficiary',
  'authorised_representative', 'donor', 'private_lender',
];

export interface DeclaredParty {
  role: string;
  full_name: string;
  payload: Record<string, unknown>;
}

/** Normalised comparison key — used for change detection only, never merging. */
export function declarationKey(role: string, name: string): string {
  return `${String(role).trim().toLowerCase()}|${String(name).trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function extractDeclaredParties(relatedPartiesPayload: unknown): DeclaredParty[] {
  const parties = (relatedPartiesPayload as any)?.parties;
  if (!Array.isArray(parties)) return [];
  const out: DeclaredParty[] = [];
  for (const entry of parties) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String((entry as any).full_name ?? (entry as any).name ?? '').trim();
    const role = String((entry as any).role ?? 'Other').trim();
    if (!name) continue;
    out.push({ role, full_name: name.slice(0, 200), payload: entry as Record<string, unknown> });
  }
  return out;
}

export type ChangeKind = 'new' | 'changed' | 'removed' | 'role_changed' | 'unchanged';

export interface ReconciliationPlanItem {
  declared_role: string;
  canonical_role: PartyRole;
  declared_name: string;
  declared_payload: Record<string, unknown>;
  declaration_hash: string;
  change_kind: ChangeKind;
  verification_required: boolean;
  screening_required: boolean;
}

/**
 * Diff declared parties between the previous and current submission and
 * produce the reconciliation work list. Removals are emitted so a staff user
 * can supersede a canonical link rather than silently dropping it.
 */
export function buildReconciliationPlan(
  current: DeclaredParty[],
  previous: DeclaredParty[],
): ReconciliationPlanItem[] {
  const prevByKey = new Map(previous.map((p) => [declarationKey(p.role, p.full_name), p]));
  const prevByName = new Map(previous.map((p) => [p.full_name.trim().toLowerCase(), p]));
  const items: ReconciliationPlanItem[] = [];

  for (const party of current) {
    const key = declarationKey(party.role, party.full_name);
    const sameKey = prevByKey.get(key);
    const sameName = prevByName.get(party.full_name.trim().toLowerCase());
    let change: ChangeKind;
    if (sameKey) {
      change = JSON.stringify(sameKey.payload) === JSON.stringify(party.payload) ? 'unchanged' : 'changed';
    } else if (sameName) {
      change = 'role_changed';
    } else {
      change = 'new';
    }
    const canonical = DECLARED_ROLE_MAP[party.role] ?? 'other';
    items.push({
      declared_role: party.role,
      canonical_role: canonical,
      declared_name: party.full_name,
      declared_payload: party.payload,
      declaration_hash: key,
      change_kind: change,
      verification_required: VERIFICATION_REQUIRED_ROLES.includes(canonical),
      screening_required: SCREENING_REQUIRED_ROLES.includes(canonical),
    });
  }

  for (const [key, party] of prevByKey) {
    if (!current.some((c) => declarationKey(c.role, c.full_name) === key)) {
      const canonical = DECLARED_ROLE_MAP[party.role] ?? 'other';
      items.push({
        declared_role: party.role,
        canonical_role: canonical,
        declared_name: party.full_name,
        declared_payload: party.payload,
        declaration_hash: key,
        change_kind: 'removed',
        verification_required: false,
        screening_required: false,
      });
    }
  }
  return items;
}

export interface CanonicalPartyCandidate {
  party_type: string;
  party_id: string;
  full_name: string;
  /** A stable identifier the client also supplied (never a name or email). */
  stable_identifier?: string | null;
}

export interface CandidateSuggestion {
  party_type: string;
  party_id: string;
  full_name: string;
  score: number;
  basis: 'name_similarity';
  /** Always true: a suggestion can never be applied without confirmation. */
  requires_confirmation: true;
}

/** Token overlap only — presentation-grade, never an authority to merge. */
export function nameSimilarity(a: string, b: string): number {
  const t = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
  const ta = t(a), tb = t(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const tok of ta) if (tb.has(tok)) shared++;
  return Math.round((shared / Math.max(ta.size, tb.size)) * 100) / 100;
}

/**
 * Resolve candidates for one declaration.
 *  - exact: only when a stable identifier matches exactly;
 *  - suggestions: name similarity above the floor, ordered, capped, and always
 *    flagged as requiring human confirmation.
 */
export function resolveCandidates(
  declaration: { declared_name: string; stable_identifier?: string | null },
  canonical: CanonicalPartyCandidate[],
  similarityFloor = 0.5,
): { exact: CanonicalPartyCandidate | null; suggestions: CandidateSuggestion[] } {
  const stable = String(declaration.stable_identifier ?? '').trim();
  const exact = stable
    ? canonical.find((c) => String(c.stable_identifier ?? '').trim() === stable && stable.length > 0) ?? null
    : null;

  const suggestions = canonical
    .filter((c) => !exact || c.party_id !== exact.party_id)
    .map((c) => ({
      party_type: c.party_type, party_id: c.party_id, full_name: c.full_name,
      score: nameSimilarity(declaration.declared_name, c.full_name),
      basis: 'name_similarity' as const, requires_confirmation: true as const,
    }))
    .filter((s) => s.score >= similarityFloor)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { exact: exact ?? null, suggestions };
}

/* ─────────────────────────── submission diffing ─────────────────────────── */

export interface SnapshotSection { section: string; status?: string; payload?: unknown }

export interface SubmissionDiffEntry {
  section: string;
  field: string;
  previous: unknown;
  current: unknown;
  kind: 'added' | 'removed' | 'changed';
}

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  } else {
    out[prefix || '_'] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  return out;
}

/** Field-level differences between two immutable snapshots. */
export function diffSubmissions(
  currentSections: SnapshotSection[],
  previousSections: SnapshotSection[],
): SubmissionDiffEntry[] {
  const prev = new Map(previousSections.map((s) => [s.section, flatten(s.payload ?? {})]));
  const out: SubmissionDiffEntry[] = [];
  for (const section of currentSections) {
    const cur = flatten(section.payload ?? {});
    const before = prev.get(section.section) ?? {};
    for (const [field, value] of Object.entries(cur)) {
      if (!(field in before)) out.push({ section: section.section, field, previous: null, current: value, kind: 'added' });
      else if (JSON.stringify(before[field]) !== JSON.stringify(value)) {
        out.push({ section: section.section, field, previous: before[field], current: value, kind: 'changed' });
      }
    }
    for (const [field, value] of Object.entries(before)) {
      if (!(field in cur)) out.push({ section: section.section, field, previous: value, current: null, kind: 'removed' });
    }
    prev.delete(section.section);
  }
  for (const [sectionName, before] of prev) {
    for (const [field, value] of Object.entries(before)) {
      out.push({ section: sectionName, field, previous: value, current: null, kind: 'removed' });
    }
  }
  return out;
}

/** Material change groups — a diff in any of these stales the risk assessment. */
const MATERIAL_SECTIONS = new Set(['personal_details', 'entity_details', 'related_parties', 'funding']);

export function submissionDiffIsMaterial(diff: SubmissionDiffEntry[]): boolean {
  return diff.some((d) => MATERIAL_SECTIONS.has(d.section));
}

/** Client-safe reason vocabulary for document rejection (Stage 9/10). */
export const CLIENT_SAFE_REJECTION_REASONS = [
  'not_readable', 'incomplete_document', 'expired_document', 'wrong_document_type',
  'details_do_not_match', 'poor_image_quality', 'other_please_resupply',
] as const;

export const CLIENT_SAFE_REJECTION_COPY: Record<string, string> = {
  not_readable: 'We could not read this document clearly. Please upload a clearer copy.',
  incomplete_document: 'Part of the document is missing. Please upload all pages.',
  expired_document: 'This document has expired. Please upload a current one.',
  wrong_document_type: 'This is not the document we asked for. Please check the request and upload the right one.',
  details_do_not_match: 'The details on this document do not match the information provided. Please check and upload again.',
  poor_image_quality: 'The image quality is too low to accept. Please take a new photo in good light.',
  other_please_resupply: 'We need a different copy of this document. Please upload another one.',
};

export function isClientSafeRejectionReason(code: unknown): boolean {
  return (CLIENT_SAFE_REJECTION_REASONS as readonly string[]).includes(String(code));
}
