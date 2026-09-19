import { describe, expect, it } from "vitest";
import {
  MATERIAL_FIELD_GROUPS,
  PARTNER_EVENT_CATALOGUE,
  PARTNER_EVENT_COPY,
  PARTNER_EVENT_TYPES,
  SAFE_REFRESH_REASON_CODES,
  buildPartnerNotification,
  evaluateMaterialChange,
  materialInputsFromV2Payload,
  partnerEventDeliveryDecision,
} from "../../../supabase/functions/_shared/aml/partnerEvents";
import {
  findRestrictedKeys,
  materialInputHash,
  type MaterialInputs,
} from "../../../supabase/functions/_shared/aml/attestationV2";

/**
 * Behavioural tests for the Phase 6 partner-events domain: the closed event
 * catalogue, partner-safe copy, material-change evaluation and the
 * consumer's stale-event decision. All fixtures are synthetic.
 */

const NOW = new Date("2026-08-05T10:00:00Z");
const PAST = "2026-08-01T00:00:00Z";
const FUTURE = "2026-12-01T00:00:00Z";

const baseInputs = (): MaterialInputs => ({
  subject: "Synthetic Person",
  subject_type: "individual",
  parties: [
    { party: "Synthetic Person", verified: true, method: "electronic_idv", completed_at: PAST, document_type: null },
  ],
  consents_held: [{ code: "compliance_sharing", version: "2026.2", accepted_at: PAST }],
  screening: {
    performed: true,
    last_performed_at: PAST,
    scope: "sanctions_pep",
    list_freshness: { dfat: PAST },
  },
  service_gate_decision_id: "11111111-1111-1111-1111-111111111111",
  limitations: ["documents_not_verified_against_issuing_authority"],
  questionnaire_version: "3",
});

/* ── the catalogue is closed and complete ──────────────────────────────── */

describe("event catalogue", () => {
  it("carries every event family the specification requires", () => {
    const required = [
      "aml.partner_case_link.created", "aml.partner_case_link.suspended", "aml.partner_case_link.ended",
      "aml.attestation.issued", "aml.attestation.superseded", "aml.attestation.refresh_required",
      "aml.partner_access.created", "aml.partner_access.revoked", "aml.partner_access.expired",
      "aml.records_request.submitted", "aml.records_request.reviewed",
      "aml.evidence_delivery.created", "aml.evidence_delivery.revoked",
      "aml.partner_determination.recorded", "aml.partner_determination.refresh_required",
      "aml.arrangement.review_due", "aml.arrangement.overdue",
      "aml.retention_trigger.recorded",
      "aml.legal_hold.added", "aml.legal_hold.released",
      "aml.disposal.approved", "aml.disposal.executed", "aml.disposal.failed",
    ];
    for (const type of required) {
      expect(PARTNER_EVENT_CATALOGUE[type], type).toBeTruthy();
    }
    expect(PARTNER_EVENT_TYPES.length).toBe(required.length);
  });

  it("investigation, hold, retention and disposal events are ops-only — a partner never hears about them", () => {
    for (const type of [
      "aml.legal_hold.added", "aml.legal_hold.released",
      "aml.retention_trigger.recorded",
      "aml.disposal.approved", "aml.disposal.executed", "aml.disposal.failed",
      "aml.arrangement.review_due", "aml.arrangement.overdue",
    ]) {
      expect(PARTNER_EVENT_CATALOGUE[type].destination).toBe("ops");
      expect(PARTNER_EVENT_COPY[type]).toBeUndefined();
    }
  });

  it("every partner-visible event has fixed copy; no ops-only event has any", () => {
    for (const [type, entry] of Object.entries(PARTNER_EVENT_CATALOGUE)) {
      if (entry.destination === "ops") {
        expect(PARTNER_EVENT_COPY[type], type).toBeUndefined();
      } else {
        expect(PARTNER_EVENT_COPY[type], type).toBeTruthy();
      }
    }
  });
});

/* ── partner-safe wording ──────────────────────────────────────────────── */

describe("partner-safe copy", () => {
  const FORBIDDEN =
    /\b(risk|score|match|matches|screening|sanction|sanctions|pep|adverse|suspicious|austrac|edd\b|mlro|analyst|reviewer|investigat\w*|hold|incident|discrepan\w*)\b/i;

  it("no notification title or body carries internal vocabulary", () => {
    for (const [type, copy] of Object.entries(PARTNER_EVENT_COPY)) {
      expect(copy.title, type).not.toMatch(FORBIDDEN);
      expect(copy.body, type).not.toMatch(FORBIDDEN);
    }
  });

  it("no safe reason label carries internal vocabulary", () => {
    for (const [code, { label }] of Object.entries(SAFE_REFRESH_REASON_CODES)) {
      expect(label, code).not.toMatch(FORBIDDEN);
    }
  });

  it("buildPartnerNotification returns fixed copy and survives the tripwire", () => {
    const n = buildPartnerNotification("aml.attestation.refresh_required", "information_updated");
    expect(n.title).toBe(PARTNER_EVENT_COPY["aml.attestation.refresh_required"].title);
    expect(n.safe_reason_code).toBe("information_updated");
    expect(findRestrictedKeys(n)).toEqual([]);
  });

  it("an unknown reason code is dropped, never forwarded", () => {
    const n = buildPartnerNotification("aml.partner_access.revoked", "screening_hit_review");
    expect(n.safe_reason_code).toBeNull();
  });

  it("throws for an ops-only event — internal events cannot become notifications by accident", () => {
    expect(() => buildPartnerNotification("aml.legal_hold.added", null)).toThrow();
    expect(() => buildPartnerNotification("aml.records_request.submitted", null)).toThrow();
  });
});

/* ── material-change evaluation ────────────────────────────────────────── */

describe("material-change evaluation", () => {
  it("identical inputs are never material and hashes agree with the Phase 3 hash", async () => {
    const prev = baseInputs();
    const next = baseInputs();
    const result = await evaluateMaterialChange(prev, next);
    expect(result.material).toBe(false);
    expect(result.changed_groups).toEqual([]);
    expect(result.previous_hash).toBe(result.next_hash);
    expect(result.previous_hash).toBe(await materialInputHash(prev));
  });

  it("an identity change is material and names the group", async () => {
    const next = { ...baseInputs(), subject: "Different Person" };
    const result = await evaluateMaterialChange(baseInputs(), next);
    expect(result.material).toBe(true);
    expect(result.changed_groups).toContain("subject_identity");
    expect(result.previous_hash).not.toBe(result.next_hash);
  });

  it("screening freshness and gate-decision changes register in their own groups", async () => {
    const screening = {
      ...baseInputs(),
      screening: { ...baseInputs().screening, last_performed_at: "2026-08-04T00:00:00Z" },
    };
    const gate = { ...baseInputs(), service_gate_decision_id: "22222222-2222-2222-2222-222222222222" };
    expect((await evaluateMaterialChange(baseInputs(), screening)).changed_groups)
      .toEqual(["screening_procedure"]);
    expect((await evaluateMaterialChange(baseInputs(), gate)).changed_groups)
      .toEqual(["service_gate_decision"]);
  });

  it("every material group is covered by a picker", () => {
    expect(Object.keys(MATERIAL_FIELD_GROUPS).sort()).toEqual([
      "consents", "limitations", "questionnaire", "screening_procedure",
      "service_gate_decision", "subject_identity", "verified_parties",
    ]);
  });

  it("presentation-only payload differences cannot register as change", async () => {
    const payload = (issuer: string, counters: number) => ({
      schema: "aml.compliance_attestation.v2",
      issuer,
      case_reference: `REF-${counters}`,
      subject: "Synthetic Person",
      subject_type: "individual",
      customer_identification: {
        parties: baseInputs().parties,
        consents_held: baseInputs().consents_held,
        questionnaire_version: "3",
        sections_submitted: counters,
      },
      screening: baseInputs().screening,
      service_readiness: true,
      limitations: baseInputs().limitations,
      reliance_basis: "Pt 2 Div 7",
    });
    const prev = materialInputsFromV2Payload(payload("Issuer A", 4), "gate-1");
    const next = materialInputsFromV2Payload(payload("Issuer B — renamed", 9), "gate-1");
    const result = await evaluateMaterialChange(prev, next);
    expect(result.material).toBe(false);
  });

  it("reconstruction from a stored v2 payload reproduces the original material hash", async () => {
    const inputs = baseInputs();
    const v2Payload = {
      schema: "aml.compliance_attestation.v2",
      issuer: "NPC Services command centre",
      case_reference: "REF-1",
      subject: inputs.subject,
      subject_type: inputs.subject_type,
      customer_identification: {
        parties: inputs.parties,
        consents_held: inputs.consents_held,
        questionnaire_version: inputs.questionnaire_version,
        sections_submitted: 5,
      },
      screening: inputs.screening,
      service_readiness: true,
      limitations: inputs.limitations,
      reliance_basis: "Pt 2 Div 7",
    };
    const reconstructed = materialInputsFromV2Payload(v2Payload, inputs.service_gate_decision_id);
    expect(await materialInputHash(reconstructed)).toBe(await materialInputHash(inputs));
  });
});

/* ── the consumer's delivery decision (ordering + replay safety) ───────── */

describe("delivery decision", () => {
  it("a delayed access-created event after revocation says nothing — revoked stays revoked", () => {
    expect(partnerEventDeliveryDecision(
      "aml.partner_access.created",
      { grant: { revoked_at: PAST, expires_at: FUTURE } }, NOW,
    )).toBe("suppress_stale");
  });

  it("an access-created event for an already-expired grant is suppressed", () => {
    expect(partnerEventDeliveryDecision(
      "aml.partner_access.created",
      { grant: { revoked_at: null, expires_at: PAST } }, NOW,
    )).toBe("suppress_stale");
  });

  it("a live grant's access-created event notifies", () => {
    expect(partnerEventDeliveryDecision(
      "aml.partner_access.created",
      { grant: { revoked_at: null, expires_at: FUTURE } }, NOW,
    )).toBe("notify");
  });

  it("an expiry event for a revoked grant defers to the revocation", () => {
    expect(partnerEventDeliveryDecision(
      "aml.partner_access.expired",
      { grant: { revoked_at: PAST, expires_at: PAST } }, NOW,
    )).toBe("suppress_stale");
  });

  it("supersede processed before the old issuance notification is safe — issued suppressed once superseded", () => {
    expect(partnerEventDeliveryDecision(
      "aml.attestation.issued",
      { attestation: { superseded_at: PAST } }, NOW,
    )).toBe("suppress_stale");
    expect(partnerEventDeliveryDecision(
      "aml.attestation.superseded",
      { attestation: { superseded_at: PAST } }, NOW,
    )).toBe("notify");
  });

  it("a link-created event for a no-longer-active link is suppressed", () => {
    expect(partnerEventDeliveryDecision(
      "aml.partner_case_link.created", { link: { state: "ended" } }, NOW,
    )).toBe("suppress_stale");
    expect(partnerEventDeliveryDecision(
      "aml.partner_case_link.created", { link: { state: "active" } }, NOW,
    )).toBe("notify");
  });

  it("a missing aggregate suppresses rather than notifies", () => {
    expect(partnerEventDeliveryDecision("aml.partner_access.created", {}, NOW)).toBe("suppress_stale");
    expect(partnerEventDeliveryDecision("aml.attestation.issued", {}, NOW)).toBe("suppress_stale");
  });

  it("ops-only and unknown events never notify a partner", () => {
    expect(partnerEventDeliveryDecision("aml.legal_hold.added", {}, NOW)).toBe("ops_only");
    expect(partnerEventDeliveryDecision("aml.retention_trigger.recorded", {}, NOW)).toBe("ops_only");
    expect(partnerEventDeliveryDecision("aml.disposal.failed", {}, NOW)).toBe("ops_only");
    expect(partnerEventDeliveryDecision("aml.something.invented", {}, NOW)).toBe("ops_only");
  });
});
