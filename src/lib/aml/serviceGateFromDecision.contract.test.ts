import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The service gate is granted by the cleared decision, not asked for twice.
 *
 * ── What was measured ─────────────────────────────────────────────────
 * `aml.service_gate_decisions` held **zero rows across the entire
 * database**. The gate was a second decision — two choices, a ten-character
 * reason and a button on Stage 9 — and it had never once been performed.
 *
 * The platform also disagreed with itself about it. `aml-cases`'
 * `transition` has always mapped `cleared → approved`; `aml-risk`'s
 * `decide` deliberately left the gate alone. Which one a case got depended
 * on which button moved it, so `AML-2026-00005` ended up `status = cleared`
 * with `service_gate_status = under_review`, and its Passport read "Refresh
 * required" for that single reason.
 *
 * ── Why the second act asked no new question ──────────────────────────
 * `set_service_gate`'s approval preconditions and `decide`'s clearance
 * preconditions are the SAME function — `clearanceBlockReasons` — over the
 * same inputs, and `decide` runs it stricter (it passes the open conditions
 * in). Nothing between the two acts could change the answer.
 *
 * These tests read the edge function's source: it cannot be executed here,
 * and the rules below are the ones that keep a removed ceremony from
 * becoming a removed control.
 */

const risk = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const decide = risk.slice(
  risk.indexOf('if (op === "decide")'),
  risk.indexOf('if (op === "clearance_readiness")'));

describe("a cleared decision carries the gate", () => {
  it("it records the gate through the same writer the explicit op uses", () => {
    /* One implementation, or `gate_contract` starts reporting two different
       shapes of the same fact. */
    expect(risk).toContain("async function recordGateDecision(");
    expect((risk.match(/await recordGateDecision\(admin, \{/g) ?? []).length).toBe(2);
    expect(decide).toContain("await recordGateDecision(admin, {");
  });

  it("the row keeps every piece of provenance a gate decision is for", () => {
    const writer = risk.slice(
      risk.indexOf("async function recordGateDecision("),
      risk.indexOf("const GATE_STOPPED_STATUSES"));
    for (const field of [
      "case_id", "status", "effective_at", "conditions", "decision_id",
      "approved_by", "policy_version", "reason",
    ]) {
      expect(writer, field).toContain(`${field}:`);
    }
    // And the audit event is stamped back onto the row, as it always was.
    expect(writer).toContain("audit_event_id: auditEventId");
    expect(writer).toContain('appendCaseEvent(admin, args.caseId, "mlro_decision"');
  });

  it("ONLY a cleared outcome grants it", () => {
    /* A blocked or escalated outcome must never move the gate: a
       restriction stays an explicit, deliberate act. */
    expect(decide).toMatch(/if \(outcome === "cleared" && caseRow/);
    expect(decide).not.toMatch(/outcome === "blocked"[\s\S]{0,120}recordGateDecision/);
  });

  it("a STOPPED gate is never revived", () => {
    /* Locked and terminated are the MLRO's standing restriction and the
       only way a live Passport is suspended or revoked. Re-recording a
       decision must not undo one — the same rule `reopen_case` follows. */
    expect(risk).toContain('const GATE_STOPPED_STATUSES = new Set(["locked", "terminated"])');
    expect(decide).toContain("!GATE_STOPPED_STATUSES.has(String(caseRow.service_gate_status ?? \"\"))");
  });

  it("open conditions mean approved_with_controls, never plain approved", () => {
    expect(decide).toContain('openConditions.length > 0 ? "approved_with_controls" : "approved"');
  });

  it("a gate that could not be written is never silently treated as approved", () => {
    expect(decide).toMatch(/if \(written\.error\)/);
    expect(decide).toContain("Service gate could not be recorded from the cleared decision");
  });
});

describe("what was NOT removed", () => {
  it("`set_service_gate` still exists, with every status and every rule", () => {
    /* The Decision stage's full gate card is how a live Passport is
       suspended or revoked. Removing the ceremony must not remove the
       control. */
    expect(risk).toContain('if (op === "set_service_gate")');
    for (const status of [
      "cdd_incomplete", "information_outstanding", "under_review",
      "conditions_outstanding", "approved_with_controls", "approved",
      "locked", "terminated",
    ]) {
      expect(risk, status).toContain(`"${status}"`);
    }
    expect(risk).toContain("Locking or terminating the service gate requires the MLRO");
    expect(risk).toContain("reason must be at least 10 characters");
  });

  it("the reviewer/MLRO requirement on the decision itself is untouched", () => {
    expect(decide).toContain('if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403)');
  });

  it("clearance still refuses on unresolved mandatory holds", () => {
    expect(decide).toContain("await clearanceBlockReasons(admin, case_id, ass, conds ?? [])");
    expect(decide).toContain("Cannot clear AML case with unresolved mandatory holds");
  });

  it("the full gate card is still mounted on the Decision stage", () => {
    const decisionTab = readFileSync("src/components/aml/CaseWorkspaceTabs.tsx", "utf8");
    expect(decisionTab).toContain("<ServiceGateCard");
    expect(decisionTab).toContain('anchorId="decision-step-gate"');
    // And Stage 9's own route lands on it rather than on a card it no
    // longer mounts.
    const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
    expect(workspace).toContain('document.getElementById("decision-step-gate")');
  });
});

describe("the backfill records a consequence, it does not invent an approval", () => {
  const migration = readFileSync(
    "supabase/migrations/20261015000000_service_gate_from_cleared_decision.sql", "utf8");

  it("every row it writes points at a real cleared decision", () => {
    expect(migration).toContain("v_decision.outcome::text <> 'cleared'");
    expect(migration).toContain("decision_id");
    expect(migration).toContain("v_decision.decided_by");
    // The decision's own timestamp, not "now" — the gate took effect then.
    expect(migration).toContain("v_decision.decided_at");
    expect(migration).toMatch(/Recorded from the cleared compliance decision/);
  });

  it("it never revives a stopped gate, and never rewrites an existing one", () => {
    expect(migration).toContain("'approved', 'approved_with_controls', 'locked', 'terminated'");
    expect(migration).toContain("not exists (");
    expect(migration).toContain("from aml.service_gate_decisions g where g.case_id = c.id");
  });

  it("it follows the CURRENT decision, never a superseded one", () => {
    expect(migration).toMatch(/order by d\.decided_at desc\s*\n\s*limit 1;/);
  });

  it("open conditions still mean approved_with_controls", () => {
    expect(migration).toContain("jsonb_array_length(v_conditions) > 0");
    expect(migration).toContain("'approved_with_controls'");
  });
});
