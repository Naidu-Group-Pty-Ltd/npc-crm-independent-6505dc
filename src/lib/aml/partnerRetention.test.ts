import { describe, expect, it } from "vitest";
import {
  INFORMATION_CLASSIFICATIONS,
  NEVER_PARTNER_EXPORTABLE,
  PARTNER_RECORD_CLASSES,
  RECORD_FAMILIES,
  RETENTION_TRIGGER_KIND_LABELS,
  STORAGE_ZONES,
  evaluatePartnerExport,
  partnerDependencyBlockers,
} from "../../../supabase/functions/_shared/aml/partnerRetention";

/**
 * Behavioural tests for the Phase 7 record taxonomy, classification,
 * export guard and partner dependency evaluation. All fixtures synthetic.
 */

describe("record families and classifications", () => {
  it("carries the nineteen documented families", () => {
    expect(Object.keys(RECORD_FAMILIES).sort()).toEqual([
      "AUD", "CON", "CTR", "CUS", "DEC", "EDD", "FND", "GOV", "IDV", "MON",
      "OWN", "REL", "REP", "RPT", "SCR", "SHR", "TRU", "TXN", "RET",
    ].sort());
  });

  it("carries the six information classifications P1–P6", () => {
    expect(Object.keys(INFORMATION_CLASSIFICATIONS)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
  });

  it("defines exactly the six documented storage zones, mapped to existing stores", () => {
    expect(Object.keys(STORAGE_ZONES).sort()).toEqual([
      "aml_document_vault", "attestation_store", "audit_retention_ledger",
      "biometric_vault", "restricted_reporting_vault", "structured_cdd_db",
    ]);
    // A zone is a control boundary over an EXISTING store — the biometric
    // zone names the existing bucket; nothing implies a new one.
    expect(STORAGE_ZONES.biometric_vault.implementation).toContain("existing aml-biometrics");
  });
});

describe("every partner-domain record class is fully classified", () => {
  const REQUIRED_CLASSES = [
    "partner_organisation_record", "partner_membership_record",
    "partner_case_link_record", "reliance_arrangement_record",
    "arrangement_assessment_record", "compliance_attestation_record",
    "disclosure_manifest_record", "reliance_grant_record",
    "partner_records_request_record", "evidence_delivery_record",
    "partner_determination_record", "refresh_obligation_record",
    "partner_notification_record", "integration_event_record",
    "delivery_attempt_record", "reliance_access_event_record",
    "retention_trigger_record", "legal_hold_record", "disposal_evidence_record",
    "raw_id_document_copy", "biometric_raw_capture", "suspicious_matter_material",
  ];

  it("covers every class Phases 1–6 created, plus the raw-capture classes", () => {
    for (const code of REQUIRED_CLASSES) {
      expect(PARTNER_RECORD_CLASSES[code], code).toBeTruthy();
    }
    expect(Object.keys(PARTNER_RECORD_CLASSES).length).toBe(REQUIRED_CLASSES.length);
  });

  it("every class carries a valid family, classification, zone, trigger kind and disposal rule", () => {
    for (const [code, entry] of Object.entries(PARTNER_RECORD_CLASSES)) {
      expect(RECORD_FAMILIES[entry.family], `${code} family`).toBeTruthy();
      expect(INFORMATION_CLASSIFICATIONS[entry.classification], `${code} classification`).toBeTruthy();
      expect(STORAGE_ZONES[entry.zone], `${code} zone`).toBeTruthy();
      expect(RETENTION_TRIGGER_KIND_LABELS[entry.triggerKind], `${code} trigger kind`).toBeTruthy();
      expect(["soft_delete", "redact", "hard_delete", "recorded_only"]).toContain(entry.disposalRule);
    }
  });

  it("P4, P5 and P6 classes are never partner-exportable — structurally", () => {
    for (const [code, entry] of Object.entries(PARTNER_RECORD_CLASSES)) {
      if ((NEVER_PARTNER_EXPORTABLE as readonly string[]).includes(entry.classification)) {
        expect(entry.partnerExportable, code).toBe(false);
      }
    }
  });

  it("legal holds are P4 (reviewer/MLRO restricted) and internal — a partner or client never learns of one", () => {
    expect(PARTNER_RECORD_CLASSES.legal_hold_record.classification).toBe("P4");
    expect(PARTNER_RECORD_CLASSES.legal_hold_record.partnerExportable).toBe(false);
  });

  it("raw/full ID-document copies are P3 restricted CDD evidence — object-channel only", () => {
    expect(PARTNER_RECORD_CLASSES.raw_id_document_copy.classification).toBe("P3");
    // Deliverable through the controlled channel…
    expect(PARTNER_RECORD_CLASSES.raw_id_document_copy.partnerExportable).toBe(true);
    // …but never through an ordinary metadata export or passport payload.
    expect(evaluatePartnerExport(["raw_id_document_copy"]).ok).toBe(false);
  });

  it("suspicious-matter/reporting material is P5 and never exportable", () => {
    expect(PARTNER_RECORD_CLASSES.suspicious_matter_material.classification).toBe("P5");
    expect(PARTNER_RECORD_CLASSES.suspicious_matter_material.partnerExportable).toBe(false);
  });

  it("raw biometrics remain P6", () => {
    expect(PARTNER_RECORD_CLASSES.biometric_raw_capture.classification).toBe("P6");
  });
});

describe("retention trigger kinds (§7.5)", () => {
  it("supports every documented trigger, including the partner-domain and necessity clocks", () => {
    for (const kind of [
      "relationship_end", "occasional_transaction_complete", "transaction_date",
      "program_version_obsolete", "investigation_complete", "report_complete",
      "legal_hold_release", "record_created", "client_transaction_record_received",
      "cdd_arrangement_end", "partner_relationship_end", "evidence_delivery_end",
      "raw_id_copy_necessity_end", "biometric_necessity_end", "audit_obligation_end",
    ]) {
      expect(RETENTION_TRIGGER_KIND_LABELS[kind], kind).toBeTruthy();
    }
  });

  it("has no upload-age trigger — age since upload is not a clock", () => {
    for (const kind of Object.keys(RETENTION_TRIGGER_KIND_LABELS)) {
      expect(kind).not.toMatch(/upload/);
    }
  });

  it("record_created is used only by the one class that explicitly runs on creation date", () => {
    const users = Object.entries(PARTNER_RECORD_CLASSES)
      .filter(([, e]) => e.triggerKind === "record_created").map(([code]) => code);
    expect(users).toEqual(["partner_notification_record"]);
  });

  it("raw captures never inherit the structured-CDD clock", () => {
    expect(PARTNER_RECORD_CLASSES.raw_id_document_copy.triggerKind).toBe("raw_id_copy_necessity_end");
    expect(PARTNER_RECORD_CLASSES.raw_id_document_copy.disposalRule).toBe("hard_delete");
    expect(PARTNER_RECORD_CLASSES.biometric_raw_capture.triggerKind).toBe("biometric_necessity_end");
    expect(PARTNER_RECORD_CLASSES.biometric_raw_capture.disposalRule).toBe("hard_delete");
  });
});

describe("the partner export guard (§7.10)", () => {
  it("allows exportable partner-safe classes", () => {
    expect(evaluatePartnerExport(["partner_case_link_record", "evidence_delivery_record"]))
      .toEqual({ ok: true });
  });

  it("blocks reviewer/MLRO-restricted, prohibited and biometric classes", () => {
    const decision = evaluatePartnerExport([
      "arrangement_assessment_record", "suspicious_matter_material", "biometric_raw_capture",
    ]);
    expect(decision.ok).toBe(false);
    if (decision.ok === false) {
      expect(decision.blocked.map((b) => b.classification).sort()).toEqual(["P4", "P5", "P6"]);
    }
    expect(evaluatePartnerExport(["legal_hold_record"]).ok).toBe(false);
  });

  it("blocks unknown codes — vocabulary cannot be invented to reach a record", () => {
    const decision = evaluatePartnerExport(["cases_table_dump"]);
    expect(decision.ok).toBe(false);
    if (decision.ok === false) expect(decision.blocked[0].classification).toBe("unknown");
  });
});

describe("partner dependency evaluation (§7.6)", () => {
  const empty = {
    activePartnerLinks: 0, activeGrants: 0, openRecordsRequests: 0,
    liveEvidenceDeliveries: 0, openRefreshObligations: 0,
  };

  it("no live partner facts → no blockers", () => {
    expect(partnerDependencyBlockers(empty)).toEqual([]);
  });

  it("each live partner fact blocks disposal on its own", () => {
    expect(partnerDependencyBlockers({ ...empty, activePartnerLinks: 1 }))
      .toEqual(["active_partner_case_link"]);
    expect(partnerDependencyBlockers({ ...empty, activeGrants: 2 }))
      .toEqual(["active_reliance_grant"]);
    expect(partnerDependencyBlockers({ ...empty, openRecordsRequests: 1 }))
      .toEqual(["open_partner_records_request"]);
    expect(partnerDependencyBlockers({ ...empty, liveEvidenceDeliveries: 1 }))
      .toEqual(["live_evidence_delivery"]);
    expect(partnerDependencyBlockers({ ...empty, openRefreshObligations: 3 }))
      .toEqual(["open_refresh_obligation"]);
  });

  it("multiple live facts report every blocker", () => {
    const blockers = partnerDependencyBlockers({
      activePartnerLinks: 1, activeGrants: 1, openRecordsRequests: 1,
      liveEvidenceDeliveries: 1, openRefreshObligations: 1,
    });
    expect(blockers.length).toBe(5);
  });
});
