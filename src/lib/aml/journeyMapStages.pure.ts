/**
 * The Compliance Journey Map's four nodes, each answered by ITS OWN
 * dimension. "We verify" and "Approved" used to complete only when the
 * SERVICE GATE was approved — so a case that was verified, decided and
 * cleared at Stage 8 still showed both pulsing as in-progress, which read
 * as work not done. The gate is service entitlement, not verification and
 * not the decision:
 *
 *   Submit   → client-portal progress
 *   Verify   → the case has moved past KYC into decision territory
 *   Approve  → the human decision (canonical stage, legacy status
 *              dual-read like everywhere else) — or an approved gate,
 *              which can only follow one
 *   Share    → an issued attestation with at least one live grant
 *
 * Presentation arithmetic only — nothing here writes, decides or infers
 * from risk.
 */
import type { AmlCase } from "./amlCasesApi";
import { caseStage } from "./caseDimensions";

export type JourneyMapStageState = "done" | "active" | "todo";

export function stageStates(
  caseRow: AmlCase, hasAttestation: boolean, activeGrants: number,
): JourneyMapStageState[] {
  const portal = String(caseRow.client_portal_status ?? "not_started");
  const gate = String(caseRow.service_gate_status ?? "");
  const stage = caseStage(caseRow);
  const submitted = ["submitted", "under_review", "complete"].includes(portal)
    || !["draft", "kyc_in_progress"].includes(String(caseRow.status));
  const gateApproved = ["approved", "approved_with_controls"].includes(gate);
  const cleared = stage === "cleared" || stage === "cleared_with_conditions"
    || String(caseRow.status) === "cleared";
  const decisionDone = cleared || gateApproved;
  // Verification is complete once the case reaches the decision — either
  // waiting on one or holding one. A blocked case was verified too: the
  // checks ran; the decision went against the customer.
  const verified = decisionDone
    || ["decision_pending", "blocked"].includes(stage)
    || ["under_review", "escalated_mlro", "blocked"].includes(String(caseRow.status));
  const shared = hasAttestation && activeGrants > 0;

  const submit: JourneyMapStageState = submitted ? "done" : "active";
  const verify: JourneyMapStageState = verified ? "done" : submitted ? "active" : "todo";
  const approve: JourneyMapStageState = decisionDone ? "done" : verified || submitted ? "active" : "todo";
  const share: JourneyMapStageState = shared ? "done" : decisionDone ? "active" : "todo";
  return [submit, verify, approve, share];
}
