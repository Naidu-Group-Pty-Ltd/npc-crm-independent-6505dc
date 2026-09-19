import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for arrangement governance (Phase 2). Pins the
 * immutability of the assessment history, the additive shape of the
 * agreement extensions, and the server-side placement of the eligibility
 * guard. Synthetic data only.
 */

const repo = join(__dirname, "../../..");
const migration = readFileSync(
  join(repo, "supabase/migrations/20260805110000_aml_arrangement_governance_phase2.sql"), "utf8");
const reliance = readFileSync(
  join(repo, "supabase/functions/aml-reliance/index.ts"), "utf8");

const stripComments = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

const opBlock = (op: string) => {
  const start = reliance.indexOf(`case "${op}"`);
  expect(start).toBeGreaterThan(-1);
  const next = reliance.indexOf('case "', start + 6);
  return reliance.slice(start, next === -1 ? undefined : next);
};

describe("arrangement governance schema (Phase 2 migration)", () => {
  it("extends agreements additively and preserves historical rows and readers", () => {
    const code = stripComments(migration);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS eligibility_classification");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS scope_procedures");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS current_assessment_id");
    // Nothing destructive, no reinterpretation of existing values.
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|RENAME/);
    expect(code).not.toMatch(/UPDATE aml\.reliance_agreements/);
    // Eligibility defaults to unassessed — never a guessed legal value.
    expect(migration).toContain("DEFAULT 'unassessed'");
  });

  it("makes the assessment history append/supersede, never destructive overwrite", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS aml.arrangement_assessments");
    expect(migration).toContain("UNIQUE (agreement_id, assessment_version)");
    expect(migration).toMatch(
      /uq_aml_arrangement_assessment_operative\s*ON aml\.arrangement_assessments \(agreement_id\) WHERE status = 'operative'/);
    expect(migration).toContain("arrangement_assessment_supersede_coherent");
    expect(migration).toContain("superseded_by_id uuid REFERENCES aml.arrangement_assessments(id)");
  });

  it("keeps the new table service-role-only and seeds the enforcement flag OFF", () => {
    expect(migration).toContain("ALTER TABLE aml.arrangement_assessments ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain('"aml_arrangement_assessments_service_only"');
    expect(stripComments(migration)).not.toMatch(/TO authenticated|TO anon/);
    expect(migration).toMatch(/'aml_arrangement_governance', 'false'::jsonb/);
    expect(migration).toContain("-- ROLLBACK:");
  });
});

describe("arrangement governance operations (aml-reliance)", () => {
  it("recording an assessment is MLRO-only and supersedes rather than edits", () => {
    const block = opBlock("record_arrangement_assessment");
    expect(block).toContain("isMlro");
    // Supersede-then-insert: fails closed if interrupted.
    expect(block).toMatch(/status: "superseded", superseded_at[\s\S]{0,600}\.insert\(/);
    expect(block).toContain("superseded_by_id: assessment.id");
    expect(block).toContain("current_assessment_id: assessment.id");
    // The old row's findings/decision are never rewritten.
    const updates = block.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    for (const u of updates) {
      expect(u).not.toMatch(/findings|decision|next_due_at|trigger/);
    }
    // An adverse decision needs reasons.
    expect(block).toContain('decision !== "suitable" && findings.length < 10');
  });

  it("an eligible determination requires a mapped, reliance-capable canonical partner", () => {
    const block = opBlock("update_agreement_scope");
    expect(block).toContain("isMlro");
    expect(block).toContain("partner_org_unresolved");
    expect(block).toContain("partner_classification_required");
    expect(block).toMatch(/eligible_relying_reporting_entity.*eligible_foreign_equivalent/s);
  });

  it("grant_access runs the arrangement guard server-side behind its flag", () => {
    const block = opBlock("grant_access");
    expect(block).toContain("arrangementGovernanceEnforced");
    expect(block).toContain("evaluateArrangementForReliance");
    expect(block).toMatch(/requiredProcedure: "customer_identification"/);
    // Denial returns the guard's partner-safe code; nothing else leaks.
    expect(block).toMatch(/arrangementDecision\.ok[\s\S]{0,200}arrangementDecision\.code/);
    // The legacy review_overdue check is still present for flag-off parity.
    expect(block).toContain("review_overdue");
  });

  it("the independent CDD route stays available: links accept it and no guard gates it", () => {
    const link = opBlock("link_partner_to_case");
    expect(link).toContain("LEGAL_ROUTES");
    // The arrangement guard is applied only inside grant_access (reliance),
    // never in the link ops or the partner token path.
    const partnerPath = reliance.slice(
      reliance.indexOf('if (op === "redeem_attestation"'),
      reliance.indexOf("/* ── staff ops"));
    expect(partnerPath).not.toContain("evaluateArrangementForReliance");
    expect(opBlock("link_partner_to_case")).not.toContain("evaluateArrangementForReliance");
    expect(opBlock("set_partner_case_link_state")).not.toContain("evaluateArrangementForReliance");
  });

  it("historical agreements still load unfiltered for staff readers", () => {
    const block = opBlock("list_agreements");
    expect(block).toContain('select("*")');
    expect(block).not.toMatch(/eq\("eligibility_classification"|not\(/);
  });
});
