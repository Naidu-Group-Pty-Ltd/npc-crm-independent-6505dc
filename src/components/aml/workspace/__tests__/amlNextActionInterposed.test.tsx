import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AmlNextActionCard } from "../AmlNextActionCard";
import type { AmlNextAction } from "@/lib/aml/workspaceViewModel";

/**
 * A jump forward that asserts something about what it jumped over has to be
 * able to support it.
 *
 * The card printed *"Stages 2–6 have nothing outstanding on this reading"*
 * purely from `action.stageOrder > currentStageOrder + 1`. It never consulted
 * a single one of those stages. On the case that prompted this it was false:
 * stage 6 carried an unmet blocker in its own journey reading while this line
 * told the operator it had nothing.
 */

const action = (over: Partial<AmlNextAction> = {}): AmlNextAction => ({
  key: "submission_review",
  label: "Review the client submission",
  explanation: "The client has submitted their information and is awaiting review.",
  attention: "attention",
  section: "submission-review",
  blocking: true,
  actionType: "open_section",
  sourceFacts: ["case_stage = client_submitted"],
  unavailableFacts: [],
  partial: false,
  stageOrder: 7,
  stageSection: "submission-review",
  ...over,
} as AmlNextAction);

const renderCard = (interposed: Parameters<typeof AmlNextActionCard>[0]["interposed"]) =>
  render(
    <AmlNextActionCard
      action={action()} onOpenSection={vi.fn()}
      currentStageOrder={1} interposed={interposed}
    />,
  );

describe("what is being stepped over", () => {
  it("a stage that is NOT REQUIRED is named, with its reason", () => {
    // The user's requirement, exactly: never a silent skip.
    renderCard([
      { number: 6, label: "Funding", state: "not_required",
        reason: "This case is recorded as outside the perimeter — enquiry only." },
    ]);
    expect(screen.getByText(/Stage 6 · Funding — not required/)).toBeTruthy();
    expect(screen.getByText(/outside the perimeter — enquiry only/)).toBeTruthy();
  });

  it("a stage that still has work is NOT reported as quiet", () => {
    /*
     * Two derivations of one case disagreeing is a defect, and printing the
     * reassuring half of it is how it stays invisible. If this ever fires,
     * the ranking and the journey have drifted and the screen says so.
     */
    renderCard([{ number: 6, label: "Funding", state: "outstanding" }]);
    expect(screen.getByText(/Stage 6 · Funding still has work outstanding/)).toBeTruthy();
    expect(screen.queryByText(/nothing is outstanding/i)).toBeNull();
  });

  it("genuinely quiet stages say so, and that is now derived", () => {
    renderCard([
      { number: 5, label: "Screening", state: "clear" },
      { number: 6, label: "Funding", state: "clear" },
    ]);
    expect(screen.getByText(/Nothing is outstanding on the other stages in between/))
      .toBeTruthy();
  });

  it("says nothing at all when it was told nothing", () => {
    // The claim used to be made from the stage NUMBERS alone. With no
    // reading to support it, the honest output is silence.
    renderCard([]);
    expect(screen.queryByText(/nothing is outstanding/i)).toBeNull();
    expect(screen.queryByText(/have nothing/i)).toBeNull();
  });

  it("the button still names where it is going", () => {
    renderCard([{ number: 6, label: "Funding", state: "clear" }]);
    expect(screen.getByRole("button", { name: /go to stage 7 · submission review/i }))
      .toBeTruthy();
  });
});
