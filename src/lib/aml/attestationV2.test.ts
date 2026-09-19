import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_CODE_SECTIONS,
  DEFAULT_ALLOWED_ATTRIBUTE_CODES,
  DEFAULT_DENIED_CLASSES,
  canonicalJson,
  evaluateManifestForRead,
  findRestrictedKeys,
  intersectPayloadWithManifest,
  materialInputHash,
  sha256HexCanonical,
  toV2Payload,
  type MaterialInputs,
} from "../../../supabase/functions/_shared/aml/attestationV2";

/**
 * Behavioural tests for the attestation v2 disclosure mechanics (Phase 3).
 * All fixtures are synthetic. Nested structures are tested, not only
 * top-level keys.
 */

const NOW = new Date("2026-08-05T00:00:00Z");

/** A realistic synthetic v1-shaped sanitised payload. */
const v1Payload = () => ({
  schema: "aml.compliance_attestation.v1",
  issuer: "NPC Services command centre",
  case_reference: "AML-2026-SYN-001",
  subject: "Synthetic Test Subject",
  subject_type: "individual",
  customer_identification: {
    parties: [
      {
        party: "Synthetic Test Subject", verified: true, method: "document_sighting",
        completed_at: "2026-08-01T00:00:00Z", document_type: "drivers_licence",
        sighting_kind: "original", certifier_capacity: null,
      },
    ],
    questionnaire_version: "2",
    sections_submitted: 4,
    consents_held: [
      { code: "privacy_notice", version: "2026.2", accepted_at: "2026-07-30T00:00:00Z" },
      { code: "compliance_sharing", version: "2026.2", accepted_at: "2026-07-30T00:00:00Z" },
    ],
  },
  screening: {
    performed: true,
    last_performed_at: "2026-08-02T00:00:00Z",
    scope: ["pep", "sanctions"],
    list_freshness: { dfat: "2026-08-04T18:10:00Z", un: "2026-08-04T18:10:00Z" },
  },
  service_readiness: true,
  limitations: [
    "documents_not_verified_against_issuing_authority",
    "liveness_signal_is_heuristic_only",
  ],
  reliance_basis: "AML/CTF Act 2006 (Cth) Pt 2 Div 7 — written CDD arrangement required; relying entity remains responsible for its own compliance",
});

const materialInputs = (over: Partial<MaterialInputs> = {}): MaterialInputs => ({
  subject: "Synthetic Test Subject",
  subject_type: "individual",
  parties: v1Payload().customer_identification.parties,
  consents_held: v1Payload().customer_identification.consents_held,
  screening: v1Payload().screening as MaterialInputs["screening"],
  service_gate_decision_id: "gate-decision-0001",
  limitations: v1Payload().limitations,
  questionnaire_version: "2",
  ...over,
});

const manifest = (over: Partial<Parameters<typeof intersectPayloadWithManifest>[1]> = {}) => ({
  allowed_attribute_codes: [...DEFAULT_ALLOWED_ATTRIBUTE_CODES],
  allowed_record_classes: ["identity_verification_record"],
  denied_classes: [...DEFAULT_DENIED_CLASSES],
  expires_at: "2026-11-01T00:00:00Z",
  revoked_at: null,
  ...over,
});

describe("canonical JSON and hashing", () => {
  it("is deterministic under key-order permutation, at every depth", async () => {
    const a = { outer: { b: 2, a: [{ y: 1, x: 2 }] }, first: 1 };
    const b = { first: 1, outer: { a: [{ x: 2, y: 1 }], b: 2 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await sha256HexCanonical(a)).toBe(await sha256HexCanonical(b));
  });

  it("distinguishes genuinely different values", async () => {
    expect(await sha256HexCanonical({ a: 1 })).not.toBe(await sha256HexCanonical({ a: 2 }));
  });
});

describe("material-input hash", () => {
  it("is deterministic and order-insensitive for parties and consents", async () => {
    const base = await materialInputHash(materialInputs());
    const reordered = await materialInputHash(materialInputs({
      consents_held: [...v1Payload().customer_identification.consents_held].reverse(),
    }));
    expect(reordered).toBe(base);
  });

  it("changes on a material change — a new verified party", async () => {
    const base = await materialInputHash(materialInputs());
    const withParty = await materialInputHash(materialInputs({
      parties: [
        ...v1Payload().customer_identification.parties,
        { party: "Second Synthetic Party", verified: true, method: "electronic_idv", completed_at: "2026-08-03T00:00:00Z", document_type: null },
      ],
    }));
    expect(withParty).not.toBe(base);
  });

  it("changes when the explicit gate decision changes", async () => {
    const base = await materialInputHash(materialInputs());
    const other = await materialInputHash(materialInputs({ service_gate_decision_id: "gate-decision-0002" }));
    expect(other).not.toBe(base);
  });

  it("does NOT include presentation-only fields — a section counter is not material", async () => {
    // sections_submitted lives in the payload but is deliberately absent
    // from MaterialInputs: resubmitting a questionnaire section without any
    // verification change must not force a supersession.
    const keys = Object.keys(materialInputs());
    expect(keys).not.toContain("sections_submitted");
    expect(keys).not.toContain("issuer");
  });
});

describe("v2 payload construction", () => {
  it("emits only the closed key set — nothing is spread through", () => {
    const tainted = { ...v1Payload(), risk_rating: "low", reviewer_notes: "internal" } as any;
    const v2 = toV2Payload(tainted);
    expect(Object.keys(v2).sort()).toEqual([
      "case_reference", "customer_identification", "issuer", "limitations",
      "reliance_basis", "schema", "screening", "service_readiness",
      "subject", "subject_type",
    ]);
    expect(v2).not.toHaveProperty("risk_rating");
    expect(v2).not.toHaveProperty("reviewer_notes");
    expect(v2.schema).toBe("aml.compliance_attestation.v2");
  });

  it("a clean synthetic payload passes the restricted-key tripwire", () => {
    expect(findRestrictedKeys(toV2Payload(v1Payload()))).toEqual([]);
  });

  it("the tripwire finds restricted keys at ANY depth", () => {
    const planted = toV2Payload(v1Payload()) as any;
    planted.customer_identification.parties[0].outcome = { risk_score: 91 };
    const found = findRestrictedKeys(planted);
    expect(found.some((p) => p.includes("risk_score"))).toBe(true);

    const planted2 = toV2Payload(v1Payload()) as any;
    planted2.screening.list_freshness = { dfat: "x", match_detail: "SMITH, John" };
    expect(findRestrictedKeys(planted2).some((p) => p.includes("match_detail"))).toBe(true);

    const planted3 = toV2Payload(v1Payload()) as any;
    planted3.limitations = [{ mlro_commentary: "never" }];
    expect(findRestrictedKeys(planted3).some((p) => p.includes("mlro_commentary"))).toBe(true);
  });
});

describe("manifest intersection", () => {
  it("full default manifest reproduces the sanitised disclosure plus record availability", () => {
    const out = intersectPayloadWithManifest(toV2Payload(v1Payload()), manifest());
    expect(out.schema).toBe("aml.compliance_attestation.v2");
    expect(out.customer_identification).toBeDefined();
    expect(out.screening).toBeDefined();
    expect(out.service_readiness).toBe(true);
    expect(out.limitations).toBeDefined();
    expect(out.record_availability).toEqual({
      classes_available_on_controlled_request: ["identity_verification_record"],
    });
  });

  it("a code missing from the allowlist discloses nothing for its sections", () => {
    const out = intersectPayloadWithManifest(toV2Payload(v1Payload()), manifest({
      allowed_attribute_codes: ["screening.procedure"],
    }));
    expect(out.screening).toBeDefined();
    expect(out).not.toHaveProperty("customer_identification");
    expect(out).not.toHaveProperty("service_readiness");
    expect(out).not.toHaveProperty("subject");
    // Envelope always identifies the document.
    expect(out.case_reference).toBe("AML-2026-SYN-001");
  });

  it("denied classes override allowed codes", () => {
    const out = intersectPayloadWithManifest(toV2Payload(v1Payload()), manifest({
      allowed_attribute_codes: [...DEFAULT_ALLOWED_ATTRIBUTE_CODES],
      denied_classes: ["identity.customer_identification", "service.readiness"],
    }));
    expect(out).not.toHaveProperty("customer_identification");
    expect(out).not.toHaveProperty("service_readiness");
    expect(out.screening).toBeDefined();
  });

  it("unknown attribute codes disclose nothing", () => {
    const out = intersectPayloadWithManifest(toV2Payload(v1Payload()), manifest({
      allowed_attribute_codes: ["everything.please", "internal.records"],
    }));
    expect(Object.keys(out).sort()).toEqual(
      ["case_reference", "issuer", "record_availability", "reliance_basis", "schema"]);
  });

  it("refuses to serialise a payload carrying restricted vocabulary", () => {
    const tampered = toV2Payload(v1Payload()) as any;
    tampered.customer_identification.review = { reviewer_notes: "internal" };
    expect(() => intersectPayloadWithManifest(tampered, manifest())).toThrow(/restricted keys/);
  });

  it("expired, revoked and missing manifests block v2 reading", () => {
    expect(evaluateManifestForRead(null, NOW))
      .toMatchObject({ ok: false, code: "manifest_missing" });
    expect(evaluateManifestForRead(manifest({ expires_at: "2026-08-01T00:00:00Z" }), NOW))
      .toMatchObject({ ok: false, code: "manifest_expired" });
    expect(evaluateManifestForRead(manifest({ revoked_at: "2026-08-04T00:00:00Z" }), NOW))
      .toMatchObject({ ok: false, code: "manifest_revoked" });
    expect(evaluateManifestForRead(manifest(), NOW)).toEqual({ ok: true });
  });

  it("negative-field sweep: no restricted name appears anywhere in a default v2 response", () => {
    const out = intersectPayloadWithManifest(toV2Payload(v1Payload()), manifest());
    const serialised = JSON.stringify(out);
    for (const restricted of [
      "risk_rating", "risk_score", "potential_match", "match_details", "adverse_media",
      "reviewer_notes", "mlro_notes", "mlro_commentary", "edd_", "suspicious_matter",
      "smr", "report_status", "biometric", "storage_path", "signed_url", "discrepan",
    ]) {
      expect(serialised.toLowerCase()).not.toContain(restricted);
    }
    expect(findRestrictedKeys(out)).toEqual([]);
  });

  it("every attribute code maps only to sections the closed schema actually emits", () => {
    const v2Keys = new Set(Object.keys(toV2Payload(v1Payload())));
    for (const sections of Object.values(ATTRIBUTE_CODE_SECTIONS)) {
      for (const s of sections) expect(v2Keys.has(s)).toBe(true);
    }
  });
});
