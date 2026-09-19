import { describe, expect, it } from "vitest";

import { stageStates } from "@/lib/aml/journeyMapStages.pure";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

/**
 * The journey map's four nodes, each answered by its own dimension. The
 * defect this pins: "We verify" and "Approved" completed only when the
 * SERVICE GATE was approved, so a verified, cleared case still showed both
 * pulsing as in-progress — the map told the operator work was outstanding
 * that Stage 8 had already finished.
 */

const row = (): AmlCase => ({
  id: "c1", status: "kyc_in_progress",
  client_portal_status: "in_progress",
  service_gate_status: "under_review",
  case_stage: null,
} as unknown as AmlCase);

const named = (states: ReturnType<typeof stageStates>) => ({
  submit: states[0], verify: states[1], approve: states[2], share: states[3],
});

describe("a cleared case shows verify and approve as DONE before the gate moves", () => {
  it("canonical stage cleared, gate still under review", () => {
    const s = named(stageStates({
      ...row(), status: "cleared", case_stage: "cleared",
      client_portal_status: "complete", service_gate_status: "under_review",
    } as unknown as AmlCase, true, 0));
    expect(s.verify).toBe("done");
    expect(s.approve).toBe("done");
    // Sharing is genuinely still ahead — active, not done.
    expect(s.share).toBe("active");
  });

  it("legacy status alone carries the same reading (dual-read)", () => {
    const s = named(stageStates({
      ...row(), status: "cleared", case_stage: null,
      client_portal_status: "complete", service_gate_status: "under_review",
    } as unknown as AmlCase, false, 0));
    expect(s.verify).toBe("done");
    expect(s.approve).toBe("done");
  });
});

describe("the middle nodes stay honest for everything short of a decision", () => {
  it("a case still in KYC has verify active, approve waiting", () => {
    const s = named(stageStates({
      ...row(), status: "kyc_complete", client_portal_status: "submitted",
    } as unknown as AmlCase, false, 0));
    expect(s.submit).toBe("done");
    expect(s.verify).toBe("active");
    expect(s.approve).toBe("active");
  });

  it("awaiting the decision: verified, not approved", () => {
    const s = named(stageStates({
      ...row(), status: "under_review", client_portal_status: "complete",
    } as unknown as AmlCase, false, 0));
    expect(s.verify).toBe("done");
    expect(s.approve).toBe("active");
  });

  it("a blocked case was verified — the checks ran; the decision went against", () => {
    const s = named(stageStates({
      ...row(), status: "blocked", case_stage: "blocked",
    } as unknown as AmlCase, false, 0));
    expect(s.verify).toBe("done");
    expect(s.approve).toBe("active");
  });

  it("an approved gate still completes both (it can only follow a decision)", () => {
    const s = named(stageStates({
      ...row(), status: "cleared", service_gate_status: "approved",
    } as unknown as AmlCase, false, 0));
    expect(s.verify).toBe("done");
    expect(s.approve).toBe("done");
  });
});

describe("shared completes only on evidence of sharing", () => {
  it("an attestation with no live grant is not shared", () => {
    const s = named(stageStates({
      ...row(), status: "cleared", case_stage: "cleared",
    } as unknown as AmlCase, true, 0));
    expect(s.share).toBe("active");
  });

  it("attestation plus a live grant completes the journey", () => {
    const s = named(stageStates({
      ...row(), status: "cleared", case_stage: "cleared",
    } as unknown as AmlCase, true, 2));
    expect(s.share).toBe("done");
  });
});
