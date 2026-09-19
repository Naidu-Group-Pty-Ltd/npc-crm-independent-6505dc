import { describe, expect, it } from "vitest";
import {
  REQUESTABLE_RECORD_CLASSES,
  RESPONSIBILITY_NOTICE,
  buildPartnerWorkspaceDto,
  deriveAttestationState,
  evaluateRecordsRequestScope,
  validatePartnerDetermination,
} from "../../../supabase/functions/_shared/aml/partnerWorkspace";
import { findRestrictedKeys } from "../../../supabase/functions/_shared/aml/attestationV2";

/** Behavioural tests for the partner workspace domain (Phase 4).
 * Synthetic identifiers only. */

const NOW = new Date("2026-08-05T00:00:00Z");

const baseLink = {
  id: "link-0001", relationship_role: "lender", legal_route: "reliance",
  state: "active", portal_type: "finance", linked_at: "2026-08-01T00:00:00Z",
  purchase_file_id: "pf-0001", legal_matter_id: null,
};

const dtoInput = (over: Partial<Parameters<typeof buildPartnerWorkspaceDto>[0]> = {}) => ({
  partnerOrg: { legal_name: "Synthetic Finance Pty Ltd", classification_status: "classified" },
  originLabel: "AML/CTF Command Centre",
  link: { ...baseLink },
  attestation: {
    schema_version: 2, version: 3, payload_sha256: "hash-current",
    issued_at: "2026-08-02T00:00:00Z", superseded_at: null,
  },
  grant: { revoked_at: null, expires_at: "2026-11-01T00:00:00Z" },
  procedures: { schema: "aml.compliance_attestation.v2", customer_identification: { parties: [] } },
  limitations: ["documents_not_verified_against_issuing_authority"],
  recordAvailability: ["identity_verification_record"],
  determinations: [],
  requests: [],
  deliveries: [],
  now: NOW,
  ...over,
});

describe("controlled record classes", () => {
  it("unknown codes are prohibited — a partner cannot invent vocabulary", () => {
    const out = evaluateRecordsRequestScope(
      ["identity_verification_record", "aml.cases", "storage/objects", "risk_assessment"],
      ["identity_verification_record"],
    );
    expect(out[0]).toMatchObject({ code: "identity_verification_record", scope: "within_scope" });
    for (const e of out.slice(1)) expect(e.scope).toBe("prohibited");
  });

  it("known codes outside the arrangement scope require origin review — never auto-approval", () => {
    const out = evaluateRecordsRequestScope(["source_of_funds_declaration"], ["consent_evidence"]);
    expect(out[0].scope).toBe("requires_origin_review");
    const noScope = evaluateRecordsRequestScope(["consent_evidence"], null);
    expect(noScope[0].scope).toBe("requires_origin_review");
  });

  it("the catalogue contains no investigation, reporting or biometric family", () => {
    const codes = Object.keys(REQUESTABLE_RECORD_CLASSES).join(" ");
    expect(codes).not.toMatch(/risk|match|smr|report|biometric|edd|investigation|reviewer/i);
  });
});

describe("attestation lifecycle state", () => {
  const att = { superseded_at: null as string | null };
  const grant = { revoked_at: null as string | null, expires_at: "2026-11-01T00:00:00Z" };

  it("derives every state deny-first", () => {
    expect(deriveAttestationState({ attestation: null, grant: null, determinationHash: null, attestationHash: null, now: NOW })).toBe("unavailable");
    expect(deriveAttestationState({ attestation: att, grant: { ...grant, revoked_at: "2026-08-03T00:00:00Z" }, determinationHash: null, attestationHash: "h", now: NOW })).toBe("revoked");
    expect(deriveAttestationState({ attestation: att, grant: { ...grant, expires_at: "2026-08-01T00:00:00Z" }, determinationHash: null, attestationHash: "h", now: NOW })).toBe("expired");
    expect(deriveAttestationState({ attestation: { superseded_at: "2026-08-04T00:00:00Z" }, grant, determinationHash: null, attestationHash: "h", now: NOW })).toBe("superseded");
    expect(deriveAttestationState({ attestation: att, grant, determinationHash: "old-hash", attestationHash: "new-hash", now: NOW })).toBe("refresh_required");
    expect(deriveAttestationState({ attestation: att, grant, determinationHash: "h", attestationHash: "h", now: NOW })).toBe("current");
  });
});

describe("partner determination rules", () => {
  const valid = {
    outcome: "satisfied", decisionBasis: "Reviewed the attested procedures in detail.",
    responsibilityAcknowledged: true, complianceRole: "compliance_officer",
    attestationSha256: "hash-current",
  };

  it("accepts a complete compliance-officer determination", () => {
    expect(validatePartnerDetermination(valid)).toEqual({ ok: true });
  });

  it("an operational role cannot make the final compliance decision", () => {
    for (const role of ["operations", "read_only", null]) {
      expect(validatePartnerDetermination({ ...valid, complianceRole: role }))
        .toMatchObject({ ok: false, code: "compliance_role_required" });
    }
  });

  it("requires the responsibility acknowledgement and a recorded basis", () => {
    expect(validatePartnerDetermination({ ...valid, responsibilityAcknowledged: false }))
      .toMatchObject({ ok: false, code: "responsibility_acknowledgement_required" });
    expect(validatePartnerDetermination({ ...valid, decisionBasis: "too short" }))
      .toMatchObject({ ok: false, code: "decision_basis_required" });
  });

  it("attestation-responsive outcomes must pin the hash; independent_cdd_required need not", () => {
    expect(validatePartnerDetermination({ ...valid, attestationSha256: null }))
      .toMatchObject({ ok: false, code: "attestation_hash_required" });
    expect(validatePartnerDetermination({
      ...valid, outcome: "independent_cdd_required", attestationSha256: null,
    })).toEqual({ ok: true });
  });

  it("rejects outcomes outside the controlled set", () => {
    expect(validatePartnerDetermination({ ...valid, outcome: "approved" }))
      .toMatchObject({ ok: false, code: "invalid_outcome" });
  });
});

describe("the closed workspace DTO", () => {
  it("builds a clean DTO carrying the fixed responsibility notice", () => {
    const dto = buildPartnerWorkspaceDto(dtoInput());
    expect(dto.responsibility_notice).toBe(RESPONSIBILITY_NOTICE);
    expect(dto.attestation_state).toBe("current");
    expect(dto.procedures).not.toBeNull();
    expect(findRestrictedKeys(dto)).toEqual([]);
  });

  it("withholds procedure content the moment the state is not current", () => {
    const superseded = buildPartnerWorkspaceDto(dtoInput({
      attestation: {
        schema_version: 2, version: 3, payload_sha256: "hash-current",
        issued_at: "2026-08-02T00:00:00Z", superseded_at: "2026-08-04T00:00:00Z",
      },
    }));
    expect(superseded.attestation_state).toBe("superseded");
    expect(superseded.procedures).toBeNull();
    const revoked = buildPartnerWorkspaceDto(dtoInput({
      grant: { revoked_at: "2026-08-03T00:00:00Z", expires_at: "2026-11-01T00:00:00Z" },
    }));
    expect(revoked.attestation_state).toBe("revoked");
    expect(revoked.procedures).toBeNull();
  });

  it("throws rather than disclosing when an input carries restricted vocabulary", () => {
    expect(() => buildPartnerWorkspaceDto(dtoInput({
      procedures: { customer_identification: { risk_score: 42 } } as any,
    }))).toThrow(/restricted keys/);
  });

  it("safe next actions: independent CDD when reliance is not the route; refresh on supersession", () => {
    const infoOnly = buildPartnerWorkspaceDto(dtoInput({
      link: { ...baseLink, legal_route: "independent_cdd" },
    }));
    expect(infoOnly.next_action.code).toBe("independent_cdd");
    const superseded = buildPartnerWorkspaceDto(dtoInput({
      attestation: {
        schema_version: 2, version: 3, payload_sha256: "hash-current",
        issued_at: "2026-08-02T00:00:00Z", superseded_at: "2026-08-04T00:00:00Z",
      },
    }));
    expect(superseded.next_action.code).toBe("refresh_review");
  });

  it("negative-field sweep over a fully-populated DTO, nested included", () => {
    const dto = buildPartnerWorkspaceDto(dtoInput({
      determinations: [{ status: "satisfied", decided_at: "2026-08-03T00:00:00Z", based_on_attestation_sha256: "hash-current", created_at: "2026-08-03T00:00:00Z" }],
      requests: [{ id: "req-1", requested_record_codes: ["consent_evidence"], status: "submitted", requested_at: "2026-08-03T00:00:00Z", due_at: null, origin_response_message: null }],
      deliveries: [{ id: "del-1", record_code: "consent_evidence", safe_label: "Consent evidence", delivered_version: 1, delivered_sha256: "abc", delivered_at: "2026-08-04T00:00:00Z", expires_at: "2026-08-20T00:00:00Z", revoked_at: null }],
    }));
    const serialised = JSON.stringify(dto).toLowerCase();
    for (const banned of [
      "risk_rating", "risk_score", "potential_match", "match_detail", "adverse",
      "reviewer_note", "mlro", "analyst", "edd_", "suspicious", "smr",
      "discrepan", "biometric", "storage_path", "signed_url", "bucket",
    ]) {
      expect(serialised).not.toContain(banned);
    }
    expect(dto.deliveries[0].available).toBe(true);
    expect(dto.tasks.length).toBeGreaterThan(0);
  });
});
