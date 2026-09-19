/**
 * Didit hosted-session IDV: status vocabulary, required-feature validation,
 * correlation and sanitisation.
 *
 * Pure and dependency-free, because everything that matters about this
 * provider is a decision about someone's identity made from a payload we did
 * not write, and all of it has to be testable without the network.
 *
 * ## Why this module exists at all
 *
 * The self-hosted provider hands us a shape we designed. Didit does not: the
 * V3 contract was read off the live account rather than remembered, and three
 * things about it would each have produced a wrong answer if assumed.
 *
 *  1. **The feature results are ARRAYS.** `id_verifications`, `liveness_checks`
 *     and `face_matches` are plural, and `null` until the workflow has run that
 *     feature at least once. Reading `decision.face_match.status` — the obvious
 *     shape, and the V2 one — yields `undefined`, which is exactly the value a
 *     naive mapper turns into a pass.
 *  2. **The feature is named differently at the two layers.** The workflow node
 *     is `OCR`; the session reports `ID_VERIFICATION`. A required-feature check
 *     written against the workflow vocabulary matches nothing on the decision.
 *  3. **Feature status and session status share words but not a vocabulary.**
 *     A feature is one of `Not Finished | Approved | Declined | In Review`; a
 *     session adds `Not Started`, `In Progress`, `Awaiting User`, `Expired`,
 *     `Abandoned`, `Kyc Expired`, `Resubmitted`. Collapsing them loses the
 *     distinction between "the customer walked away" and "we examined them and
 *     said no", which is the difference between a free retry and a consumed
 *     attempt.
 *
 * ## The rule the whole module serves
 *
 * NPC requires ID Verification, Face Match 1:1 and Passive Liveness. An
 * `Approved` session whose required evidence is absent, unexecuted or
 * unreadable is NOT a pass — it is a referral. Unknown never becomes passed.
 */

import {
  IDENTITY_DOCUMENT_COUNTRY, type IdentityDocumentChoice,
} from '../identityDocuments.pure.ts';

/** Session-level lifecycle vocabulary (Didit V3, case-sensitive). */
export type DiditSessionStatus =
  | 'Not Started' | 'In Progress' | 'Awaiting User' | 'In Review'
  | 'Approved' | 'Declined' | 'Resubmitted' | 'Expired'
  | 'Kyc Expired' | 'Abandoned';

/** Per-feature vocabulary (Didit V3, case-sensitive). Narrower than the above. */
export type DiditFeatureStatus = 'Not Finished' | 'Approved' | 'Declined' | 'In Review';

/**
 * The three modules NPC's workflow runs, named as the SESSION reports them.
 *
 * `ID_VERIFICATION` is deliberately not `OCR`: the workflow graph node is
 * `OCR`, the session decision calls the same module `ID_VERIFICATION`, and the
 * validation below runs against the decision.
 */
export const REQUIRED_DIDIT_FEATURES = ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'] as const;
export type RequiredDiditFeature = typeof REQUIRED_DIDIT_FEATURES[number];

/** Which decision array carries each required feature's results. */
const FEATURE_RESULT_KEY: Record<RequiredDiditFeature, string> = {
  ID_VERIFICATION: 'id_verifications',
  LIVENESS: 'liveness_checks',
  FACE_MATCH: 'face_matches',
};

/** Human-readable labels for staff evidence. Never shown to the customer. */
export const FEATURE_LABEL: Record<RequiredDiditFeature, string> = {
  ID_VERIFICATION: 'ID verification',
  LIVENESS: 'Passive liveness',
  FACE_MATCH: 'Face match 1:1',
};

/* ─────────────────────── session-level expectations ─────────────────────── */

/**
 * NPC's document choice, in Didit's `expected_document_types` vocabulary.
 *
 * Read off the current Session API reference (`expected_details`), which
 * documents the accepted values as `P`, `ID`, `DL`, `RP`, `HIC`, `TC`, `SSC`
 * and states the field is case-insensitive. Only four of them are mapped, and
 * that is the point: NPC verifies identity from a photographic document, so
 * the health-insurance, tax and social-security codes are deliberately
 * unreachable from the portal — a Medicare or concession card is not an
 * identity document here, and the way to guarantee one is never accepted is to
 * have no value that produces it.
 *
 * This mapping lives with the provider rather than with
 * `identityDocuments.pure.ts` on purpose. The portal imports the choices; if
 * the provider's codes travelled with them, the browser bundle would carry the
 * vendor's vocabulary — the same reason the workflow id and the provider key
 * never cross that boundary.
 */
const DIDIT_DOCUMENT_TYPE: Record<IdentityDocumentChoice, string> = {
  passport: 'P',
  driver_licence: 'DL',
  identity_card: 'ID',
  residence_permit: 'RP',
};

/**
 * `expected_details` for a session, or `null` when nothing is restricted.
 *
 * Two things are asserted and neither comes from a browser: the country, which
 * is always Australia because that is the only jurisdiction NPC operates this
 * flow for, and the document type, which is the customer's declared intent.
 *
 * The country is emitted even when no document was declared. An unrestricted
 * session still has no business offering a global country picker, and
 * `id_country` on its own is what removes it.
 *
 * Nothing else is sent. `expected_details` also accepts a name, a date of
 * birth, an address and a document number, and populating any of them would
 * export customer PII into the provider's record of the session for no gain —
 * the decision is read back and correlated on `vendor_data`, which discloses
 * nothing.
 */
export function diditExpectedDetails(
  choice: IdentityDocumentChoice | null | undefined,
  country: string = IDENTITY_DOCUMENT_COUNTRY,
): Record<string, unknown> | null {
  const details: Record<string, unknown> = { id_country: country };
  if (choice && DIDIT_DOCUMENT_TYPE[choice]) {
    details.expected_document_types = [DIDIT_DOCUMENT_TYPE[choice]];
  }
  return details;
}

/**
 * A session status that means the provider has finished looking and reached a
 * position on identity. Only these may produce an identity outcome, and only
 * these may consume one of the customer's attempts.
 */
const TERMINAL_DECISION_STATUSES: ReadonlySet<string> = new Set([
  'Approved', 'Declined', 'In Review',
]);

/**
 * A session that ended without an identity position.
 *
 * The customer closed the tab, the link aged out, or they were asked to start
 * again. None of it is a finding against them: an abandoned session leaves no
 * adverse identity outcome and consumes nothing, and the portal is free to
 * offer a new session under the existing in-flight rules.
 */
const CLOSED_WITHOUT_DECISION: ReadonlySet<string> = new Set([
  'Expired', 'Abandoned', 'Kyc Expired',
]);

/** Still in the customer's hands. Not a result and not a failure. */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  'Not Started', 'In Progress', 'Awaiting User', 'Resubmitted',
]);

export function isTerminalDiditStatus(status: string): boolean {
  return TERMINAL_DECISION_STATUSES.has(status);
}
export function isClosedWithoutDecision(status: string): boolean {
  return CLOSED_WITHOUT_DECISION.has(status);
}
export function isInFlightDiditStatus(status: string): boolean {
  return IN_FLIGHT_STATUSES.has(status);
}

/* ───────────────────────────── correlation ───────────────────────────── */

/**
 * The opaque identifier Didit stores as `vendor_data`.
 *
 * Deliberately built from internal identifiers only. Didit groups sessions by
 * `vendor_data`, so it is durable, cross-session, and visible in their console
 * — putting a name, an email, a document number or a date of birth here would
 * export customer PII into a field whose whole purpose is to be shared and
 * retained. `npc:<case-id>:<party-id|primary>:<attempt>` correlates exactly as
 * well and discloses nothing.
 *
 * ## The hosted session is keyed on the PERSON, and the attempt is omitted
 *
 * `POST /v3/session/` is not a create — it is an upsert keyed on
 * `workflow_id + vendor_data`. Re-measured against the live API on 2026-08-14:
 * two creates with the same pair returned byte-identical `session_id`,
 * `session_token`, `url` and `session_number`, and merely overwrote
 * `metadata`.
 *
 * Didit groups sessions into a Directory user BY that exact string — so the
 * suffix decides whether one applicant is one person or several in the
 * provider's console. Measured on this account: case `8c58cc07…` produced TWO
 * Directory users, `npc:8c58cc07…:primary` and `npc:8c58cc07…:primary:3`,
 * because the key carried the attempt. The hosted flow therefore mints the
 * three-part, person-scoped form and `attempt` is left off:
 *
 *   - one NPC applicant is one Didit user, and every session they ever run
 *     aggregates under it (Verifications → User Verifications, Directory →
 *     Users);
 *   - the upsert becomes the outermost duplicate-charge guard, because a
 *     refresh, a double-click or a second tab all return the SAME unstarted
 *     session rather than buying another.
 *
 * The cost of that choice is recorded honestly: a key that no longer varies
 * cannot force a fresh session, so the `workflow_revised_at` guard can release
 * NPC's row but cannot re-mint under a new configuration while the provider's
 * session is still alive (7 days, `session_expiration_time`). A settled or
 * expired session is replaced normally. That is a deliberate trade of
 * reconfiguration latency for provider-side identity, and it is the trade the
 * Directory requirement asks for.
 *
 * `attempt` is still ACCEPTED on the way in — sessions minted under the
 * four-part form are live for seven days and their decisions must still
 * correlate. See `parseVendorData`.
 */
export function buildVendorData(
  caseId: string, partyId: string | null, attempt?: number | null,
): string {
  const base = `npc:${caseId}:${partyId ?? 'primary'}`;
  return Number.isFinite(attempt) && (attempt as number) > 0
    ? `${base}:${attempt}`
    : base;
}

export interface ParsedVendorData {
  caseId: string;
  partyId: string | null;
  /** Null for the legacy two-part form, which predates attempt scoping. */
  attempt: number | null;
}

/**
 * Returns null when the value is not ours or not a shape we mint.
 *
 * Both shapes are accepted. Sessions created before attempt scoping carry the
 * three-part form and can still be running — refusing to parse them would
 * break correlation on a live session and strand its decision.
 */
export function parseVendorData(value: unknown): ParsedVendorData | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [prefix, caseId, party, attempt] = parts;
  if (prefix !== 'npc' || !caseId || !party) return null;
  if (parts.length === 4) {
    if (!/^[1-9][0-9]*$/.test(attempt)) return null;
    return { caseId, partyId: party === 'primary' ? null : party, attempt: Number(attempt) };
  }
  return { caseId, partyId: party === 'primary' ? null : party, attempt: null };
}

/**
 * Whether a decision's `vendor_data` is the one we minted for this check.
 *
 * A webhook body is attacker-influenced in principle and provider-supplied in
 * practice; a session that correlates to a different case or party must never
 * write an outcome onto this row.
 */
export function vendorDataMatches(
  value: unknown, caseId: string, partyId: string | null,
  expectedAttempt?: number | null,
): boolean {
  const parsed = parseVendorData(value);
  if (!parsed) return false;
  if (parsed.caseId !== caseId) return false;
  if ((parsed.partyId ?? null) !== (partyId ?? null)) return false;
  // The attempt is compared only when both sides carry one. A legacy session
  // has none, and the expected value is absent wherever the caller has not
  // read the row's capture sequence — in both cases the session id, checked
  // separately, is what pins the decision to this exact row.
  if (parsed.attempt != null && expectedAttempt != null
      && parsed.attempt !== expectedAttempt) return false;
  return true;
}

/**
 * Whether an in-flight session was minted under configuration that has since
 * been replaced.
 *
 * A hosted session is created against the workflow as it stood at that instant
 * and then lives for seven days, so a customer who pressed Start before a
 * change stays on the old configuration until it expires — a reconfiguration
 * that never reaches the people it was made for.
 *
 * The provider's version number cannot tell us this. Measured on this
 * account: changing a SETTING left the published workflow at version 1, while
 * editing the GRAPH created version 2 — so a session and the live workflow can
 * report the same version across a change that matters. The marker is
 * therefore NPC's, recorded on the provider config when the workflow changes.
 *
 * Unknown answers are "not stale" on purpose. No marker, an unparseable
 * marker or an unparseable creation time all mean the guard does nothing —
 * which is the behaviour that existed before it, and cannot strand anybody
 * mid-verification.
 */
export function isStaleHostedSession(
  mintedAt: string | null | undefined,
  workflowRevisedAt: number | null,
): boolean {
  if (workflowRevisedAt == null || !Number.isFinite(workflowRevisedAt)) return false;
  if (typeof mintedAt !== 'string' || !mintedAt) return false;
  const created = Date.parse(mintedAt);
  if (!Number.isFinite(created)) return false;
  return created < workflowRevisedAt;
}

/* ────────────────────────── feature validation ────────────────────────── */

export interface FeatureOutcome {
  feature: RequiredDiditFeature;
  label: string;
  /** Absent when the feature never ran — distinct from having run and failed. */
  status: DiditFeatureStatus | null;
  score: number | null;
  /** Provider-reported quality/anomaly notes. Categories only, never images. */
  warnings: string[];
  /** The feature produced a usable, decisive result. */
  executed: boolean;
}

interface DecisionLike {
  session_id?: unknown;
  status?: unknown;
  workflow_id?: unknown;
  vendor_data?: unknown;
  features?: unknown;
  environment?: unknown;
  [key: string]: unknown;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> =>
    Boolean(v) && typeof v === 'object' && !Array.isArray(v));
}

function normaliseFeatureStatus(value: unknown): DiditFeatureStatus | null {
  return value === 'Approved' || value === 'Declined'
    || value === 'In Review' || value === 'Not Finished'
    ? value : null;
}

function warningsOf(entry: Record<string, unknown>): string[] {
  const raw = entry['warnings'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w) => {
      if (typeof w === 'string') return w;
      if (w && typeof w === 'object') {
        const rec = w as Record<string, unknown>;
        // Keep the machine-readable category; drop free text that could quote
        // document contents back at us.
        const risk = rec['risk'] ?? rec['code'] ?? rec['log_type'];
        return typeof risk === 'string' ? risk : null;
      }
      return null;
    })
    .filter((w): w is string => Boolean(w))
    .slice(0, 20);
}

/**
 * Read one required feature's result off the decision.
 *
 * The array may be absent (`null` before the feature has ever run), empty, or
 * carry several entries when the customer retried inside the hosted flow. The
 * LAST decisive entry is the operative one; a trailing `Not Finished` retry
 * must not erase an `Approved` result, and an `Approved` first attempt must
 * not mask a later `Declined`. So: prefer the last entry that reached a
 * decisive status, and fall back to the last entry of any kind.
 */
export function readFeatureOutcome(
  decision: DecisionLike, feature: RequiredDiditFeature,
): FeatureOutcome {
  const declared = Array.isArray(decision.features)
    ? decision.features.map((f) => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object') return String((f as Record<string, unknown>)['feature'] ?? '');
      return '';
    })
    : [];
  const entries = asRecordArray(decision[FEATURE_RESULT_KEY[feature]]);

  const decisive = entries.filter((e) => {
    const s = normaliseFeatureStatus(e['status']);
    return s === 'Approved' || s === 'Declined' || s === 'In Review';
  });
  const operative = decisive.length > 0
    ? decisive[decisive.length - 1]
    : entries[entries.length - 1];

  if (!operative) {
    return {
      feature, label: FEATURE_LABEL[feature],
      status: null, score: null, warnings: [],
      // A feature the workflow never even declared is as unexecuted as one
      // that declared it and produced nothing.
      executed: false,
    };
  }

  const status = normaliseFeatureStatus(operative['status']);
  const rawScore = operative['score'];
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;

  return {
    feature,
    label: FEATURE_LABEL[feature],
    status,
    score,
    warnings: warningsOf(operative),
    // Declared by the workflow AND carrying a decisive status. Anything else —
    // missing, `Not Finished`, an unrecognised status string — is not evidence.
    executed: declared.includes(feature)
      && (status === 'Approved' || status === 'Declined' || status === 'In Review'),
  };
}

/* ──────────────────────────── decision mapping ──────────────────────────── */

/**
 * The provider-level result, in the vocabulary `canonicalOutcome()` already
 * speaks. Reusing `IdvResult["status"]` keeps Didit inside the existing
 * canonical pipeline rather than beside it.
 */
export type DiditProviderStatus = 'verified' | 'failed' | 'manual_review' | 'pending';

export interface DiditMappedDecision {
  status: DiditProviderStatus;
  /** Safe machine-readable category for staff diagnostics. Never customer copy. */
  reason: string;
  features: FeatureOutcome[];
  /** True only when all three required modules produced a decisive result. */
  requiredFeaturesComplete: boolean;
  /** Terminal for NPC purposes: an identity position was reached. */
  terminal: boolean;
}

export interface MapDecisionOptions {
  /** The workflow NPC configured. A session from any other workflow is refused. */
  expectedWorkflowId: string;
  expectedCaseId: string;
  expectedPartyId: string | null;
  /** The session NPC created and stored against the canonical row. */
  expectedSessionId: string;
  /**
   * The row's capture sequence, when known. Checked against the attempt in
   * `vendor_data` so a decision cannot be applied to a different attempt of
   * the same party. Absent for legacy sessions minted before attempt scoping.
   */
  expectedAttempt?: number | null;
}

export class DiditCorrelationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DiditCorrelationError';
  }
}

/**
 * Validate that a decision genuinely belongs to this check.
 *
 * Every one of these is a refusal rather than an outcome: a payload we cannot
 * tie to the row in front of us is an integration fault, and an integration
 * fault must never move a customer's identity state or spend their attempt.
 */
export function assertDecisionCorrelates(
  decision: DecisionLike, opts: MapDecisionOptions,
): void {
  if (String(decision.session_id ?? '') !== opts.expectedSessionId) {
    throw new DiditCorrelationError('session_mismatch',
      'decision session_id does not match the session recorded on this check');
  }
  if (String(decision.workflow_id ?? '') !== opts.expectedWorkflowId) {
    throw new DiditCorrelationError('workflow_mismatch',
      'decision belongs to a workflow other than the configured NPC workflow');
  }
  if (!vendorDataMatches(decision.vendor_data, opts.expectedCaseId, opts.expectedPartyId,
    opts.expectedAttempt)) {
    throw new DiditCorrelationError('vendor_data_mismatch',
      'decision vendor_data does not correlate to this case and party');
  }
}

/**
 * Map an authoritative Didit decision onto a provider-level identity result.
 *
 * The conservative direction is always the same one: towards a human.
 *
 *   Approved + all three modules decisive and Approved  → verified
 *   Declined by a module that actually ran               → failed
 *   In Review, or any required module missing/undecided  → manual_review
 *   Not yet finished / closed without a decision         → pending
 *
 * `pending` is the value `canonicalOutcome()` already treats as "the provider
 * looked but could not examine identity" — no status change, no attempt.
 */
export function mapDiditDecision(decision: DecisionLike): DiditMappedDecision {
  const sessionStatus = String(decision.status ?? '');
  const features = REQUIRED_DIDIT_FEATURES.map((f) => readFeatureOutcome(decision, f));
  const missing = features.filter((f) => !f.executed);
  const requiredFeaturesComplete = missing.length === 0;

  // Nothing to decide yet, or the session ended without the provider ever
  // taking a position. Neither is an identity finding and neither costs the
  // customer anything — they get a fresh session under the existing rules.
  if (isInFlightDiditStatus(sessionStatus)) {
    return {
      status: 'pending', reason: `session_${sessionStatus.toLowerCase().replace(/\s+/g, '_')}`,
      features, requiredFeaturesComplete, terminal: false,
    };
  }
  if (isClosedWithoutDecision(sessionStatus)) {
    return {
      status: 'pending', reason: `session_closed_without_decision:${sessionStatus.toLowerCase().replace(/\s+/g, '_')}`,
      features, requiredFeaturesComplete, terminal: false,
    };
  }

  // An unrecognised status is not a pass and not a failure. Didit may add to
  // this vocabulary; a word we have never seen goes to a human.
  if (!isTerminalDiditStatus(sessionStatus)) {
    return {
      status: 'manual_review', reason: `unrecognised_session_status:${sessionStatus || 'empty'}`,
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  // A module that ran and said no is a genuine identity failure, whatever the
  // session-level word is — the session status is a roll-up and we hold the
  // parts. Checked before the Approved path so an inconsistent payload
  // (Approved overall, a Declined module underneath) can never read as a pass.
  const declined = features.filter((f) => f.executed && f.status === 'Declined');
  if (declined.length > 0) {
    return {
      status: 'failed',
      reason: `required_feature_declined:${declined.map((f) => f.feature).join(',')}`,
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  // THE rule. An approval NPC cannot evidence is not an approval: if ID
  // verification, face match or passive liveness did not actually execute and
  // return a decisive result, the strongest honest outcome is a referral.
  if (!requiredFeaturesComplete) {
    return {
      status: 'manual_review',
      reason: `required_feature_missing:${missing.map((f) => f.feature).join(',')}`,
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  if (sessionStatus === 'In Review') {
    return {
      status: 'manual_review', reason: 'provider_referred_for_review',
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  if (sessionStatus === 'Declined') {
    return {
      status: 'failed', reason: 'provider_declined',
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  // Approved, all three modules executed. Any module short of Approved (an
  // `In Review` under an Approved roll-up) still goes to a human.
  const notApproved = features.filter((f) => f.status !== 'Approved');
  if (notApproved.length > 0) {
    return {
      status: 'manual_review',
      reason: `feature_not_approved:${notApproved.map((f) => f.feature).join(',')}`,
      features, requiredFeaturesComplete, terminal: true,
    };
  }

  return {
    status: 'verified', reason: 'approved_all_required_features',
    features, requiredFeaturesComplete, terminal: true,
  };
}

/* ───────────────────────────── sanitisation ───────────────────────────── */

/**
 * Fields on a Didit decision that carry the customer's biometrics or a
 * credential, and must never reach `outcome_detail`, the case timeline, a log
 * line or a staff response.
 *
 * `session_url` is on this list for a reason that is easy to miss: the hosted
 * URL embeds the session token (`https://verify.didit.me/session/<token>`), so
 * persisting it stores a live bearer credential for that customer's
 * verification session in the case record.
 *
 * The image fields are the other half. `stripImagePayloads()` catches base64
 * blobs and image-shaped keys, but Didit returns SIGNED URLS to the images
 * rather than the bytes — short strings under keys like `front_image`, which
 * that filter deliberately leaves alone. Fetching NPC's own copy of a
 * customer's ID photograph is exactly what this integration exists to avoid,
 * so the references are dropped at the boundary as well.
 */
const FORBIDDEN_DECISION_KEYS: ReadonlySet<string> = new Set([
  'session_url', 'session_token', 'url', 'token',
  'front_image', 'back_image', 'portrait_image', 'full_front_image', 'full_back_image',
  'reference_image', 'source_image', 'target_image', 'video_url', 'audio_url',
  'face_video', 'liveness_video', 'document_images', 'images',
]);

/**
 * The identity data Didit extracted from the document.
 *
 * NPC does not need a second copy of a customer's document number, MRZ or
 * address to record that their identity was verified — the questionnaire
 * already holds what the case needs, and the provider remains the system of
 * record for what it read off the document. Data minimisation is the point of
 * using a hosted provider at all.
 */
const FORBIDDEN_PII_KEYS: ReadonlySet<string> = new Set([
  'document_number', 'personal_number', 'mrz', 'parsed_address', 'address',
  'date_of_birth', 'place_of_birth', 'full_name', 'first_name', 'last_name',
  'nationality', 'gender', 'marital_status', 'phone', 'phone_number', 'email',
  'email_address', 'contact_details', 'extra_fields',
]);

export const DIDIT_REDACTED = '[redacted: not stored by NPC]';

/**
 * The staff-visible evidence summary for a Didit verification.
 *
 * Built by ALLOW-LIST rather than by removing known-bad keys. A deny-list over
 * a payload someone else versions is a standing invitation to persist a field
 * that did not exist when the list was written — and the fields at risk here
 * are a customer's face and a live session credential.
 */
export interface DiditEvidenceSummary {
  provider: 'didit';
  session_id: string;
  workflow_id: string | null;
  workflow_version: number | null;
  session_status: string;
  environment: string | null;
  mapped_status: DiditProviderStatus;
  reason: string;
  required_features_complete: boolean;
  features: Array<{
    feature: string; label: string; status: string | null;
    score: number | null; warnings: string[]; executed: boolean;
  }>;
  created_at: string | null;
  completed_at: string | null;
}

export function summariseDiditDecision(
  decision: DecisionLike, mapped: DiditMappedDecision,
): DiditEvidenceSummary {
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null =>
    (typeof v === 'number' && Number.isFinite(v) ? v : null);

  return {
    provider: 'didit',
    session_id: String(decision.session_id ?? ''),
    workflow_id: str(decision.workflow_id),
    workflow_version: num(decision['workflow_version']),
    session_status: String(decision.status ?? ''),
    environment: str(decision.environment),
    mapped_status: mapped.status,
    reason: mapped.reason,
    required_features_complete: mapped.requiredFeaturesComplete,
    features: mapped.features.map((f) => ({
      feature: f.feature, label: f.label, status: f.status,
      score: f.score, warnings: f.warnings, executed: f.executed,
    })),
    created_at: str(decision['created_at']),
    completed_at: str(decision['completed_at']),
  };
}

/**
 * Belt-and-braces scrub for any Didit-shaped object that is about to be
 * persisted or logged by a path that did not go through `summariseDiditDecision`.
 *
 * The allow-listed summary is the intended route; this exists so that a future
 * caller which passes provider data straight through cannot leak an image
 * reference or a session URL by omission.
 */
export function scrubDiditPayload<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubDiditPayload(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_DECISION_KEYS.has(lower) || FORBIDDEN_PII_KEYS.has(lower)) {
      out[key] = DIDIT_REDACTED;
      continue;
    }
    out[key] = scrubDiditPayload(item, depth + 1);
  }
  return out as unknown as T;
}

/** Exposed so tests can assert the two lists rather than re-declare them. */
export const DIDIT_FORBIDDEN_KEYS = {
  credentialsAndBiometrics: [...FORBIDDEN_DECISION_KEYS],
  personalData: [...FORBIDDEN_PII_KEYS],
};

/* ─────────────── A session this deployment did not create ────────────────
 *
 * One Didit **application** carries one set of webhook destinations, and those
 * destinations FAN OUT: every enabled destination receives every event for the
 * application. There is no per-session routing. So when several deployments
 * share one application — as the prime and its clones do under the fleet-wide
 * key decision — each deployment's verifications emit `status.updated`, and
 * every one of them is delivered to whichever destinations the application
 * has.
 *
 * The receiver therefore has to answer a question it never used to face: is
 * this event mine at all? Until now everything that failed to correlate landed
 * in `unknown_session` — a reading that meant "something unexpected arrived".
 * Under a shared application, a sibling deployment's routine verification
 * produces exactly that, so the alarm fires on the ordinary case and stops
 * meaning anything.
 *
 * `vendor_data` is what separates them. Every deployment mints the same shape
 * (`npc:<caseId>:<partyId|primary>[:attempt]`) over ITS OWN case ids, so an
 * event whose vendor_data parses and names a case this deployment does not
 * hold is a sibling's — routine, expected, and nothing to act on. An event
 * whose vendor_data is absent or is not our shape is genuinely unrecognised
 * and keeps the louder name.
 *
 * ## What this is NOT
 *
 * It is not authorisation and it cannot settle anything. Both readings end the
 * same way — acknowledged, identifiers recorded, nothing applied — so a
 * misclassification costs a log label and never a customer's outcome. That is
 * deliberate: `vendor_data` is provider-supplied and attacker-influenced in
 * principle, and the moment a classification derived from it could decide an
 * outcome it would be a door onto another tenant's case.
 */
export type ForeignSessionReading =
  /** Our vendor_data shape over a case id this deployment does not hold. */
  | 'sibling_deployment'
  /** No usable vendor_data, or not a shape this platform mints. */
  | 'unrecognised';

/**
 * Read an uncorrelated event, given whether this deployment holds the case its
 * `vendor_data` names.
 *
 * `caseHeldLocally` is passed rather than looked up so the rule stays pure and
 * the caller owns the one database read. `null` means the caller could not
 * establish it — which reads as `unrecognised`, because a failed read must
 * never be reported as a confident "this belongs to somebody else".
 */
export function readForeignSession(
  vendorData: unknown,
  caseHeldLocally: boolean | null,
): ForeignSessionReading {
  const parsed = parseVendorData(vendorData);
  if (!parsed) return 'unrecognised';
  return caseHeldLocally === false ? 'sibling_deployment' : 'unrecognised';
}

/** The case id an uncorrelated event names, or null if it names none we mint. */
export function caseIdFromVendorData(vendorData: unknown): string | null {
  return parseVendorData(vendorData)?.caseId ?? null;
}
