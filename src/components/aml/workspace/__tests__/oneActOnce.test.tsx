import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AmlJourneyStageHeader } from "../AmlJourneyStageHeader";
import { AmlLivePositionRail } from "../AmlLivePositionRail";
import type { AmlJourneyStage, AmlLivePosition } from "@/lib/aml/journeyModel";
import type { AmlNextAction } from "@/lib/aml/workspaceViewModel";

/**
 * One act is said once on a screen.
 *
 * Stage 5 reported as "fragmented" carried the SAME act three times — the
 * stage header's CTA, the numbered path's open step, and the right rail's
 * "Go to stage 5" — in three sets of words, above two progress readings that
 * counted different things ("2 of 3 items on this stage complete" beside
 * "3 of 5 settled"). Both counts were true. That is what made it worse than
 * either alone: an operator cannot tell which one is the state of the case.
 *
 * The repeat is suppressed at the HEADER and the RAIL, never at the path,
 * because the path is the surface the work happens in.
 */

const stage = (over: Partial<AmlJourneyStage> = {}): AmlJourneyStage => ({
  id: "screening",
  number: 5,
  label: "Screening",
  shortLabel: "Screening",
  purpose: "Screen every party and determine political exposure.",
  status: "in_progress",
  owner: "reviewer",
  ownerLabel: "Reviewer",
  attention: "action",
  blocking: true,
  aheadOfSequence: false,
  summary: "1 party awaiting a PEP determination.",
  blockers: [{ key: "pep_outstanding", label: "PEP determination outstanding", attention: "action" }],
  warnings: [],
  completedItems: [{ key: "parties", label: "Parties enrolled", attention: "none" }],
  outstandingItems: [{ key: "pep_outstanding", label: "PEP determination", attention: "action" }],
  primaryAction: {
    key: "record_pep", label: "Record PEP determination",
    section: "ownership", actionType: "record_pep",
  },
  secondaryActions: [],
  completedAt: null,
  targetSection: "ownership",
  sections: ["ownership"],
  applicable: true,
  notApplicableReason: null,
  sourceFacts: [],
  unavailableFacts: [],
  ...over,
} as AmlJourneyStage);

const position: AmlLivePosition = {
  stageLabel: "Screening",
  stageNumber: 5,
  stageTotal: 10,
  caseStageLabel: "Screening",
  clientStatusLabel: "Complete",
  financeStatusLabel: "Not requested",
  serviceGateLabel: "Not decided",
  passportLabel: null,
  passportVersion: null,
};

const nextAction: AmlNextAction = {
  key: "record_pep",
  label: "Record PEP determination",
  explanation: "One enrolled party has no political-exposure determination.",
  attention: "action",
  section: "ownership",
  blocking: true,
  actionType: "record_pep",
  stageOrder: 5,
  sourceFacts: [],
  unavailableFacts: [],
} as unknown as AmlNextAction;

describe("the stage header defers to the surface below it", () => {
  it("carries the act and the count when nothing below owns them", () => {
    render(
      <AmlJourneyStageHeader
        stage={stage()} totalStages={10}
        onOpenSection={() => {}} onPerform={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /record pep determination/i })).toBeTruthy();
    expect(screen.getByText(/1 of 2 items on this stage complete/i)).toBeTruthy();
  });

  it("stops repeating both when the surface below owns them", () => {
    render(
      <AmlJourneyStageHeader
        stage={stage()} totalStages={10} deferToSurfaceBelow
        onOpenSection={() => {}} onPerform={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /record pep determination/i })).toBeNull();
    expect(screen.queryByText(/items on this stage complete/i)).toBeNull();
  });

  it("still says where the stage is — nothing is hidden, only unrepeated", () => {
    render(
      <AmlJourneyStageHeader
        stage={stage()} totalStages={10} deferToSurfaceBelow
        onOpenSection={() => {}} onPerform={() => {}}
      />,
    );
    expect(screen.getByText(/screening/i)).toBeTruthy();
    expect(screen.getByText(/1 party awaiting a PEP determination/i)).toBeTruthy();
    expect(screen.getByText(/PEP determination outstanding/i)).toBeTruthy();
  });
});

describe("the rail names what is next without offering to take you there", () => {
  it("offers the jump when the operator is on another section", () => {
    render(
      <AmlLivePositionRail
        position={position} stage={stage()} nextAction={nextAction}
        attention={[]} riskLabel={null} currentSection="overview"
        onOpenSection={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /go to stage 5/i })).toBeTruthy();
  });

  it("drops the jump when they are already on that section", () => {
    const onOpenSection = vi.fn();
    render(
      <AmlLivePositionRail
        position={position} stage={stage()} nextAction={nextAction}
        attention={[]} riskLabel={null} currentSection="ownership"
        onOpenSection={onOpenSection}
      />,
    );
    expect(screen.queryByRole("button", { name: /go to stage 5/i })).toBeNull();
    // The READING stays. The rail's job is to name what is next; only the
    // instruction to stay where you are goes.
    expect(screen.getByText(
      /one enrolled party has no political-exposure determination/i)).toBeTruthy();
    expect(onOpenSection).not.toHaveBeenCalled();
  });

  /*
   * Suppressing the header's count was only half the fix. The rail went on
   * rendering a SECOND meter beside the path's, and the two counted
   * different things — "2 of 3 items on this stage complete" next to "3 of 5
   * settled". Both were true, which is precisely what made it worse than
   * either alone.
   */
  it("carries the stage count when nothing below owns it", () => {
    render(
      <AmlLivePositionRail
        position={position} stage={stage()} nextAction={nextAction}
        attention={[]} riskLabel={null}
        onOpenSection={() => {}}
      />,
    );
    expect(screen.getByText(/1 of 2 items complete/i)).toBeTruthy();
  });

  it("drops its own count when the path below keeps one", () => {
    render(
      <AmlLivePositionRail
        position={position} stage={stage()} nextAction={nextAction}
        attention={[]} riskLabel={null} deferReadinessToSurfaceBelow
        onOpenSection={() => {}}
      />,
    );
    expect(screen.queryByText(/items complete/i)).toBeNull();
    expect(screen.queryByRole("img", { name: /items complete/i })).toBeNull();
    // The stage itself is still named — only the number and the bar go.
    expect(screen.getAllByText(/screening/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/tracked on the steps below/i)).toBeTruthy();
  });

  it("behaves exactly as before when the caller does not say where they are", () => {
    render(
      <AmlLivePositionRail
        position={position} stage={stage()} nextAction={nextAction}
        attention={[]} riskLabel={null}
        onOpenSection={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /go to stage 5/i })).toBeTruthy();
  });
});
