import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for the canonical partner identity domain (Phase 1)
 * and its extensions (Phases 2–3). Same idiom as amlPortalContracts.test.ts:
 * the migration and edge-function sources are the contract; these tests pin
 * the security-relevant properties so a refactor cannot silently weaken
 * them. Synthetic data only — no identifier below refers to a real
 * organisation or person.
 */

const repo = join(__dirname, "../../..");
const migration = readFileSync(
  join(repo, "supabase/migrations/20260805100000_aml_partner_identity_phase1.sql"), "utf8");
const reliance = readFileSync(
  join(repo, "supabase/functions/aml-reliance/index.ts"), "utf8");
const guard = readFileSync(
  join(repo, "supabase/functions/_shared/aml/relianceEligibility.ts"), "utf8");

const stripComments = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

describe("partner identity schema (Phase 1 migration)", () => {
  it("creates the four partner tables plus nullable reliance references only", () => {
    for (const t of [
      "aml.partner_organisations", "aml.partner_portal_memberships",
      "aml.partner_case_links", "aml.partner_org_name_mappings",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
    expect(migration).toContain(
      "ALTER TABLE aml.reliance_agreements\n  ADD COLUMN IF NOT EXISTS partner_org_id uuid");
    expect(migration).toContain(
      "ALTER TABLE aml.reliance_grants\n  ADD COLUMN IF NOT EXISTS partner_case_link_id uuid");
    // Additive only: nothing is dropped, renamed or destructively updated.
    const code = stripComments(migration);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN|RENAME/);
    expect(code).not.toMatch(/UPDATE aml\.reliance_agreements/);
    // The free-text name survives verbatim into the review queue.
    expect(code).toContain("ra.partner_org_name");
  });

  it("keeps every partner table service-role-only with RLS enabled", () => {
    for (const t of [
      "partner_organisations", "partner_portal_memberships",
      "partner_case_links", "partner_org_name_mappings",
    ]) {
      expect(migration).toContain(`ALTER TABLE aml.${t} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("FOR ALL TO service_role USING (true) WITH CHECK (true)");
    // No browser grant, ever — not even an inert one.
    expect(stripComments(migration)).not.toMatch(/TO authenticated|TO anon/);
  });

  it("makes a reliance-capable classification structurally unusable without evidence", () => {
    expect(migration).toContain("partner_org_reliance_class_requires_evidence");
    expect(migration).toMatch(
      /reporting_entity_classification NOT IN\s*\('eligible_relying_reporting_entity', 'eligible_foreign_equivalent'\)\s*OR \(classification_evidence_reference IS NOT NULL/);
    expect(migration).toContain("DEFAULT 'unclassified'");
  });

  it("keeps the four legal routes distinct and requires a documented purpose", () => {
    expect(migration).toMatch(
      /legal_route text NOT NULL CHECK \(legal_route IN\s*\('reliance', 'outsourced_cdd', 'independent_cdd', 'information_share_only'\)\)/);
    expect(migration).toContain("char_length(btrim(purpose)) >= 10");
  });

  it("enforces one ACTIVE link per case × organisation × role without banning multiple roles", () => {
    expect(migration).toMatch(
      /uq_aml_partner_case_link_active\s*ON aml\.partner_case_links \(case_id, partner_org_id, relationship_role\)\s*WHERE state = 'active'/);
  });

  it("backfills only exact-copy pending review candidates — no fuzzy matching, no auto-mapping", () => {
    // The seed copies the agreement's own values verbatim…
    expect(migration).toMatch(
      /INSERT INTO aml\.partner_org_name_mappings\s*\(agreement_id, original_name, original_org_type, original_abn\)\s*SELECT ra\.id, ra\.partner_org_name, ra\.partner_org_type, ra\.partner_abn/);
    // …and never proposes an organisation: mapping is a human decision.
    const code = stripComments(migration);
    expect(code).not.toMatch(/proposed_partner_org_id\s*[,)]?\s*(SELECT|=)/);
    expect(code).not.toMatch(/similarity|levenshtein|ILIKE|fuzzy/i);
    // A row cannot be 'mapped' without a target and a named reviewer.
    expect(migration).toContain("partner_mapping_requires_reviewer");
  });

  it("seeds the enforcement flag OFF and documents rollback", () => {
    expect(migration).toMatch(/'aml_partner_identity', 'false'::jsonb/);
    expect(migration).toContain("-- ROLLBACK:");
  });
});

describe("partner identity operations (aml-reliance)", () => {
  const opBlock = (op: string) => {
    const start = reliance.indexOf(`case "${op}"`);
    expect(start).toBeGreaterThan(-1);
    const next = reliance.indexOf('case "', start + 6);
    return reliance.slice(start, next === -1 ? undefined : next);
  };

  it("gates classification and organisation writes to the MLRO", () => {
    for (const op of ["upsert_partner_organisation", "classify_partner_organisation",
      "upsert_partner_membership", "resolve_partner_mapping"]) {
      expect(opBlock(op)).toContain("isMlro");
    }
  });

  it("gates link creation and state changes to reviewer or MLRO", () => {
    for (const op of ["link_partner_to_case", "set_partner_case_link_state"]) {
      expect(opBlock(op)).toMatch(/isMlro \|\| roles\.has\("reviewer"\)/);
    }
  });

  it("requires evidence before recording a reliance-capable classification", () => {
    const block = opBlock("classify_partner_organisation");
    expect(block).toContain("classification_evidence_required");
    expect(block).toMatch(/eligible_relying_reporting_entity.*eligible_foreign_equivalent/s);
  });

  it("validates the purchase file belongs to the case client before linking", () => {
    const block = opBlock("link_partner_to_case");
    expect(block).toContain("Purchase file is not linked to this AML case client");
    expect(block).toMatch(/caseRow\.purchase_file_id.*!==.*pfId/s);
    expect(block).toContain("legal_route");
    expect(block).toContain("never inferred from portal type");
  });

  it("verifies a membership maps a REAL portal user in its home table", () => {
    const block = opBlock("upsert_partner_membership");
    expect(block).toMatch(/admin\.from\(source\)\s*\.select\("id"\)\.eq\("id", portalUserId\)/);
    expect(block).toContain("Portal user not found");
  });

  it("resolve_partner_mapping requires a pending row, an exact type match and records the reviewer", () => {
    const block = opBlock("resolve_partner_mapping");
    expect(block).toContain('mapping.status !== "pending"');
    expect(block).toContain("mapping_type_mismatch");
    expect(block).toContain("mapped_by: userId");
  });

  it("grant_access enforces the canonical link under the flag and stamps the grant", () => {
    const block = opBlock("grant_access");
    expect(block).toContain("partnerIdentityEnforced");
    expect(block).toContain("evaluatePartnerLinkForReliance");
    // The organisation comes from the STORED agreement, never the request.
    expect(block).toContain("agreement.partner_org_id");
    expect(stripComments(block)).not.toContain("body.partner_org_id");
    // Denial surfaces the guard's partner-safe code and blocks the grant
    // whenever enforcement is on.
    expect(block).toMatch(/} else if \(enforced\) {[\s\S]{0,300}code: decision\.code/);
    expect(block).toContain("grantInsert.partner_case_link_id = linkForGrant.id");
  });

  it("partner token ops never accept a caller-supplied organisation identity", () => {
    const partnerPath = reliance.slice(
      reliance.indexOf('if (op === "redeem_attestation"'),
      reliance.indexOf("/* ── staff ops"));
    expect(stripComments(partnerPath)).not.toMatch(/body\.(partner_org_id|tenant_id|org_id)/);
    // And the partner path still cannot write to the origin case.
    expect(partnerPath).not.toMatch(/from\("cases"\)[\s\S]{0,80}\.update/);
  });

  it("the guard module is pure — importable by both Deno and vitest", () => {
    expect(guard).not.toMatch(/Deno\.|import\s/);
    expect(guard).toContain("export function evaluatePartnerLinkForReliance");
  });
});
