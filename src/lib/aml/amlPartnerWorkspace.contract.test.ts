import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for the shared partner workspace (Phase 4): the
 * additive migration, the session-derived organisation scoping, the
 * flag gating, and the origin-review controls. Synthetic data only.
 */

const repo = join(__dirname, "../../..");
const migration = readFileSync(
  join(repo, "supabase/migrations/20260805130000_aml_partner_workspace_phase4.sql"), "utf8");
const reliance = readFileSync(
  join(repo, "supabase/functions/aml-reliance/index.ts"), "utf8");

const stripComments = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

/** The first-party workspace section of the function source. */
const workspaceSection = reliance.slice(
  reliance.indexOf("if (PARTNER_WORKSPACE_OPS.has(op))"),
  reliance.indexOf('/* ── partner ops: bearer token'));
const resolverSection = reliance.slice(
  reliance.indexOf("async function resolvePartnerPortalContext"),
  reliance.indexOf("const __corsWrappedHandler"));

describe("partner workspace schema (Phase 4 migration)", () => {
  it("adds independent_cdd_required as a superset CHECK and keeps history append-only", () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT independent_assessments_status_check CHECK \(status IN\s*\('open', 'satisfied', 'not_satisfied', 'records_requested', 'independent_cdd_required'\)\)/);
    // Widening only: grant/agreement/hash become nullable, nothing narrows.
    expect(migration).toContain("ALTER COLUMN grant_id DROP NOT NULL");
    expect(migration).toContain("ALTER COLUMN agreement_id DROP NOT NULL");
    expect(migration).toContain("ALTER COLUMN based_on_attestation_sha256 DROP NOT NULL");
    expect(stripComments(migration)).not.toMatch(/SET NOT NULL|DROP TABLE(?! IF EXISTS aml\.partner)/);
    // Attestation-responsive outcomes stay pinned to the exact hash.
    expect(migration).toMatch(
      /independent_assessment_hash_coherent CHECK \(\s*status = 'independent_cdd_required' OR based_on_attestation_sha256 IS NOT NULL\s*\)/);
    // No destructive rewrite of existing determinations.
    expect(stripComments(migration)).not.toMatch(/UPDATE aml\.independent_assessments/);
  });

  it("creates controlled requests with closed codes, rationale and review coherence", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS aml.partner_records_requests");
    expect(migration).toContain("char_length(btrim(rationale)) >= 10");
    expect(migration).toMatch(/status text NOT NULL DEFAULT 'submitted' CHECK \(status IN\s*\('draft', 'submitted', 'under_review', 'approved', 'partly_approved',\s*'denied', 'delivered', 'expired', 'cancelled'\)\)/);
    expect(migration).toContain("partner_records_request_review_coherent");
  });

  it("the delivery read model has no storage-location column, by design", () => {
    const deliveryBlock = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS aml.partner_evidence_deliveries"),
      migration.indexOf("idx_aml_partner_evidence_deliveries_link"));
    expect(stripComments(deliveryBlock)).not.toMatch(/storage_path|object_path|bucket|url/i);
    expect(deliveryBlock).toContain("expires_at timestamptz NOT NULL");
  });

  it("both new tables are service-role only and all five flags seed false", () => {
    expect(migration).toContain("ALTER TABLE aml.partner_records_requests ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE aml.partner_evidence_deliveries ENABLE ROW LEVEL SECURITY");
    expect(stripComments(migration)).not.toMatch(/TO authenticated|TO anon/);
    for (const flag of [
      "aml_partner_compliance_workspace", "aml_partner_workspace_finance",
      "aml_partner_workspace_builder", "aml_partner_workspace_developer",
      "aml_partner_workspace_solicitor",
    ]) {
      expect(migration).toMatch(new RegExp(`'${flag}', 'false'::jsonb`));
    }
    expect(migration).toContain("-- ROLLBACK:");
  });
});

describe("session-derived organisation scoping (aml-reliance)", () => {
  it("identity comes only from the portal session resolvers", () => {
    expect(resolverSection).toContain("resolveFinancePartner");
    expect(resolverSection).toContain("resolveSolicitorSession");
    /* The builder resolver left with the portal (network extraction
       Phase 7): there is no builder portal cookie to resolve any more, so
       the builder surface answers the moved refusal instead of resolving —
       and never reaches a membership walk it could get wrong. */
    expect(resolverSection).not.toContain("resolveBuilderSession");
    expect(resolverSection).toContain('"portal_moved"');
    // The request body never contributes an organisation or tenant.
    expect(stripComments(resolverSection)).not.toMatch(/body\.(partner_org_id|tenant_id|organisation_id|org_id|firm_id)/);
    expect(stripComments(workspaceSection)).not.toMatch(/body\.(partner_org_id|tenant_id|organisation_id|org_id|firm_id)/);
  });

  it("membership is mandatory and the session organisation must match the canonical record", () => {
    expect(resolverSection).toContain('eq("portal_user_source", source)');
    expect(resolverSection).toContain('eq("status", "active")');
    expect(resolverSection).toContain("membership_missing");
    expect(resolverSection).toMatch(/solicitor_firm_id === sessionSolicitorFirmId/);
    expect(resolverSection).toMatch(/finance_agent_contact_id === sessionFinanceContactId/);
    // Ambiguity fails closed — organisations are never guessed.
    expect(resolverSection).toContain("partner_org_ambiguous");
  });

  it("each surface serves only its own portal types; builder covers developer organisations", () => {
    expect(reliance).toMatch(/finance: \["finance"\]/);
    expect(reliance).toMatch(/builder: \["builder", "developer"\]/);
    expect(reliance).toMatch(/solicitor_conveyancer: \["solicitor_conveyancer"\]/);
    // Links are loaded scoped to org AND surface, absence answers 404.
    expect(reliance).toMatch(/loadScopedPartnerLink[\s\S]{0,400}eq\("partner_org_id", partnerOrgId\)/);
    expect(reliance).toMatch(/SURFACE_PORTAL_TYPES\[surface\]\.includes\(link\.portal_type\)/);
  });

  it("every workspace op is behind the master AND surface flags, default off", () => {
    expect(workspaceSection).toContain('flagEnabled(admin, "aml_partner_compliance_workspace")');
    expect(workspaceSection).toContain("WORKSPACE_PORTAL_FLAGS");
    expect(workspaceSection).toMatch(/if \(!masterOn \|\| !surfaceOn\)[\s\S]{0,120}workspace_disabled/);
  });

  it("no bearer token and no browser storage enters the first-party path", () => {
    expect(workspaceSection).not.toContain("access_token");
    expect(workspaceSection).not.toContain("rawToken");
  });
});

describe("workspace operations stay inside the boundary", () => {
  it("workspace ops never write the originating case, risk or gate", () => {
    const code = stripComments(workspaceSection);
    expect(code).not.toMatch(/from\("cases"\)[\s\S]{0,120}\.(update|insert|upsert|delete)/);
    expect(code).not.toMatch(/risk_assessments|service_gate_decisions|analyst_recommendations|screening/);
  });

  it("prohibited record codes are rejected before any row exists", () => {
    expect(workspaceSection).toContain("evaluateRecordsRequestScope");
    expect(workspaceSection).toContain("record_codes_prohibited");
  });

  it("determinations run through the shared validator and append, never update", () => {
    expect(workspaceSection).toContain("validatePartnerDetermination");
    const determinationBlock = workspaceSection.slice(
      workspaceSection.indexOf('op === "record_partner_determination"'),
      workspaceSection.indexOf('op === "list_partner_evidence_deliveries"'));
    expect(determinationBlock).toContain('from("independent_assessments").insert');
    expect(determinationBlock).not.toMatch(/independent_assessments"\)\s*\.update/);
  });

  it("the DTO is built by the shared constructor and content is disclosed only when logged", () => {
    expect(workspaceSection).toContain("buildPartnerWorkspaceDto");
    expect(workspaceSection).toContain("evaluateManifestForRead");
    expect(workspaceSection).toContain("intersectPayloadWithManifest");
    /* The property is that DISCLOSURE IMPLIES A LOG ENTRY, and it now covers
       two kinds of disclosure: the manifest-intersected procedure content and
       the Passport document itself. Reading a Passport in a portal is the
       same act as redeeming a token, so it leaves the same audit row — and
       the condition names both, so adding a third disclosure without logging
       it fails here. */
    expect(workspaceSection).toMatch(
      /if \(grant && \(dto\.procedures \|\| passportView\)\)[\s\S]{0,400}reliance_access_log/);
    expect(workspaceSection).toContain("passport_disclosed: Boolean(passportView)");
    expect(workspaceSection).toContain("procedures_disclosed: Boolean(dto.procedures)");
  });

  it("the in-portal Passport is the SAME projection the emailed link serves", () => {
    /* One record is a property of one implementation, not of two agreeing.
       A portal-specific projection here would be how "identical" quietly
       stops being true. */
    expect(workspaceSection).toContain('buildCasePassportView(admin, link.case_id, "partner")');
    // And it is disclosed only when the grant and attestation permit it —
    // decided by the shared rule, never by the page or by the surface mode.
    expect(workspaceSection).toContain("passportDisclosure({");
    expect(workspaceSection).toContain("disclosure.disclosable");
  });

  it("the audit receipt is deep-checked before it leaves the server", () => {
    const receiptBlock = workspaceSection.slice(
      workspaceSection.indexOf('op === "get_partner_audit_receipt"'));
    expect(receiptBlock).toContain("findRestrictedKeys(receipt)");
  });
});

describe("origin review controls (Command Center)", () => {
  const opBlock = (op: string) => {
    const start = reliance.indexOf(`case "${op}"`);
    expect(start).toBeGreaterThan(-1);
    const next = reliance.indexOf('case "', start + 6);
    return reliance.slice(start, next === -1 ? undefined : next);
  };

  it("reviewing and delivering are MLRO-only with strict code-subset rules", () => {
    const review = opBlock("review_partner_records_request");
    expect(review).toContain("isMlro");
    expect(review).toMatch(/\.filter\(\(c\) => requested\.includes\(c\)\)/);
    expect(review).toContain("Full approval must approve every requested code");
    expect(review).toContain("Partial approval needs a non-empty strict subset");
    expect(review).toContain("A denial approves nothing");
    const delivery = opBlock("record_partner_evidence_delivery");
    expect(delivery).toContain("isMlro");
    expect(delivery).toContain("That record code was not approved on this request.");
  });
});
