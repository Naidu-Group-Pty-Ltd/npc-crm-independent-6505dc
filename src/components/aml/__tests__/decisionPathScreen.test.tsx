import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RiskTab } from "../CaseWorkspaceTabs";

/**
 * Stage 8 on screen: the decision path stands above the cards, every
 * disabled control names what enables it, the gate select opens on the
 * gate that IS, and the stage's primary button lands on this work.
 */

const api = {
  listAssessments: vi.fn(),
  listConditions: vi.fn(),
  latestDecision: vi.fn(),
  listRecommendations: vi.fn(),
  gateContract: vi.fn(),
  recalcStatus: vi.fn(),
  setServiceGate: vi.fn(),
  evaluate: vi.fn(),
  recommend: vi.fn(),
  decide: vi.fn(),
  clearanceReadiness: vi.fn(),
};
vi.mock("@/lib/aml/amlRiskApi", () => ({
  amlRiskApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as any)[k]?.(...a) }),
}));
const access = { loading: false, roles: new Set(["mlro", "reviewer", "analyst"]), isMlro: true };
vi.mock("@/hooks/useAmlAccess", () => ({ useAmlAccess: () => access }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const CASE_ID = "case-1";

beforeEach(() => {
  vi.clearAllMocks();
  access.roles = new Set(["mlro", "reviewer", "analyst"]);
  access.isMlro = true;
  api.listAssessments.mockResolvedValue({
    assessments: [{
      id: "a1", risk_rating: "low", mltf_score: 0, verification_score: 0,
      completion_score: 0, created_at: "2026-08-27T02:45:00Z",
      program_version: "v1", straight_through: false, triggered_holds: [],
      explanation: null, policy_snapshot_hash: null,
    }],
  });
  api.listConditions.mockResolvedValue({ conditions: [] });
  api.latestDecision.mockResolvedValue({ decision: null });
  api.listRecommendations.mockResolvedValue({ recommendations: [] });
  api.gateContract.mockResolvedValue({
    gate: { status: "terminated", effective_at: "2026-08-20T00:00:00Z", conditions: [], reason: null, policy_version: "v1" },
  });
  api.recalcStatus.mockResolvedValue({ recalc: { stale: false, reasons: [] } });
  api.clearanceReadiness.mockResolvedValue({ ready: true, reasons: [] });
});

const renderTab = () => render(
  <MemoryRouter>
    <RiskTab caseId={CASE_ID} canWrite onChanged={vi.fn()} />
  </MemoryRouter>,
);

describe("the decision path stands above the cards", () => {
  it("orders the work and opens exactly one step for a reviewer", async () => {
    renderTab();
    expect(await screen.findByText("The decision, in order")).toBeTruthy();
    expect(await screen.findByText(/1\. Risk assessment computed and current/)).toBeTruthy();
    expect(screen.getByText(/Rated LOW\./)).toBeTruthy();
    // The reviewer's open step is the decision; the optional recommendation
    // never stands ahead of it.
    const next = screen.getAllByText("Next");
    expect(next.length).toBe(1);
    expect(screen.getByText(/3\. Decision recorded/)).toBeTruthy();
  });

  it("a decision without a recommendation settles the step as optional, never ticks it", async () => {
    api.latestDecision.mockResolvedValue({
      decision: { outcome: "cleared", decided_at: "2026-08-27T03:00:00Z", rationale: null, program_version: "v1" },
    });
    renderTab();
    expect(await screen.findByText(/None was recorded before the decision — a recommendation is optional\./)).toBeTruthy();
  });
});

describe("no silently disabled control", () => {
  it("the gate's Apply names the missing reason, counts down, and goes quiet at the floor", async () => {
    renderTab();
    const reasonBox = await screen.findByLabelText("Gate change reason");
    expect(screen.getByRole("button", { name: /apply gate change/i })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Add a reason of at least 10 characters — 10 more to go/)).toBeTruthy();
    fireEvent.change(reasonBox, { target: { value: "CDD documents outstanding from the client" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apply gate change/i })).toHaveProperty("disabled", false);
    });
    expect(screen.queryByText(/Add a reason of at least 10 characters/)).toBeNull();
  });

  it("reads the server's approval preconditions before the 409", async () => {
    renderTab();
    await screen.findByRole("radiogroup", { name: "New service-gate status" });
    fireEvent.click(screen.getByRole("radio", { name: /^Approved\s?Grants the designated service/ }));
    // No cleared decision on this case: the requirement is on screen, not
    // in an error toast after the click.
    expect(await screen.findByText(/Approving the service gate requires a recorded cleared decision first\./)).toBeTruthy();
  });

  it("the analyst's rationale hint appears only while it is what disables the button", async () => {
    access.roles = new Set(["analyst"]);
    access.isMlro = false;
    renderTab();
    expect(await screen.findByText(/Add a rationale of at least 10 characters/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Recommendation rationale"), {
      target: { value: "Straightforward profile, verified identity, low complexity." },
    });
    await waitFor(() => expect(screen.queryByText(/Add a rationale/)).toBeNull());
  });
});

describe("the gate select opens on the gate that IS", () => {
  it("seeds from the loaded gate for an MLRO instead of a hardcoded default", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /^Terminated/ }).getAttribute("aria-checked")).toBe("true");
    });
  });

  it("never seeds a status this operator cannot re-select", async () => {
    access.roles = new Set(["reviewer"]);
    access.isMlro = false;
    renderTab();
    await screen.findByText("The decision, in order");
    // A reviewer cannot pick terminated, so the select keeps its default
    // rather than opening on an option that is not in its list.
    expect(screen.getByRole("radio", { name: /^Under review/ }).getAttribute("aria-checked")).toBe("true");
    // And the MLRO-only statuses never reach this operator's choices.
    expect(screen.queryByRole("radio", { name: /^Terminated/ })).toBeNull();
  });
});

describe("a non-reviewer sees the rule, not a missing feature", () => {
  it("names who can decide and who can move the gate", async () => {
    access.roles = new Set(["analyst"]);
    access.isMlro = false;
    renderTab();
    expect(await screen.findByText(/Recording the decision requires a reviewer or the MLRO/)).toBeTruthy();
    expect(screen.getByText(/Changing the service gate requires a reviewer or the MLRO\./)).toBeTruthy();
    // And the path says the same, as a blocked step with its blocker named.
    expect(screen.getAllByText("Blocked").length).toBeGreaterThanOrEqual(1);
  });
});

describe("the path to clearance is named before the click", () => {
  it("lists each blocker in words with a route to where it is resolved", async () => {
    api.clearanceReadiness.mockResolvedValue({
      ready: false,
      reasons: ["pep_determination_outstanding", "2_open_conditions"],
    });
    const onOpenSection = vi.fn();
    render(
      <MemoryRouter>
        <RiskTab caseId={CASE_ID} canWrite onChanged={vi.fn()} onOpenSection={onOpenSection} />
      </MemoryRouter>,
    );
    // The exact class of the reported defect: refused for a blocker nothing
    // on the page named. Now the blocker is on the page, in words.
    expect(await screen.findByText(/No current PEP determination for the case subject/)).toBeTruthy();
    expect(screen.getByText(/2 open conditions on the case/)).toBeTruthy();
    expect(screen.getByText(/Escalating or blocking is not gated by these — only clearance is\./)).toBeTruthy();
    // The screening blocker routes to the screening section; the conditions
    // blocker is fixed on this screen and carries no route.
    const openButtons = screen.getAllByRole("button", { name: "Open" });
    expect(openButtons.length).toBe(1);
    fireEvent.click(openButtons[0]);
    expect(onOpenSection).toHaveBeenCalledWith("screening");
  });

  it("says so, in green, when the server will accept a cleared decision", async () => {
    renderTab();
    expect(await screen.findByText(/Nothing stands between this case and clearance/)).toBeTruthy();
  });

  it("an unavailable reading renders as nothing — a failed read is never a clean bill", async () => {
    api.clearanceReadiness.mockRejectedValue(new Error("Unknown op"));
    renderTab();
    await screen.findByText("The decision, in order");
    expect(screen.queryByText(/Nothing stands between this case and clearance/)).toBeNull();
    expect(screen.queryByText(/stand between this case and clearance:/)).toBeNull();
  });
});

describe("the path drives, and the finish drives forward", () => {
  it("a finished path says so and opens the road to Gate & Passport", async () => {
    api.latestDecision.mockResolvedValue({
      decision: { outcome: "cleared", decided_at: "2026-08-27T03:00:00Z", rationale: null, program_version: "v1" },
    });
    api.gateContract.mockResolvedValue({
      gate: { status: "approved", effective_at: "2026-08-27T04:00:00Z", conditions: [], reason: null, policy_version: "v1" },
    });
    const onOpenSection = vi.fn();
    render(
      <MemoryRouter>
        <RiskTab caseId={CASE_ID} canWrite onChanged={vi.fn()} onOpenSection={onOpenSection} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Every step of the decision is recorded/)).toBeTruthy();
    // Two forward doors — the path card's and the gate card's service-ready
    // strip — and both open Stage 9.
    const doors = screen.getAllByRole("button", { name: /continue to gate & passport/i });
    expect(doors.length).toBe(2);
    expect(screen.getByText(/service-ready and this cascades into Gate & Passport/)).toBeTruthy();
    fireEvent.click(doors[0]);
    expect(onOpenSection).toHaveBeenCalledWith("passport");
  });

  it("every step is a link to the card that performs it", async () => {
    renderTab();
    await screen.findByText("The decision, in order");
    // The anchors exist and the steps are buttons that route to them.
    fireEvent.click(screen.getByRole("button", { name: /go to step 4: service gate applied/i }));
    expect(document.getElementById("decision-step-gate")).toBeTruthy();
    expect(document.getElementById("decision-step-assessment")).toBeTruthy();
    expect(document.getElementById("decision-step-decision")).toBeTruthy();
    // The recommendation has no card of its own for a decision-maker — its
    // step falls through to the decision card, where anything waiting shows.
    expect(document.getElementById("decision-step-recommendation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /go to step 2: analyst recommendation/i }));
  });
});

describe("escalation says where it goes", () => {
  it("names the MLRO handover and confirms an assigned MLRO will receive it", async () => {
    render(
      <MemoryRouter>
        <RiskTab caseId={CASE_ID} canWrite onChanged={vi.fn()} hasAssignedMlro />
      </MemoryRouter>,
    );
    await screen.findByRole("radiogroup", { name: "Decision outcome" });
    fireEvent.click(screen.getByRole("radio", { name: /^Escalate to MLRO/ }));
    expect(await screen.findByText(/this screen shows the decision as theirs to make/)).toBeTruthy();
    expect(screen.getByText(/An MLRO is assigned to this case and will find it waiting/)).toBeTruthy();
  });

  it("warns when no MLRO is assigned — an escalation must reach somebody", async () => {
    render(
      <MemoryRouter>
        <RiskTab caseId={CASE_ID} canWrite onChanged={vi.fn()} hasAssignedMlro={false} />
      </MemoryRouter>,
    );
    await screen.findByRole("radiogroup", { name: "Decision outcome" });
    fireEvent.click(screen.getByRole("radio", { name: /^Escalate to MLRO/ }));
    expect(await screen.findByText(/No MLRO is assigned to this case yet/)).toBeTruthy();
  });
});

describe("one act per role — the double-up resolved", () => {
  it("a decision-maker gets no recommendation form; anything waiting sits beside the decision", async () => {
    api.listRecommendations.mockResolvedValue({
      recommendations: [{
        id: "r1", status: "pending", recommended_outcome: "cleared_with_conditions",
        rationale: "Verified identity; attach a source-of-funds condition.",
        created_at: "2026-08-27T01:00:00Z",
      }],
    });
    renderTab();
    expect(await screen.findByText(/Analyst recommendation — awaiting your review/)).toBeTruthy();
    expect(screen.getByText("cleared with conditions")).toBeTruthy();
    // No standalone form for someone who can decide directly.
    expect(screen.queryByText("Your recommendation")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Recommended outcome" })).toBeNull();
  });

  it("an analyst records their recommendation as readable choices, and the button names the act", async () => {
    access.roles = new Set(["analyst"]);
    access.isMlro = false;
    renderTab();
    expect(await screen.findByText("Your recommendation")).toBeTruthy();
    await screen.findByRole("radiogroup", { name: "Recommended outcome" });
    fireEvent.click(screen.getByRole("radio", { name: /^Enhanced due diligence/ }));
    expect(screen.getByRole("button", { name: "Record recommendation — Enhanced due diligence" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Recommendation rationale"), {
      target: { value: "Source of funds needs deeper verification before deciding." },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record recommendation/i })).toHaveProperty("disabled", false);
    });
  });
});

describe("the stage's primary button lands on this work — pinned at the source", () => {
  const workspace = readFileSync(join(__dirname, "../../../pages/aml/AmlCaseWorkspace.tsx"), "utf8");
  const journey = readFileSync(join(__dirname, "../../../lib/aml/journeyModel.ts"), "utf8");

  it("the journey action carries a type the workspace switch handles", () => {
    expect(journey).toContain('actionType: "complete_assessment"');
    expect(workspace).toContain('case "complete_assessment":');
    expect(workspace).toContain('"aml-risk-decision"');
    expect(workspace).toContain('id="aml-risk-decision"');
  });
});
