import { describe, expect, it } from "vitest";
import {
  ACTIVATION_TIMINGS,
  AGREEMENT_STATES,
  CASE_STAGES,
  CLIENT_PORTAL_STATUSES,
  FINANCE_PORTAL_STATUSES,
  LEGACY_STATUS_TO_CLIENT_PORTAL,
  LEGACY_STATUS_TO_SERVICE_GATE,
  LEGACY_STATUS_TO_STAGE,
  SERVICE_GATE_STATUSES,
  activationContractForModel,
  caseStage,
  clientPortalStatus,
  financePortalStatus,
  serviceGateStatus,
  serviceReadiness,
} from "./caseDimensions";
import type { AmlCaseStatus } from "./amlCasesApi";

const LEGACY_STATUSES: AmlCaseStatus[] = [
  "draft", "kyc_in_progress", "kyc_complete", "edd_required",
  "under_review", "escalated_mlro", "cleared", "blocked", "closed",
];

describe("legacy status mappings", () => {
  it("maps every legacy status to a valid value in each dimension", () => {
    for (const s of LEGACY_STATUSES) {
      expect(CASE_STAGES).toContain(LEGACY_STATUS_TO_STAGE[s]);
      expect(CLIENT_PORTAL_STATUSES).toContain(LEGACY_STATUS_TO_CLIENT_PORTAL[s]);
      expect(SERVICE_GATE_STATUSES).toContain(LEGACY_STATUS_TO_SERVICE_GATE[s]);
    }
  });

  it("only cleared grants an approved service gate from legacy data", () => {
    for (const s of LEGACY_STATUSES) {
      const gate = LEGACY_STATUS_TO_SERVICE_GATE[s];
      if (s === "cleared") expect(gate).toBe("approved");
      else expect(["approved", "approved_with_controls"]).not.toContain(gate);
    }
  });

  it("never exposes internal escalation to the client dimension", () => {
    expect(LEGACY_STATUS_TO_CLIENT_PORTAL.escalated_mlro).toBe("under_review");
    expect(LEGACY_STATUS_TO_CLIENT_PORTAL.blocked).toBe("contact_adviser");
  });
});

describe("dimension derivation", () => {
  it("prefers explicit columns when present and valid", () => {
    const row = {
      status: "kyc_in_progress" as AmlCaseStatus,
      case_stage: "enhanced_cdd",
      client_portal_status: "additional_info_required",
      finance_portal_status: "clarification_required",
      service_gate_status: "conditions_outstanding",
    };
    expect(caseStage(row)).toBe("enhanced_cdd");
    expect(clientPortalStatus(row)).toBe("additional_info_required");
    expect(financePortalStatus(row)).toBe("clarification_required");
    expect(serviceGateStatus(row)).toBe("conditions_outstanding");
  });

  it("falls back to legacy mapping for unmigrated rows", () => {
    const row = { status: "edd_required" as AmlCaseStatus };
    expect(caseStage(row)).toBe("enhanced_cdd");
    expect(clientPortalStatus(row)).toBe("additional_info_required");
    expect(financePortalStatus(row)).toBe("not_requested");
    expect(serviceGateStatus(row)).toBe("information_outstanding");
  });

  it("rejects invalid column values rather than passing them through", () => {
    const row = {
      status: "cleared" as AmlCaseStatus,
      case_stage: "totally_invalid",
      service_gate_status: "root_access",
    };
    expect(caseStage(row)).toBe("cleared");
    expect(serviceGateStatus(row)).toBe("approved");
  });
});

describe("service readiness (finance-safe)", () => {
  it("is ready only for approved gates", () => {
    expect(serviceReadiness("approved")).toBe("service_ready");
    expect(serviceReadiness("approved_with_controls")).toBe("service_ready");
    for (const gate of SERVICE_GATE_STATUSES) {
      if (gate === "approved" || gate === "approved_with_controls") continue;
      expect(serviceReadiness(gate)).toBe("service_not_ready");
    }
  });
});

describe("activation contract", () => {
  it("maps Model A to post-agreement activation with an operative agreement", () => {
    const c = activationContractForModel("A", null);
    expect(c.activation_timing).toBe("post_agreement_trigger");
    expect(c.agreement_state).toBe("operative");
    expect(c.legacy_activation_model).toBe("A");
    expect(ACTIVATION_TIMINGS).toContain(c.activation_timing);
    expect(AGREEMENT_STATES).toContain(c.agreement_state);
  });

  it("maps Model B to a conditional agreement with the program version retained", () => {
    const c = activationContractForModel("B", "v2.1");
    expect(c.activation_timing).toBe("conditional_agreement");
    expect(c.agreement_state).toBe("conditional_executed");
    expect(c.activation_policy_version).toBe("v2.1");
    expect(c.legacy_activation_model).toBe("B");
  });
});

describe("progress rail derivation", () => {
  it("renders 14 stages for every case", async () => {
    const { progressRail, PROGRESS_RAIL_STEPS } = await import("./caseDimensions");
    expect(PROGRESS_RAIL_STEPS).toHaveLength(14);
    for (const s of LEGACY_STATUSES) {
      expect(progressRail({ status: s })).toHaveLength(14);
    }
  });

  it("marks the service gate complete only when explicitly approved", async () => {
    const { progressRail } = await import("./caseDimensions");
    const approved = progressRail({ status: "kyc_in_progress", service_gate_status: "approved" });
    expect(approved.find((s) => s.key === "service_gate")?.state).toBe("complete");
    const locked = progressRail({ status: "kyc_in_progress", service_gate_status: "locked" });
    expect(locked.find((s) => s.key === "service_gate")?.state).toBe("blocked");
    const cleared = progressRail({ status: "cleared" });
    expect(cleared.find((s) => s.key === "service_gate")?.state).toBe("complete");
    const inProgress = progressRail({ status: "under_review" });
    expect(inProgress.find((s) => s.key === "service_gate")?.state).not.toBe("complete");
  });

  it("surfaces blocked and attention states on the active step", async () => {
    const { progressRail } = await import("./caseDimensions");
    const blocked = progressRail({ status: "blocked" });
    expect(blocked.some((s) => s.state === "blocked")).toBe(true);
    const edd = progressRail({ status: "edd_required" });
    expect(edd.some((s) => s.state === "attention_required")).toBe(true);
  });
});

describe("finance-safe contract shape", () => {
  it("finance dimension values never include risk vocabulary", () => {
    for (const v of FINANCE_PORTAL_STATUSES) {
      expect(v).not.toMatch(/risk|pep|sanction|screen|investigat|smr|austrac/i);
    }
  });
});
