import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for the Stage B controlled evidence-access path and
 * the Stage A classification correction as wired into the running code.
 *
 * Exit-gate properties: the caller can never choose an organisation or
 * tenant; every one of the required authorisation checks exists and runs
 * BEFORE storage resolution; the signed URL is short-lived, single-shot and
 * never persisted; bucket names and permanent paths never leave the server;
 * every attempt — approved or denied — is logged with a safe result code;
 * and the P4/P5/P6 boundary is categorical.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const fn = read("supabase/functions/aml-reliance/index.ts");
const migration = read("supabase/migrations/20260828000000_aml_record_classification_correction.sql");
const workspaceModule = read("supabase/functions/_shared/aml/partnerWorkspace.ts");
const clientFactory = read("src/lib/partnerWorkspaceClient.ts");
const panel = read("src/components/partner-compliance/EvidenceDeliveriesPanel.tsx");
const orchestrator = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
const records = read("supabase/functions/aml-records/index.ts");

const accessOp = fn.slice(
  fn.indexOf('op === "get_partner_evidence_delivery_access"'),
  fn.indexOf('op === "list_partner_refresh_obligations"'));
const deliveryStaffOp = fn.slice(
  fn.indexOf('case "record_partner_evidence_delivery"'),
  fn.indexOf("/* ── reliable events"));

describe("authorisation: identity comes from the session, never the body", () => {
  it("the op sits inside the flag-gated, session-resolved workspace set", () => {
    expect(fn).toContain('"get_partner_evidence_delivery_access"');
    // The workspace gate (master + surface flags + resolvePartnerPortalContext)
    // runs before any PARTNER_WORKSPACE_OPS handler, including this one.
    expect(fn).toMatch(/if \(PARTNER_WORKSPACE_OPS\.has\(op\)\) \{/);
  });

  it("every scoping filter uses the resolved organisation and link — no body identifier", () => {
    expect(accessOp).toContain('.eq("partner_case_link_id", link.id).eq("partner_org_id", partnerOrg.id)');
    expect(accessOp).not.toContain("body.partner_org_id");
    expect(accessOp).not.toContain("body.tenant_id");
    expect(accessOp).not.toContain("body.case_id");
    expect(accessOp).toContain("loadScopedPartnerLink(admin, String(body.partner_case_link_id");
  });

  it("the full required check sequence is present", () => {
    for (const check of [
      'flagEnabled(admin, "aml_partner_evidence_delivery_write")',   // action flag
      'link.state !== "active"',                                     // active link
      'membership.compliance_role !== "compliance_officer"',         // partner role
      "retrievalReason.length < 10",                                 // reason
      "EVIDENCE_ACCESS_RATE_LIMIT",                                  // rate limit
      '"catalogue_inconsistent"',                                    // fail-closed catalogue tripwire
      "delivery.revoked_at",                                         // revocation
      "new Date(delivery.expires_at).getTime() <= Date.now()",       // expiry
      'request.partner_org_id !== partnerOrg.id',                    // request belongs to org
      '["approved", "partly_approved", "delivered"].includes(request.status)',
      "(request.approved_record_codes ?? []).includes(delivery.record_code)", // exact code approved
      "evaluateEvidenceObjectDelivery(",                             // P3-only class rule
      '"arrangement_inactive"',                                      // legal route / arrangement
      '"manifest_revoked"',                                          // manifest kill switch
      '"evidence_temporarily_unavailable"',                          // hold withholds, generically
      "delivery.evidence_document_id",                               // opaque reference required
      'doc.case_id !== link.case_id',                                // tenant/case ownership
      'doc.status !== "accepted"',                                   // reviewed objects only
    ]) {
      expect(accessOp).toContain(check);
    }
  });

  it("a legal hold denies with GENERIC wording — its existence is never disclosed", () => {
    const holdMessage = "This record is temporarily unavailable. Contact the issuing organisation if it remains needed.";
    expect(accessOp).toContain(holdMessage);
    expect(holdMessage).not.toMatch(/hold|investigation|legal/i);
    // The partner-facing denial code is neutral too.
    expect(accessOp).toContain('"evidence_temporarily_unavailable"');
  });

  it("storage resolution happens only AFTER every check — the signing call is the last data access", () => {
    const signAt = accessOp.indexOf("createSignedUrl");
    expect(signAt).toBeGreaterThan(-1);
    for (const check of ["rate_limited", "delivery_revoked", "record_code_not_approved",
      "arrangement_inactive", "evidence_temporarily_unavailable", "evidence_object_unavailable"]) {
      expect(accessOp.indexOf(check)).toBeLessThan(signAt);
    }
  });
});

describe("signed-access controls", () => {
  it("expiry is a server constant the body cannot lengthen", () => {
    expect(fn).toContain("const EVIDENCE_ACCESS_TTL_SECONDS = 300;");
    expect(accessOp).toContain("createSignedUrl(doc.storage_path, EVIDENCE_ACCESS_TTL_SECONDS");
    expect(accessOp).not.toMatch(/body\.(ttl|expiry|expires|duration)/);
  });

  it("the signed URL is returned once and never persisted", () => {
    // The only reference to the signed URL is the null-check and the
    // response body — no insert/update/log ever carries it.
    const uses = accessOp.match(/signed\.signedUrl|signed\?\.signedUrl/g) ?? [];
    expect(uses.length).toBe(2);
    const logCalls = accessOp.match(/logAttempt\([\s\S]*?\)\;/g) ?? [];
    for (const call of logCalls) expect(call).not.toContain("signedUrl");
    expect(accessOp).not.toMatch(/insert\([^)]*signedUrl|update\([^)]*signedUrl/);
  });

  it("the bucket name lives only inside this operation and the pre-existing document op", () => {
    // aml-documents appears in aml-cases (pre-existing) and here — never in
    // a response body, DTO, event payload or client file.
    expect(accessOp).toContain('from("aml-documents")');
    expect(clientFactory).not.toContain("aml-documents");
    expect(workspaceModule).not.toContain("aml-documents");
    expect(panel).not.toContain("aml-documents");
  });

  it("responses carry filename, MIME and expiry — never a path or bucket", () => {
    const responseBlock = accessOp.slice(accessOp.indexOf("return jr({\n          access: {"));
    expect(responseBlock).toContain("filename: doc.filename");
    expect(responseBlock).toContain("expires_at: expiresAt");
    expect(responseBlock).not.toContain("storage_path");
    expect(responseBlock).not.toContain("bucket");
  });

  it("workspace DTOs, audit receipts and outbox payloads carry no signed URL or path", () => {
    expect(workspaceModule).not.toMatch(/signedUrl|signed_url/);
    const receiptOp = fn.slice(
      fn.indexOf('op === "get_partner_audit_receipt"'),
      fn.indexOf("/* ── partner ops: bearer token"));
    expect(receiptOp).not.toMatch(/signedUrl|storage_path|aml-documents/);
    // Outbox payloads are guarded structurally: the SQL tripwire refuses
    // any payload key matching storage_path/signed_url at every depth, and
    // no trigger builds such a key.
    const migration6 = read("supabase/migrations/20260805140000_aml_partner_events_phase6.sql");
    expect(migration6).toMatch(/storage_path\|bucket\|signed_url/);
    expect(migration6).not.toMatch(/jsonb_build_object\([^)]*(storage_path|signed_url)/);
  });

  it("failed storage resolution answers a safe error and records the attempt", () => {
    expect(accessOp).toContain('"storage_resolution_failed"');
    expect(accessOp).toContain('"evidence_access_failed"');
    expect(accessOp).toContain('logAttempt("failed"');
  });
});

describe("access logging", () => {
  it("every attempt logs actor, organisation, membership, portal, link, delivery, reason and result", () => {
    for (const field of [
      "actor_label: `${partnerOrg.legal_name}",
      "membership_id: membership.id",
      "portal: surface",
      "partner_case_link_id: link?.id",
      "delivery_id: deliveryId",
      "retrieval_reason: retrievalReason",
      "result,",
    ]) {
      expect(accessOp).toContain(field);
    }
    expect(accessOp).toContain('action: "evidence_access"');
    // Approvals additionally record the signed expiry (not the URL) and
    // append the immutable case event.
    expect(accessOp).toContain("signed_expiry: expiresAt");
    expect(accessOp).toContain("appendCaseEvent(admin, link.case_id");
  });

  it("the migration widens the access log for grant-less workspace access", () => {
    expect(migration).toContain("ALTER COLUMN grant_id DROP NOT NULL");
    expect(migration).toContain("'evidence_access'");
  });
});

describe("delivery recording (staff side)", () => {
  it("an attached evidence object must exist, match the request's case and be accepted", () => {
    expect(deliveryStaffOp).toContain("body.evidence_document_id");
    expect(deliveryStaffOp).toContain('doc.case_id !== request.case_id');
    expect(deliveryStaffOp).toContain('"evidence_case_mismatch"');
    expect(deliveryStaffOp).toContain('doc.status !== "accepted"');
  });

  it("the delivery table still carries no path — only the opaque document id", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES aml.documents(id)");
    expect(deliveryStaffOp).not.toContain("storage_path");
  });
});

describe("retention invariants survive the reclassification", () => {
  it("legal holds still block disposal at dry run and execution", () => {
    expect(records).toContain("await activeHoldFor(");
    expect(records).toContain("Held at execution");
  });

  it("necessity clocks and object-before-pointer destruction are untouched", () => {
    expect(records).toContain("raw_id_copy_necessity_end");
    expect(records).toContain("biometric_necessity_end");
    const dispose = records.slice(
      records.indexOf("async function disposeBiometric"),
      records.indexOf("// Phase 11 (§18)"));
    expect(dispose.indexOf(".remove([check.biometric_storage_path])"))
      .toBeLessThan(dispose.indexOf("biometric_storage_path: null"));
  });
});

describe("shared UI (all four adapters, one implementation)", () => {
  it("the panel mounts through the shared orchestrator behind the deliveries slot", () => {
    /* The slot is now resolved through `partnerWorkspacePanels`, which masks
       the surface mode OVER the adapter — every optional panel is
       `full && Boolean(adapter.<slot>)`, so the adapter remains the ceiling
       and a mode can only ever subtract. A portal that never permitted
       deliveries still cannot acquire them. */
    expect(orchestrator).toContain("partnerWorkspacePanels(surfaceMode, adapter.panels)");
    expect(orchestrator).toContain("{panels.deliveries && (");
    expect(orchestrator).toContain("<EvidenceDeliveriesPanel");
    const rule = readFileSync(
      "supabase/functions/_shared/aml/partnerSurface.pure.ts", "utf8");
    expect(rule).toContain("deliveries: full && Boolean(adapter.deliveries)");
  });

  it("nothing auto-opens and no transport method means no access control at all", () => {
    expect(panel).not.toContain("window.open");
    expect(panel).not.toMatch(/useEffect\([^)]*getEvidenceAccess/);
    expect(panel).toContain('typeof client.getEvidenceAccess === "function"');
  });

  it("inaccessible evidence never renders an active access control", () => {
    expect(panel).toContain('state === "available" && canRequestAccess');
    expect(panel).toMatch(/state !== "available" && \(/);
  });

  it("status is text, controls are labelled, the reason gate is enforced client-side too", () => {
    expect(panel).toContain("{state}");
    expect(panel).toContain("aria-label={`Request temporary access to");
    expect(panel).toContain("reason.trim().length < 10");
    expect(panel).toContain('rel="noopener noreferrer"');
    expect(panel).toContain('role="status"');
    expect(panel).toContain('role="alert"');
  });

  it("expiry is announced in text alongside the link", () => {
    expect(panel).toContain("access expires at");
    expect(panel).toContain("The link is not stored");
  });
});
