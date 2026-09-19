import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GatePassportPathCard } from "../GatePassportPathCard";
import { gatePassportPath, type GatePassportFacts } from "@/lib/aml/gatePassportPath.pure";

/**
 * Stage 9, as the operator reads it.
 *
 * "To me there doesn't seem to be a clear distinction for section 9 to be
 * ticked off as green after the user has already ticked off the Approved
 * function." — and that was right twice over.
 *
 * The stage DID complete the moment the gate was approved on a case in this
 * position. Nothing on the screen said so before the click; instead a
 * four-step list sat under two progress readings that counted something
 * else ("0 of 3 items on this stage complete"), and step 4 told the operator
 * to issue a new version that could not have changed anything.
 */

const facts = (over: Partial<GatePassportFacts> = {}): GatePassportFacts => ({
  decisionOutcome: "cleared",
  gateStatus: "under_review",
  passportState: "refresh_required",
  passportReasons: ["service_gate_regressed"],
  passportVersion: 1,
  canReview: true,
  ...over,
});

const mount = (over: Partial<GatePassportFacts> = {}) =>
  render(<GatePassportPathCard steps={gatePassportPath(facts(over))} />);

describe("the reported case", () => {
  it("names the ONE step left and says it finishes the stage", () => {
    mount();
    const banner = screen.getByTestId("gate-passport-finishing-step");
    expect(banner.textContent).toMatch(/One step left — Service gate approved/);
    expect(banner.textContent).toMatch(/finishes this stage/);
  });

  it("does not tell the operator a newer version is needed", () => {
    /* The trap: the only reason for "Refresh required" was the unapproved
       gate, and reissuing supersedes a good v1 while leaving the state
       exactly where it was. */
    const { container } = mount();
    expect(container.textContent).not.toMatch(/newer version is needed/);
    expect(container.textContent).toMatch(/no new version is needed/i);
  });

  it("counts these steps, in these units", () => {
    /* decision done · gate owed · issue done. Preview and Share are not
       counted at all: a look is not a debt, and a case may legitimately
       have no partner, so a stage that would not complete without one
       invents an obligation nobody has. */
    mount();
    expect(screen.getByText("2 of 3 done")).toBeTruthy();
  });

  it("names sharing as the last phase, without inventing a debt", () => {
    mount();
    expect(screen.getByText(/5\. Share it with partners/)).toBeTruthy();
    expect(screen.getByText(/roster below/)).toBeTruthy();
    // And it states no numbers — the roster is the one place that counts
    // who holds this Passport.
    expect(screen.getByText(/roster below/).textContent ?? "").not.toMatch(/\d+ partner/);
  });
});

describe("the promise is exact, or it is absent", () => {
  it("an operator who cannot approve is told who must, and promised nothing", () => {
    mount({ canReview: false });
    expect(screen.queryByTestId("gate-passport-finishing-step")).toBeNull();
    expect(screen.getByText(/Waiting on Service gate approved/)).toBeTruthy();
    // Said on the banner and on the step itself — the enabler is named
    // before the click, wherever the operator is looking.
    expect(screen.getAllByText(/Requires a reviewer or the MLRO/).length)
      .toBeGreaterThanOrEqual(1);
  });

  it("two owed steps is not one", () => {
    mount({ passportReasons: ["material_inputs_changed"] });
    expect(screen.queryByTestId("gate-passport-finishing-step")).toBeNull();
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
  });

  it("a completed stage says so and drives forward, not 'one step left'", () => {
    render(
      <GatePassportPathCard
        steps={gatePassportPath(facts({
          gateStatus: "approved", passportState: "issued_current",
          passportReasons: ["current_attestation_gate_approved"],
        }))}
        onContinue={() => {}}
      />,
    );
    expect(screen.queryByTestId("gate-passport-finishing-step")).toBeNull();
    expect(screen.getByText(/The service may proceed and the Passport is in force/)).toBeTruthy();
    /* The onward door names the stage that actually comes next. Partners
       are on THIS stage now, with the Passport they hold; what follows is
       what keeps the case current afterwards. */
    expect(screen.getByRole("button", { name: /Continue to Ongoing CDD/ })).toBeTruthy();
    expect(screen.getByText("3 of 3 done")).toBeTruthy();
  });
});
