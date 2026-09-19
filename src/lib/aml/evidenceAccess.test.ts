import { describe, expect, it } from "vitest";
import {
  EVIDENCE_OBJECT_CLASSES,
  PARTNER_RECORD_CLASSES,
  evaluateEvidenceObjectDelivery,
  evaluatePartnerExport,
} from "../../../supabase/functions/_shared/aml/partnerRetention";
import { REQUESTABLE_RECORD_CLASSES } from "../../../supabase/functions/_shared/aml/partnerWorkspace";
import { ATTRIBUTE_CODE_SECTIONS } from "../../../supabase/functions/_shared/aml/attestationV2";

/**
 * Behavioural tests for the Stage B evidence-object delivery guard and the
 * corrected classification boundary. All fixtures synthetic.
 */

describe("the evidence-object channel serves exactly the closed P3 catalogue", () => {
  it("every requestable P3 evidence family is deliverable", () => {
    for (const code of Object.keys(REQUESTABLE_RECORD_CLASSES)) {
      expect(evaluateEvidenceObjectDelivery(code, REQUESTABLE_RECORD_CLASSES))
        .toEqual({ ok: true, classification: "P3" });
    }
  });

  it("P4 reviewer material is refused with its classification named internally", () => {
    for (const code of ["legal_hold_record", "arrangement_assessment_record"]) {
      const d = evaluateEvidenceObjectDelivery(code, REQUESTABLE_RECORD_CLASSES);
      expect(d.ok).toBe(false);
      if (d.ok === false) expect(d.code).toBe("classification_not_deliverable");
    }
  });

  it("P5 prohibited and P6 biometric classes are refused categorically", () => {
    for (const code of ["suspicious_matter_material", "biometric_raw_capture"]) {
      const d = evaluateEvidenceObjectDelivery(code, REQUESTABLE_RECORD_CLASSES);
      expect(d.ok).toBe(false);
      if (d.ok === false) expect(d.code).toBe("classification_not_deliverable");
    }
  });

  it("P1/P2 metadata classes cannot masquerade as deliverable objects", () => {
    for (const code of ["partner_case_link_record", "compliance_attestation_record", "refresh_obligation_record"]) {
      const d = evaluateEvidenceObjectDelivery(code, REQUESTABLE_RECORD_CLASSES);
      expect(d.ok).toBe(false);
      if (d.ok === false) expect(d.code).toBe("classification_not_deliverable");
    }
  });

  it("unknown vocabulary — table names, field names, paths — discloses nothing", () => {
    for (const code of ["aml.cases", "storage/v1/object/x", "risk_rating", "screening_matches", ""]) {
      const d = evaluateEvidenceObjectDelivery(code, REQUESTABLE_RECORD_CLASSES);
      expect(d.ok).toBe(false);
      if (d.ok === false) expect(d.code).toBe("record_code_unknown");
    }
  });
});

describe("the corrected classification boundary", () => {
  it("raw/full ID copy is P3, legal hold is P4, reporting material is P5, biometric is P6", () => {
    expect(PARTNER_RECORD_CLASSES.raw_id_document_copy.classification).toBe("P3");
    expect(PARTNER_RECORD_CLASSES.legal_hold_record.classification).toBe("P4");
    expect(PARTNER_RECORD_CLASSES.suspicious_matter_material.classification).toBe("P5");
    expect(PARTNER_RECORD_CLASSES.biometric_raw_capture.classification).toBe("P6");
  });

  it("evidence OBJECTS never travel in ordinary metadata exports, even at P3", () => {
    expect(EVIDENCE_OBJECT_CLASSES.has("raw_id_document_copy")).toBe(true);
    expect(EVIDENCE_OBJECT_CLASSES.has("biometric_raw_capture")).toBe(true);
    expect(evaluatePartnerExport(["raw_id_document_copy"]).ok).toBe(false);
    expect(evaluatePartnerExport(["biometric_raw_capture"]).ok).toBe(false);
  });

  it("P3 objects have no route into the passport payload — the attestation schema has no document section", () => {
    // The closed attribute-code map is the ONLY way payload sections reach
    // a partner; none of its sections is a document object.
    const sections = Object.values(ATTRIBUTE_CODE_SECTIONS).flat();
    for (const s of sections) {
      expect(s).not.toMatch(/document_cop|raw|image|object|storage|file/);
    }
  });
});
