import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlRiskFactor = {
  id: string; key: string; label: string; category: "mltf" | "completion" | "verification" | string;
  weight: number; active: boolean; scoring: Record<string, number>; description?: string | null;
};
export type AmlMandatoryTrigger = {
  id: string; key: string; label: string; description?: string | null;
  severity: "block" | "hold"; rule: Record<string, any>; active: boolean;
};
export type AmlRiskAssessment = {
  id: string; case_id: string; completion_score: number; verification_score: number;
  mltf_score: number; risk_rating: "low" | "medium" | "high" | "prohibited" | null;
  triggered_holds: Array<{ key: string; label: string; severity: "block" | "hold" }>;
  factor_breakdown: Array<{ key: string; label: string; input: any; score: number; weight: number; weighted: number }>;
  inputs: Record<string, any>; computed_by: string | null; created_at: string;
  program_version?: string | null;
  policy_snapshot_hash?: string | null;
  straight_through?: boolean;
  explanation?: {
    top_positive?: Array<{ key: string; label: string; weighted: number; input: any }>;
    top_neutral_missing?: Array<{ key: string; label: string }>;
    trigger_reasons?: Array<{ key: string; label: string; severity: string }>;
    rating_band?: string;
    thresholds?: Record<string, number>;
  };
};
export type AmlRiskOverride = {
  id: string; case_id: string; assessment_id: string | null; requested_by: string;
  requested_reason: string; requested_rating: string | null;
  status: "pending" | "approved" | "rejected"; reviewer_id: string | null;
  reviewer_note: string | null; decided_at: string | null; created_at: string;
};
export type AmlDecision = {
  id: string; case_id: string; assessment_id: string | null;
  outcome: "cleared" | "blocked" | "escalated" | "conditional";
  rationale: string | null; snapshot: any; snapshot_hash: string;
  decided_by: string; decided_at: string;
  program_version?: string | null;
  is_straight_through?: boolean;
};
export type AmlStraightThroughConfig = {
  enabled: boolean;
  max_mltf_score?: number;
  require_completion_score?: number;
  require_verification_score?: number;
  disallow_holds?: boolean;
};
export type AmlPolicySnapshot = {
  program_version: string;
  straight_through_config: AmlStraightThroughConfig;
  policy_snapshot_hash: string;
  factors: AmlRiskFactor[];
  triggers: AmlMandatoryTrigger[];
  tenant_id: string;
};

export type AmlApproval = {
  id: string; case_id: string; decision_id: string | null; kind: string;
  status: "pending" | "approved" | "rejected"; requested_by: string;
  approver_id: string | null; note: string | null; requested_at: string; resolved_at: string | null;
};
export type AmlCaseCondition = {
  id: string; case_id: string; label: string; detail: string | null;
  status: "open" | "resolved" | "waived"; created_by: string | null;
  resolved_by: string | null; resolved_at: string | null; created_at: string; updated_at: string;
};
export type AmlGateStatus = {
  enabled: boolean; purchase_ready: boolean;
  diagnostic: {
    purchase_ready: boolean; reasons: string[];
    latest_decision: AmlDecision | null;
    open_conditions: AmlCaseCondition[];
    latest_assessment: AmlRiskAssessment | null;
  };
};

/** Phase 8 — analyst recommendation (§12.8). */
export type AmlAnalystRecommendation = {
  id: string; case_id: string; assessment_id: string | null;
  recommended_outcome: "cleared" | "cleared_with_conditions" | "edd_required" | "escalated" | "blocked";
  rationale: string; status: "pending" | "superseded" | "actioned";
  actioned_decision_id: string | null; created_by: string; created_at: string;
};

/** Phase 8 — service-gate contract (Appendix C.4). */
export type AmlServiceGateContract = {
  status: string;
  effective_at: string | null;
  conditions: Array<{ id?: string; label: string; status?: string }>;
  decision_id: string | null;
  approved_by: string | null;
  policy_version: string | null;
  audit_event_id: string | null;
  reason: string | null;
};

export type AmlRecalcStatus = {
  stale: boolean;
  reasons: string[];
  latest_assessment_at: string | null;
};

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-risk", payload);
}

export const amlRiskApi = {
  listFactors: () => invoke<{ factors: AmlRiskFactor[] }>({ op: "list_factors" }),
  upsertFactor: (factor: Partial<AmlRiskFactor>) => invoke<{ factor: AmlRiskFactor }>({ op: "upsert_factor", factor }),
  listTriggers: () => invoke<{ triggers: AmlMandatoryTrigger[] }>({ op: "list_triggers" }),
  upsertTrigger: (trigger: Partial<AmlMandatoryTrigger>) => invoke<{ trigger: AmlMandatoryTrigger }>({ op: "upsert_trigger", trigger }),

  evaluate: (case_id: string, inputs: Record<string, any>) =>
    invoke<{ assessment: AmlRiskAssessment; auto_decision: AmlDecision | null; program_version: string; straight_through: boolean }>({ op: "evaluate", case_id, inputs }),
  listAssessments: (case_id: string) => invoke<{ assessments: AmlRiskAssessment[] }>({ op: "list_assessments", case_id }),


  requestOverride: (p: { case_id: string; assessment_id?: string; requested_reason: string; requested_rating?: string; evidence: string }) =>
    invoke<{ override: AmlRiskOverride }>({ op: "request_override", ...p }),
  resolveOverride: (override_id: string, status: "approved" | "rejected", reviewer_note?: string) =>
    invoke<{ override: AmlRiskOverride }>({ op: "resolve_override", override_id, status, reviewer_note }),
  listOverrides: (p: { case_id?: string; status?: string } = {}) =>
    invoke<{ overrides: AmlRiskOverride[] }>({ op: "list_overrides", ...p }),

  decide: (p: { case_id: string; assessment_id?: string; outcome: AmlDecision["outcome"]; rationale?: string }) =>
    invoke<{ decision: AmlDecision }>({ op: "decide", ...p }),
  listDecisions: (case_id: string) => invoke<{ decisions: AmlDecision[] }>({ op: "list_decisions", case_id }),
  latestDecision: (case_id: string) => invoke<{ decision: AmlDecision | null }>({ op: "latest_decision", case_id }),

  listApprovals: (p: { case_id?: string; status?: string } = {}) =>
    invoke<{ approvals: AmlApproval[] }>({ op: "list_approvals", ...p }),
  resolveApproval: (approval_id: string, status: "approved" | "rejected", note?: string) =>
    invoke<{ approval: AmlApproval }>({ op: "resolve_approval", approval_id, status, note }),

  // Phase 8 — recommendation → decision → service-gate loop (§12.8, C.4)
  recommend: (p: { case_id: string; recommended_outcome: AmlAnalystRecommendation["recommended_outcome"]; rationale: string; assessment_id?: string }) =>
    invoke<{ recommendation: AmlAnalystRecommendation }>({ op: "recommend", ...p }),
  listRecommendations: (case_id: string) =>
    invoke<{ recommendations: AmlAnalystRecommendation[] }>({ op: "list_recommendations", case_id }),
  setServiceGate: (p: { case_id: string; status: string; reason: string }) =>
    invoke<{ gate: AmlServiceGateContract & { id?: string } }>({ op: "set_service_gate", ...p }),
  gateContract: (case_id: string) =>
    invoke<{ gate: AmlServiceGateContract }>({ op: "gate_contract", case_id }),
  recalcStatus: (case_id: string) =>
    invoke<{ recalc: AmlRecalcStatus }>({ op: "recalc_status", case_id }),
  /** What stands between this case and clearance — the same reasons the
   *  decide/gate ops enforce, as a read (`clearanceBlockReasons`, one
   *  implementation), so the screen names the blockers before the 409. */
  clearanceReadiness: (case_id: string) =>
    invoke<{ ready: boolean; reasons: string[] }>({ op: "clearance_readiness", case_id }),

  listConditions: (case_id: string) => invoke<{ conditions: AmlCaseCondition[] }>({ op: "list_conditions", case_id }),
  upsertCondition: (condition: Partial<AmlCaseCondition> & { case_id: string; label: string }) =>
    invoke<{ condition: AmlCaseCondition }>({ op: "upsert_condition", condition }),
  resolveCondition: (condition_id: string, status: "resolved" | "waived" = "resolved") =>
    invoke<{ condition: AmlCaseCondition }>({ op: "resolve_condition", condition_id, status }),

  gateStatus: (p: { case_id?: string; purchase_file_id?: string }) =>
    invoke<AmlGateStatus>({ op: "gate_status", ...p }),

  policySnapshot: (tenant_id: string = "default") =>
    invoke<AmlPolicySnapshot>({ op: "policy_snapshot", tenant_id }),
  updateRiskPolicy: (p: { tenant_id?: string; risk_program_version?: string; straight_through_config?: AmlStraightThroughConfig }) =>
    invoke<{ tenant: { tenant_id: string; risk_program_version: string; straight_through_config: AmlStraightThroughConfig } }>({ op: "update_risk_policy", ...p }),
};

