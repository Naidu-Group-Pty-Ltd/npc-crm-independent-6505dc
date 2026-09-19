/**
 * Partner compliance events — the pure domain layer (Phase 6).
 *
 * The database owns atomic event creation (domain triggers →
 * aml.enqueue_partner_event → public.integration_outbox) and the worker owns
 * transport. THIS module owns every decision either of them makes:
 *
 *  - the closed event catalogue (must mirror aml.partner_event_catalogue —
 *    a contract test cross-checks the migration text);
 *  - the closed safe-reason-code catalogue and the fixed partner-facing
 *    notification copy (tripwire-scanned; no internal vocabulary can ship);
 *  - the material-change evaluator, built on the Phase 3 material-input
 *    hash: material inputs are compared group by group, presentation-only
 *    differences cannot register;
 *  - the consumer's delivery decision: given an event and the CURRENT
 *    authoritative state, notify / suppress-as-stale / ops-only. The
 *    consumer never writes authoritative state, so a duplicate, replayed
 *    or out-of-order event structurally cannot reopen revoked access or
 *    restore superseded content — this function only decides whether a
 *    notification row is still truthful.
 *
 * Pure module: no Deno APIs beyond Web Crypto, no database access —
 * behaviourally testable from vitest.
 */

import {
  canonicalJson,
  findRestrictedKeys,
  materialInputHash,
  type MaterialInputs,
} from "./attestationV2.ts";

/* ── the closed event catalogue (mirror of aml.partner_event_catalogue) ── */

export type PartnerEventDestination = "ops" | "partner" | "both";

export const PARTNER_EVENT_CATALOGUE: Record<string, {
  aggregate: string;
  destination: PartnerEventDestination;
  emittedBy: "trigger" | "worker_sweep" | "phase7";
}> = {
  "aml.partner_case_link.created": { aggregate: "partner_case_link", destination: "both", emittedBy: "trigger" },
  "aml.partner_case_link.suspended": { aggregate: "partner_case_link", destination: "both", emittedBy: "trigger" },
  "aml.partner_case_link.ended": { aggregate: "partner_case_link", destination: "both", emittedBy: "trigger" },
  "aml.attestation.issued": { aggregate: "compliance_attestation", destination: "both", emittedBy: "trigger" },
  "aml.attestation.superseded": { aggregate: "compliance_attestation", destination: "both", emittedBy: "trigger" },
  "aml.attestation.refresh_required": { aggregate: "compliance_attestation", destination: "both", emittedBy: "trigger" },
  "aml.partner_access.created": { aggregate: "reliance_grant", destination: "both", emittedBy: "trigger" },
  "aml.partner_access.revoked": { aggregate: "reliance_grant", destination: "both", emittedBy: "trigger" },
  "aml.partner_access.expired": { aggregate: "reliance_grant", destination: "both", emittedBy: "worker_sweep" },
  "aml.records_request.submitted": { aggregate: "partner_records_request", destination: "ops", emittedBy: "trigger" },
  "aml.records_request.reviewed": { aggregate: "partner_records_request", destination: "both", emittedBy: "trigger" },
  "aml.evidence_delivery.created": { aggregate: "partner_evidence_delivery", destination: "both", emittedBy: "trigger" },
  "aml.evidence_delivery.revoked": { aggregate: "partner_evidence_delivery", destination: "both", emittedBy: "trigger" },
  "aml.partner_determination.recorded": { aggregate: "independent_assessment", destination: "ops", emittedBy: "trigger" },
  "aml.partner_determination.refresh_required": { aggregate: "independent_assessment", destination: "both", emittedBy: "trigger" },
  "aml.arrangement.review_due": { aggregate: "reliance_agreement", destination: "ops", emittedBy: "worker_sweep" },
  "aml.arrangement.overdue": { aggregate: "reliance_agreement", destination: "ops", emittedBy: "worker_sweep" },
  "aml.retention_trigger.recorded": { aggregate: "retention_trigger", destination: "ops", emittedBy: "trigger" },
  "aml.legal_hold.added": { aggregate: "legal_hold", destination: "ops", emittedBy: "trigger" },
  "aml.legal_hold.released": { aggregate: "legal_hold", destination: "ops", emittedBy: "trigger" },
  // Emitters arrived with Phase 7 (AFTER UPDATE on aml.retention_scans).
  "aml.disposal.approved": { aggregate: "retention_scan", destination: "ops", emittedBy: "trigger" },
  "aml.disposal.executed": { aggregate: "retention_scan", destination: "ops", emittedBy: "trigger" },
  "aml.disposal.failed": { aggregate: "retention_scan", destination: "ops", emittedBy: "trigger" },
};

export const PARTNER_EVENT_TYPES = Object.keys(PARTNER_EVENT_CATALOGUE);

/* ── safe reason codes (mirror of the SQL CHECK constraints) ───────────── */

export const SAFE_REFRESH_REASON_CODES: Record<string, { label: string }> = {
  information_updated: { label: "Information relevant to this matter was updated" },
  attestation_updated: { label: "The attestation was updated" },
  periodic_refresh_due: { label: "A periodic refresh is due" },
  access_update_required: { label: "Access needs to be re-established" },
  arrangement_updated: { label: "The arrangement between the organisations changed" },
};

/* ── fixed partner-facing notification copy ─────────────────────────────
 * The ONLY wording a partner notification can carry. No event payload text
 * ever reaches a notification body — copy is looked up by event type, so
 * internal reasoning, hold reasons or screening vocabulary cannot travel
 * even by accident. Ops-only events have NO entry here at all. */

export const PARTNER_EVENT_COPY: Record<string, { title: string; body: string }> = {
  "aml.partner_case_link.created": {
    title: "New matter link",
    body: "Your organisation has been linked to a matter. Open your compliance workspace to review it.",
  },
  "aml.partner_case_link.suspended": {
    title: "Matter link suspended",
    body: "A matter link for your organisation has been suspended. Contact the issuing organisation if you require more information.",
  },
  "aml.partner_case_link.ended": {
    title: "Matter link ended",
    body: "A matter link for your organisation has ended.",
  },
  "aml.attestation.issued": {
    title: "Compliance information available",
    body: "The issuing organisation has published a compliance attestation for a matter you are linked to. Open your compliance workspace to review it.",
  },
  "aml.attestation.superseded": {
    title: "Attestation updated",
    body: "A previous attestation version is no longer current. Review the workspace and re-record your organisation's determination if required.",
  },
  "aml.attestation.refresh_required": {
    title: "Review required",
    body: "Information relevant to a matter you are linked to has been updated. Review the refreshed information and re-record your organisation's determination.",
  },
  "aml.partner_access.created": {
    title: "Access granted",
    body: "Your organisation has been granted access to shared compliance information for a matter. Open your compliance workspace to review it.",
  },
  "aml.partner_access.revoked": {
    title: "Access update",
    body: "Access to shared compliance information for one of your matters has been withdrawn. Contact the issuing organisation if you require more information.",
  },
  "aml.partner_access.expired": {
    title: "Access expired",
    body: "Access to shared compliance information for one of your matters has expired. Ask the issuing organisation to re-issue access if it is still required.",
  },
  "aml.records_request.reviewed": {
    title: "Records request update",
    body: "Your records request has been reviewed. Open your compliance workspace to see the outcome.",
  },
  "aml.evidence_delivery.created": {
    title: "Records delivered",
    body: "A requested record has been made available to your organisation. Open your compliance workspace to review it.",
  },
  "aml.evidence_delivery.revoked": {
    title: "Delivered record withdrawn",
    body: "A record previously delivered to your organisation is no longer available.",
  },
  "aml.partner_determination.refresh_required": {
    title: "Determination refresh required",
    body: "The information your organisation's determination was based on has been refreshed. Review it and re-record your determination.",
  },
};

/* ── material-change evaluation (§6.5) ──────────────────────────────────
 * Built on the Phase 3 material-input hash: the evaluator only ever sees
 * MaterialInputs, so presentation-only payload fields (issuer label,
 * section counters) cannot register as change by construction. */

export const MATERIAL_FIELD_GROUPS: Record<string, (i: MaterialInputs) => unknown> = {
  subject_identity: (i) => ({ subject: i.subject, subject_type: i.subject_type }),
  verified_parties: (i) => i.parties,
  consents: (i) => i.consents_held,
  screening_procedure: (i) => i.screening,
  service_gate_decision: (i) => i.service_gate_decision_id,
  limitations: (i) => i.limitations,
  questionnaire: (i) => i.questionnaire_version,
};

export interface MaterialChangeEvaluation {
  material: boolean;
  changed_groups: string[];
  previous_hash: string;
  next_hash: string;
  safe_reason_code: keyof typeof SAFE_REFRESH_REASON_CODES;
}

/** Reconstruct the material inputs of a stored v2 attestation from its own
 * payload plus the recorded gate-decision id. The v2 payload stores exactly
 * the sections the hash was built from, so reconstruction is lossless. */
export function materialInputsFromV2Payload(
  payload: Record<string, unknown>,
  serviceGateDecisionId: string | null,
): MaterialInputs {
  const ci = (payload.customer_identification ?? {}) as Record<string, unknown>;
  const screening = (payload.screening ?? {}) as Record<string, unknown>;
  return {
    subject: (payload.subject as string | null) ?? null,
    subject_type: (payload.subject_type as string | null) ?? null,
    parties: Array.isArray(ci.parties) ? ci.parties : [],
    consents_held: Array.isArray(ci.consents_held) ? ci.consents_held : [],
    screening: {
      performed: Boolean(screening.performed),
      last_performed_at: (screening.last_performed_at as string | null) ?? null,
      scope: screening.scope ?? null,
      list_freshness: (screening.list_freshness as Record<string, string>) ?? {},
    },
    service_gate_decision_id: serviceGateDecisionId,
    limitations: Array.isArray(payload.limitations) ? payload.limitations.map(String) : [],
    questionnaire_version: (ci.questionnaire_version as string | null) ?? null,
  };
}

/** Compare two material-input snapshots group by group. Material iff any
 * group's canonical form differs — which is exactly when materialInputHash
 * differs, but with the changed groups named for the audit trail. */
export async function evaluateMaterialChange(
  previous: MaterialInputs,
  next: MaterialInputs,
): Promise<MaterialChangeEvaluation> {
  const changed: string[] = [];
  for (const [group, pick] of Object.entries(MATERIAL_FIELD_GROUPS)) {
    if (canonicalJson(pick(previous)) !== canonicalJson(pick(next))) changed.push(group);
  }
  const [previousHash, nextHash] = await Promise.all([
    materialInputHash(previous), materialInputHash(next),
  ]);
  return {
    material: changed.length > 0,
    changed_groups: changed,
    previous_hash: previousHash,
    next_hash: nextHash,
    safe_reason_code: "information_updated",
  };
}

/* ── the consumer's delivery decision ───────────────────────────────────
 * The worker fetches the CURRENT authoritative row for the event's
 * aggregate and asks this function whether a partner notification is still
 * truthful. Terminal-ward transitions (revoked / superseded / ended /
 * refresh) always notify — they can only under-claim. Creation events are
 * suppressed when the aggregate has since moved past them, so a delayed
 * "access created" after revocation says nothing. */

export type PartnerEventDeliveryDecision = "notify" | "suppress_stale" | "ops_only";

export function partnerEventDeliveryDecision(
  eventType: string,
  current: {
    grant?: { revoked_at: string | null; expires_at: string } | null;
    attestation?: { superseded_at: string | null; refresh_required_at?: string | null } | null;
    link?: { state: string } | null;
  },
  now: Date,
): PartnerEventDeliveryDecision {
  const entry = PARTNER_EVENT_CATALOGUE[eventType];
  if (!entry || entry.destination === "ops") return "ops_only";
  if (!PARTNER_EVENT_COPY[eventType]) return "ops_only";

  switch (eventType) {
    case "aml.partner_access.created": {
      const g = current.grant;
      if (!g) return "suppress_stale";
      if (g.revoked_at) return "suppress_stale";
      if (new Date(g.expires_at).getTime() <= now.getTime()) return "suppress_stale";
      return "notify";
    }
    case "aml.partner_access.expired": {
      const g = current.grant;
      // Revocation outranks expiry — the revocation notification carries it.
      if (!g || g.revoked_at) return "suppress_stale";
      return "notify";
    }
    case "aml.attestation.issued": {
      const a = current.attestation;
      if (!a) return "suppress_stale";
      if (a.superseded_at) return "suppress_stale";
      return "notify";
    }
    case "aml.partner_case_link.created": {
      const l = current.link;
      if (!l || l.state !== "active") return "suppress_stale";
      return "notify";
    }
    default:
      return "notify";
  }
}

/** Build the notification row content for a partner-visible event. Fixed
 * copy only; the finished object is tripwire-scanned. Throws on an event
 * type with no copy — a coding error must fail loudly, not disclose. */
export function buildPartnerNotification(
  eventType: string,
  safeReasonCode: string | null,
): { event_type: string; title: string; body: string; safe_reason_code: string | null } {
  const copy = PARTNER_EVENT_COPY[eventType];
  if (!copy) throw new Error(`no partner-facing copy for event type ${eventType}`);
  const reason = safeReasonCode && SAFE_REFRESH_REASON_CODES[safeReasonCode]
    ? safeReasonCode
    : null;
  const notification = {
    event_type: eventType,
    title: copy.title,
    body: copy.body,
    safe_reason_code: reason,
  };
  const violations = findRestrictedKeys(notification);
  if (violations.length > 0) {
    throw new Error(`restricted keys in partner notification: ${violations.join(", ")}`);
  }
  return notification;
}
