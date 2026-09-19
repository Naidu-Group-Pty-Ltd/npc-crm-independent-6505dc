/**
 * Partner-domain records, retention and disposal — the pure domain layer
 * (Phase 7).
 *
 * The database owns the catalogue rows (aml.record_class_catalogue) and the
 * aml-records engine owns enumeration/disposal; THIS module owns the
 * taxonomy itself and the decisions:
 *
 *  - the documented record families (GOV…AUD) and P1–P6 information
 *    classifications;
 *  - the six logical storage zones, each mapped to an EXISTING store — a
 *    zone is a control boundary, not a new bucket;
 *  - the partner-domain record classes with their family, classification,
 *    zone, retention trigger kind and disposal rule (a contract test keeps
 *    this in lockstep with the SQL seed);
 *  - the export guard: P4/P5/P6 classes can never enter a partner-facing
 *    export, structurally;
 *  - the partner dependency evaluator: which live partner-domain facts
 *    block a disposal.
 *
 * Pure module: no Deno APIs, no database access — behaviourally testable
 * from vitest.
 */

/* ── record families (documented controlled set) ───────────────────────── */

export const RECORD_FAMILIES: Record<string, string> = {
  GOV: "Governance and program records",
  CUS: "Customer records",
  IDV: "Identity and verification records",
  REP: "Representative and authority records",
  OWN: "Ownership and control records",
  TRU: "Trust and structure records",
  SCR: "Screening records",
  REL: "Reliance and partner relationship records",
  FND: "Funding and source-of-funds records",
  EDD: "Enhanced due diligence records",
  TXN: "Transaction records",
  CTR: "Contract and engagement records",
  MON: "Monitoring records",
  DEC: "Decision records",
  RPT: "Regulatory reporting records",
  CON: "Consent and notice records",
  SHR: "Sharing and disclosure records",
  RET: "Retention and disposal records",
  AUD: "Audit and access records",
};

/* ── P1–P6 information classifications ─────────────────────────────────── */

export const INFORMATION_CLASSIFICATIONS: Record<string, string> = {
  P1: "Client-safe status",
  P2: "Partner-safe attestation and arrangement data",
  P3: "Restricted CDD evidence (deliverable only after origin review)",
  P4: "Reviewer/MLRO restricted",
  P5: "Prohibited / highly restricted",
  P6: "Raw biometric data",
};

/** Classifications that can NEVER appear in a partner-facing export. */
export const NEVER_PARTNER_EXPORTABLE = ["P4", "P5", "P6"] as const;

/* ── the six logical storage zones (mapped, not invented) ──────────────── */

export const STORAGE_ZONES: Record<string, { label: string; implementation: string }> = {
  structured_cdd_db: {
    label: "Structured CDD database",
    implementation: "aml schema relational tables (service-role RLS, SECURITY DEFINER access only)",
  },
  aml_document_vault: {
    label: "AML document vault",
    implementation: "existing private AML evidence storage; no partner-domain table carries an object path",
  },
  biometric_vault: {
    label: "Biometric vault",
    implementation: "existing aml-biometrics private bucket with APP 11 access log",
  },
  restricted_reporting_vault: {
    label: "Restricted reporting/investigation vault",
    implementation: "aml reports / EDD / alert tables (reviewer/MLRO access paths only)",
  },
  attestation_store: {
    label: "Attestation store",
    implementation: "aml.compliance_attestations + aml.disclosure_manifests (versioned, hash-addressed)",
  },
  audit_retention_ledger: {
    label: "Audit and retention ledger",
    implementation: "hash-chained audit events, access logs, retention triggers, holds and disposal evidence",
  },
};

/* ── partner-domain record classes (mirror of the SQL catalogue seed) ──── */

export interface RecordClass {
  family: keyof typeof RECORD_FAMILIES;
  classification: keyof typeof INFORMATION_CLASSIFICATIONS;
  zone: keyof typeof STORAGE_ZONES;
  triggerKind: string;
  disposalRule: "soft_delete" | "redact" | "hard_delete" | "recorded_only";
  partnerExportable: boolean;
  label: string;
}

export const PARTNER_RECORD_CLASSES: Record<string, RecordClass> = {
  partner_organisation_record:   { family: "GOV", classification: "P2", zone: "structured_cdd_db", triggerKind: "partner_relationship_end", disposalRule: "soft_delete", partnerExportable: false, label: "Partner organisation classification record" },
  partner_membership_record:     { family: "GOV", classification: "P3", zone: "structured_cdd_db", triggerKind: "partner_relationship_end", disposalRule: "soft_delete", partnerExportable: false, label: "Partner portal membership mapping" },
  partner_case_link_record:      { family: "REL", classification: "P2", zone: "structured_cdd_db", triggerKind: "partner_relationship_end", disposalRule: "soft_delete", partnerExportable: true, label: "Partner-case link and legal route" },
  reliance_arrangement_record:   { family: "REL", classification: "P2", zone: "structured_cdd_db", triggerKind: "cdd_arrangement_end", disposalRule: "soft_delete", partnerExportable: true, label: "Written CDD arrangement (s 37A)" },
  arrangement_assessment_record: { family: "REL", classification: "P4", zone: "structured_cdd_db", triggerKind: "cdd_arrangement_end", disposalRule: "soft_delete", partnerExportable: false, label: "Arrangement review assessment" },
  compliance_attestation_record: { family: "SHR", classification: "P2", zone: "attestation_store", triggerKind: "relationship_end", disposalRule: "recorded_only", partnerExportable: true, label: "Compliance attestation (sanitised)" },
  disclosure_manifest_record:    { family: "SHR", classification: "P2", zone: "attestation_store", triggerKind: "relationship_end", disposalRule: "recorded_only", partnerExportable: false, label: "Per-grant disclosure manifest" },
  reliance_grant_record:         { family: "SHR", classification: "P2", zone: "structured_cdd_db", triggerKind: "relationship_end", disposalRule: "recorded_only", partnerExportable: true, label: "Reliance access grant" },
  partner_records_request_record:{ family: "SHR", classification: "P3", zone: "structured_cdd_db", triggerKind: "evidence_delivery_end", disposalRule: "soft_delete", partnerExportable: true, label: "Controlled partner records request" },
  evidence_delivery_record:      { family: "SHR", classification: "P3", zone: "structured_cdd_db", triggerKind: "evidence_delivery_end", disposalRule: "recorded_only", partnerExportable: true, label: "Evidence delivery read model (metadata only)" },
  partner_determination_record:  { family: "REL", classification: "P3", zone: "structured_cdd_db", triggerKind: "partner_relationship_end", disposalRule: "soft_delete", partnerExportable: true, label: "Partner independent determination" },
  refresh_obligation_record:     { family: "SHR", classification: "P2", zone: "structured_cdd_db", triggerKind: "audit_obligation_end", disposalRule: "soft_delete", partnerExportable: true, label: "Partner refresh obligation" },
  partner_notification_record:   { family: "SHR", classification: "P2", zone: "structured_cdd_db", triggerKind: "record_created", disposalRule: "hard_delete", partnerExportable: true, label: "Partner-safe notification (fixed copy)" },
  integration_event_record:      { family: "AUD", classification: "P4", zone: "audit_retention_ledger", triggerKind: "audit_obligation_end", disposalRule: "recorded_only", partnerExportable: false, label: "Partner integration outbox event" },
  delivery_attempt_record:       { family: "AUD", classification: "P4", zone: "audit_retention_ledger", triggerKind: "audit_obligation_end", disposalRule: "recorded_only", partnerExportable: false, label: "Event delivery attempt ledger entry" },
  reliance_access_event_record:  { family: "AUD", classification: "P4", zone: "audit_retention_ledger", triggerKind: "audit_obligation_end", disposalRule: "recorded_only", partnerExportable: false, label: "Partner access log entry" },
  retention_trigger_record:      { family: "RET", classification: "P4", zone: "audit_retention_ledger", triggerKind: "audit_obligation_end", disposalRule: "recorded_only", partnerExportable: false, label: "Recorded retention trigger" },
  // Corrected pre-rollout: legal holds are reviewer/MLRO restricted (P4),
  // not P5. Everything else about them — invisibility to partners/clients,
  // non-exportability, disposal blocking — is unchanged.
  legal_hold_record:             { family: "RET", classification: "P4", zone: "audit_retention_ledger", triggerKind: "legal_hold_release", disposalRule: "recorded_only", partnerExportable: false, label: "Legal hold" },
  disposal_evidence_record:      { family: "RET", classification: "P4", zone: "audit_retention_ledger", triggerKind: "audit_obligation_end", disposalRule: "recorded_only", partnerExportable: false, label: "Disposal approval/execution evidence" },
  // Corrected pre-rollout: a retained full ID-document image is restricted
  // CDD evidence (P3) — deliverable ONLY through the controlled, approved,
  // expiring evidence-delivery path. Necessity clock and hard delete stand.
  raw_id_document_copy:          { family: "IDV", classification: "P3", zone: "aml_document_vault", triggerKind: "raw_id_copy_necessity_end", disposalRule: "hard_delete", partnerExportable: true, label: "Full identity-document image copy" },
  biometric_raw_capture:         { family: "IDV", classification: "P6", zone: "biometric_vault", triggerKind: "biometric_necessity_end", disposalRule: "hard_delete", partnerExportable: false, label: "Raw biometric capture (facial image)" },
  // Seeded with the correction: the genuinely-P5 class. The fact, status
  // and content of suspicious-matter/AUSTRAC reporting never enters any
  // partner or client surface (s 123).
  suspicious_matter_material:    { family: "RPT", classification: "P5", zone: "restricted_reporting_vault", triggerKind: "report_complete", disposalRule: "recorded_only", partnerExportable: false, label: "Suspicious-matter and regulatory-reporting material" },
};

/* ── trigger kinds (mirror of the widened SQL CHECK) ───────────────────── */

export const RETENTION_TRIGGER_KIND_LABELS: Record<string, string> = {
  relationship_end: "Business relationship ended",
  occasional_transaction_complete: "Occasional transaction completed",
  transaction_date: "Transaction date",
  program_version_obsolete: "AML program version became obsolete",
  investigation_complete: "Investigation completed",
  report_complete: "Regulatory report completed",
  legal_hold_release: "Legal hold released",
  record_created: "Record created (class explicitly uses creation date)",
  client_transaction_record_received: "Client-supplied transaction record received",
  cdd_arrangement_end: "CDD arrangement no longer relevant",
  partner_relationship_end: "Partner relationship ended",
  evidence_delivery_end: "Evidence delivery expired or relationship ended",
  raw_id_copy_necessity_end: "Raw identity-document copy no longer reasonably necessary",
  biometric_necessity_end: "Biometric data no longer necessary for the specific purpose",
  audit_obligation_end: "Underlying obligation for access/audit evidence ended",
};

/* ── the export guard ──────────────────────────────────────────────────── */

/**
 * Classes whose substance is a stored OBJECT rather than metadata. They
 * never travel in ordinary metadata exports or passport payloads — the only
 * partner route for a P3 object is the controlled, approved, expiring
 * evidence-delivery channel (and there is NO partner route at all for P6).
 */
export const EVIDENCE_OBJECT_CLASSES = new Set([
  "raw_id_document_copy",
  "biometric_raw_capture",
]);

export type ExportDecision =
  | { ok: true }
  | { ok: false; blocked: Array<{ code: string; classification: string }> };

/** An ORDINARY partner-facing (metadata) export may only carry classes that
 * are flagged exportable, outside P4/P5/P6, and not evidence objects.
 * Unknown codes are blocked — a caller cannot invent vocabulary to reach a
 * record. Object delivery is a different, stricter channel: see
 * evaluateEvidenceObjectDelivery. */
export function evaluatePartnerExport(recordCodes: string[]): ExportDecision {
  const blocked: Array<{ code: string; classification: string }> = [];
  for (const code of recordCodes ?? []) {
    const entry = PARTNER_RECORD_CLASSES[code];
    if (!entry) {
      blocked.push({ code, classification: "unknown" });
      continue;
    }
    if (!entry.partnerExportable ||
      (NEVER_PARTNER_EXPORTABLE as readonly string[]).includes(entry.classification) ||
      EVIDENCE_OBJECT_CLASSES.has(code)) {
      blocked.push({ code, classification: entry.classification });
    }
  }
  return blocked.length > 0 ? { ok: false, blocked } : { ok: true };
}

/* ── the evidence-object delivery guard (Stage B) ──────────────────────── */

export type EvidenceDeliveryClassDecision =
  | { ok: true; classification: "P3" }
  | { ok: false; code: "record_code_unknown" | "classification_not_deliverable"; message: string };

/**
 * The controlled object channel accepts EXACTLY the closed requestable
 * record-code catalogue (the P3 CDD-evidence families a partner may request
 * and the origin may approve). Everything else is refused with a safe code:
 * catalogue classes that are not P3 evidence (P1/P2 metadata, P4 reviewer
 * material, P5 prohibited, P6 biometric) name their classification; unknown
 * vocabulary discloses nothing.
 *
 * The requestable catalogue is injected (not imported) so this module stays
 * dependency-free; callers pass REQUESTABLE_RECORD_CLASSES from
 * partnerWorkspace.ts.
 */
export function evaluateEvidenceObjectDelivery(
  recordCode: string,
  requestableCodes: Record<string, unknown>,
): EvidenceDeliveryClassDecision {
  if (requestableCodes[recordCode]) return { ok: true, classification: "P3" };
  const catalogued = PARTNER_RECORD_CLASSES[recordCode];
  if (catalogued) {
    return {
      ok: false, code: "classification_not_deliverable",
      message: `Records of class ${catalogued.classification} are not deliverable through the evidence channel.`,
    };
  }
  return {
    ok: false, code: "record_code_unknown",
    message: "That record code is not part of the controlled evidence catalogue.",
  };
}

/* ── partner dependency evaluation (§7.6) ──────────────────────────────── */

export interface PartnerDependencyContext {
  activePartnerLinks: number;
  activeGrants: number;
  openRecordsRequests: number;
  liveEvidenceDeliveries: number;
  openRefreshObligations: number;
}

/** Which live partner-domain facts block a disposal. The aml-records edge
 * function counts the rows; this function owns the decision, so the rule
 * set is behaviourally testable and identical at dry run and execution.
 * Reasons are INTERNAL — they are never shown to a client or partner. */
export function partnerDependencyBlockers(ctx: PartnerDependencyContext): string[] {
  const blockers: string[] = [];
  if (ctx.activePartnerLinks > 0) blockers.push("active_partner_case_link");
  if (ctx.activeGrants > 0) blockers.push("active_reliance_grant");
  if (ctx.openRecordsRequests > 0) blockers.push("open_partner_records_request");
  if (ctx.liveEvidenceDeliveries > 0) blockers.push("live_evidence_delivery");
  if (ctx.openRefreshObligations > 0) blockers.push("open_refresh_obligation");
  return blockers;
}
