import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for Phase 7: partner-domain records, retention and
 * disposal. The exit-gate properties asserted here: every new record class
 * has a controlled classification and trigger; no disposal rests on a
 * universal upload-age rule; legal holds and dependencies block disposal;
 * the existing engine is extended, never duplicated; and the partner-domain
 * extension is gated so behaviour is unchanged while the flag is off.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const migration = read("supabase/migrations/20260805150000_aml_partner_records_retention_phase7.sql");
const correction = read("supabase/migrations/20260828000000_aml_record_classification_correction.sql");
const records = read("supabase/functions/aml-records/index.ts");
const pure = read("supabase/functions/_shared/aml/partnerRetention.ts");
const events = read("supabase/functions/_shared/aml/partnerEvents.ts");
const reliance = read("supabase/functions/aml-reliance/index.ts");

const dryRun = records.slice(
  records.indexOf('case "dry_run_scan"'), records.indexOf('case "request_approval"'));
const executeScan = records.slice(
  records.indexOf('case "execute_scan"'), records.indexOf("default:", records.indexOf('case "execute_scan"')));
const syncPartner = records.slice(
  records.indexOf('case "sync_partner_triggers"'), records.indexOf('case "list_record_classes"'));
const exportBundle = records.slice(
  records.indexOf('case "export_privacy_bundle"'), records.indexOf('case "list_tipping_off_rules"'));

describe("the existing retention engine is extended, never duplicated", () => {
  it("no second trigger, hold, scan or schedule table is created", () => {
    for (const t of ["retention_triggers", "legal_holds", "retention_scans", "retention_scan_items", "retention_schedules"]) {
      expect(migration).not.toMatch(new RegExp(`CREATE TABLE[^;]*aml\\.${t}\\b`));
    }
  });

  it("the reconciliation is recorded in the migration itself", () => {
    expect(migration).toContain("RECONCILIATION");
    expect(migration).toContain("EXTENDED here, never duplicated");
  });

  it("the trigger-kind CHECK swap is a superset — every historical value stays valid", () => {
    const check = migration.slice(
      migration.indexOf("ADD CONSTRAINT retention_triggers_trigger_kind_check"),
      migration.indexOf("-- ── 2."));
    for (const kind of [
      "relationship_end", "occasional_transaction_complete", "transaction_date",
      "program_version_obsolete", "investigation_complete", "report_complete",
      "legal_hold_release", "record_created", "client_transaction_record_received",
      "cdd_arrangement_end", "partner_relationship_end", "evidence_delivery_end",
      "raw_id_copy_necessity_end", "biometric_necessity_end", "audit_obligation_end",
    ]) {
      expect(check).toContain(`'${kind}'`);
    }
  });
});

describe("the record-class catalogue (§7.2, §7.3)", () => {
  const sqlRows = [...migration.matchAll(
    /\('([a-z_]+)',\s*'(GOV|CUS|IDV|REP|OWN|TRU|SCR|REL|FND|EDD|TXN|CTR|MON|DEC|RPT|CON|SHR|RET|AUD)',\s*'[^']*',\s*'(P[1-6])'/g)]
    .map((m) => ({ code: m[1], family: m[2], classification: m[3] }));
  const tsRows = [...pure.matchAll(
    /([a-z_]+):\s*\{ family: "([A-Z]{3})", classification: "(P[1-6])"/g)]
    .map((m) => ({ code: m[1], family: m[2], classification: m[3] }));

  it("the EFFECTIVE SQL catalogue (Phase 7 seed + correction migration) matches the pure module", () => {
    expect(sqlRows.length).toBe(21);
    expect(tsRows.length).toBe(22);
    // Apply the pre-rollout classification correction on top of the seed —
    // the correction migration must actually contain these statements.
    expect(correction).toMatch(/UPDATE aml\.record_class_catalogue SET\s*\n?\s*information_classification = 'P3'[\s\S]{0,600}?WHERE record_code = 'raw_id_document_copy'/);
    expect(correction).toMatch(/UPDATE aml\.record_class_catalogue SET\s*\n?\s*information_classification = 'P4'[\s\S]{0,600}?WHERE record_code = 'legal_hold_record'/);
    expect(correction).toMatch(/\('suspicious_matter_material', 'RPT',[\s\S]{0,200}?'P5'/);
    const effective = new Map(sqlRows.map((r) => [r.code, { ...r }]));
    effective.get("raw_id_document_copy")!.classification = "P3";
    effective.get("legal_hold_record")!.classification = "P4";
    effective.set("suspicious_matter_material", {
      code: "suspicious_matter_material", family: "RPT", classification: "P5",
    });
    for (const ts of tsRows) {
      const sql = effective.get(ts.code);
      expect(sql, ts.code).toBeTruthy();
      expect(sql!.family, ts.code).toBe(ts.family);
      expect(sql!.classification, ts.code).toBe(ts.classification);
    }
    expect(effective.size).toBe(tsRows.length);
  });

  it("the correction fails closed and preserves triggers, disposal and hold blocking", () => {
    expect(correction).toContain("RAISE EXCEPTION 'classification correction expects raw_id_document_copy");
    expect(correction).toMatch(/refusing to guess/);
    expect(correction).toContain("classification correction did not converge");
    // Nothing about clocks or destruction changes.
    for (const preserved of ["raw_id_copy_necessity_end", "legal_hold_release"]) {
      expect(correction).not.toMatch(new RegExp(`SET[^;]*retention_trigger_kind[^;]*'(?!${preserved})`));
    }
    expect(correction).not.toContain("disposal_rule =");
    expect(correction).not.toContain("DROP TABLE");
  });

  it("P4/P5/P6 can never be partner-exportable — enforced by a table CHECK, not convention", () => {
    expect(migration).toContain("CONSTRAINT record_class_restricted_never_exportable");
    expect(migration).toMatch(/information_classification NOT IN \('P4','P5','P6'\) OR partner_exportable = false/);
  });

  it("the catalogue is queryable through a read-only staff op", () => {
    expect(records).toContain('case "list_record_classes"');
    expect(records).toContain('from("record_class_catalogue")');
  });
});

describe("no universal upload-age rule (§7.5)", () => {
  it("scan candidates still come from recorded retention triggers only", () => {
    expect(dryRun).toContain('from("retention_triggers")');
    expect(dryRun).toContain('.lte("minimum_retention_date"');
    expect(dryRun).not.toContain("uploaded_at");
  });

  it("partner trigger derivation uses recorded terminal state, with creation-date only for the one class that declares it", () => {
    expect(syncPartner).toContain('"partner_relationship_end",\n            l.ended_at');
    expect(syncPartner).toContain('"evidence_delivery_end"');
    expect(syncPartner).toContain('"audit_obligation_end"');
    // record_created appears exactly once — the transient notification class.
    const uses = syncPartner.match(/"record_created"/g) ?? [];
    expect(uses.length).toBe(1);
  });

  it("the raw-capture schedule runs on necessity, not a stored-age period", () => {
    expect(migration).toMatch(/\('raw_id_document_copy',\s*0,/);
    expect(migration).toContain("Privacy Act 1988 APP 11.2");
  });
});

describe("the partner-domain extension is flag-gated (§7.11)", () => {
  it("new trigger kinds and partner entity types are rejected while the flag is off", () => {
    const recordTrigger = records.slice(
      records.indexOf('case "record_retention_trigger"'),
      records.indexOf('case "sync_case_triggers"'));
    expect(recordTrigger).toContain("PHASE7_TRIGGER_KINDS.has(triggerKind)");
    expect(recordTrigger).toContain("PARTNER_ENTITY_TYPES.has(entityType)");
    expect(recordTrigger).toContain('flagEnabled(admin, "aml_partner_records_retention")');
    expect(recordTrigger).toContain('"partner_retention_disabled"');
  });

  it("partner trigger derivation is flag-gated", () => {
    expect(syncPartner).toContain('flagEnabled(admin, "aml_partner_records_retention")');
    expect(syncPartner).toContain('"partner_retention_disabled"');
  });

  it("partner dependency blockers run at dry run AND execution, only when the flag is on", () => {
    expect(dryRun).toContain('await flagEnabled(admin, "aml_partner_records_retention")');
    expect(dryRun).toContain("dependencyBlockersFor(admin, t.entity_type, t.entity_id, caseId, partnerChecks)");
    expect(executeScan).toContain("partnerChecksAtExecution");
    expect(executeScan).toContain("dependencyBlockersFor(admin, it.entity_type, it.entity_id, caseId, partnerChecksAtExecution)");
  });

  it("the flag is seeded false and existing controls are not disabled by it", () => {
    expect(migration).toContain("('aml_partner_records_retention', 'false'::jsonb");
    // The partner checks only ADD blockers; the pre-existing blocker logic
    // is untouched (its markers are all still present).
    for (const marker of ["open_regulatory_report", "open_investigation", "referenced_as_evidence", "relationship_not_ended"]) {
      expect(records).toContain(marker);
    }
  });
});

describe("dependencies and holds block disposal (§7.6)", () => {
  it("the decision lives in the pure module and the engine counts live facts", () => {
    expect(records).toContain("partnerDependencyBlockers({");
    for (const q of [
      '.eq("state", "active")',
      '.is("revoked_at", null).gt("expires_at", nowIso)',
      '.eq("status", "open")',
    ]) {
      expect(records).toContain(q);
    }
  });

  it("hold and dependency checks still re-run at execution — approval is not a free pass", () => {
    expect(executeScan).toContain("Held at execution");
    expect(executeScan).toContain("Dependency check failed at execution");
    expect(executeScan).toContain("retention_trigger_no_longer_operative");
  });

  it("biometric disposal still removes the object BEFORE clearing the pointer", () => {
    const dispose = records.slice(
      records.indexOf("async function disposeBiometric"),
      records.indexOf("// Phase 11 (§18)"));
    const removeAt = dispose.indexOf('.remove([check.biometric_storage_path])');
    const clearAt = dispose.indexOf("biometric_storage_path: null");
    expect(removeAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(removeAt);
  });
});

describe("scan sources stay conservative", () => {
  it("only executable partner classes gain a source; evidence classes dispose as recorded_only", () => {
    const sources = records.slice(
      records.indexOf("const SCAN_SOURCES"), records.indexOf("async function flagEnabled"));
    for (const present of ["partner_case_link:", "partner_records_request:", "partner_refresh_obligation:", "partner_notification:"]) {
      expect(sources).toContain(present);
    }
    // Attestations, grants, manifests and delivery read models are evidence:
    // no scan source, so execution records disposal without touching rows.
    for (const absent of ["compliance_attestations", "reliance_grants", "disclosure_manifests", "partner_evidence_deliveries"]) {
      expect(sources).not.toContain(absent);
    }
  });
});

describe("disposal lifecycle events (completing the Phase 6 catalogue)", () => {
  it("scan transitions emit aml.disposal.* atomically through the Phase 6 choke point", () => {
    expect(migration).toContain("CREATE TRIGGER trg_aml_emit_disposal_events");
    expect(migration).toContain("AFTER UPDATE ON aml.retention_scans");
    for (const e of ["aml.disposal.approved", "aml.disposal.executed", "aml.disposal.failed"]) {
      expect(migration).toContain(`'${e}'`);
    }
    expect(migration).toMatch(/SET emitted_by = 'trigger'/);
  });

  it("the pure event catalogue records the emitter arrival", () => {
    expect(events).toMatch(/"aml\.disposal\.approved":.*emittedBy: "trigger"/);
    expect(events).toMatch(/"aml\.disposal\.failed":.*emittedBy: "trigger"/);
  });
});

describe("exports respect classification (§7.10)", () => {
  it("the privacy bundle's partner-sharing section is flag-gated metadata only", () => {
    expect(exportBundle).toContain('flagEnabled(admin, "aml_partner_records_retention")');
    expect(exportBundle).toContain("partner_sharing");
    for (const restricted of ["internal_trigger_codes", "trigger_source", "findings", "decision_basis", "legal_holds", "arrangement_assessments"]) {
      expect(exportBundle).not.toContain(restricted);
    }
  });

  it("the pure export guard blocks restricted classes for partner-facing exports", () => {
    expect(pure).toContain("evaluatePartnerExport");
    expect(pure).toContain("NEVER_PARTNER_EXPORTABLE");
  });
});

describe("security boundaries", () => {
  it("a partner cannot invoke retention or disposal — no workspace op touches them", () => {
    const opsSet = reliance.slice(
      reliance.indexOf("const PARTNER_WORKSPACE_OPS"),
      reliance.indexOf("const WORKSPACE_PORTAL_FLAGS"));
    expect(opsSet).not.toMatch(/scan|disposal|retention|hold/);
  });

  it("scan approval and execution remain MLRO-only", () => {
    const approve = records.slice(records.indexOf('case "approve_scan"'), records.indexOf('case "cancel_scan"'));
    expect(approve).toContain("if (!isMlro)");
    expect(executeScan).toContain("if (!isMlro)");
  });

  it("the catalogue table is read-only for staff and writable by service role only", () => {
    expect(migration).toContain('"aml_record_class_catalogue_read"');
    expect(migration).toContain("FOR SELECT TO authenticated");
    expect(migration).toContain('"aml_record_class_catalogue_service"');
  });
});
