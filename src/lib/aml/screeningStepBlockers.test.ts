import { describe, expect, it } from "vitest";
import {
  STEP_STATE_LABEL, deriveScreeningPath, isOutstanding,
} from "@/lib/aml/screeningSteps.pure";
import { deriveAmlScreeningScope } from "@/lib/aml/screeningScope";

/**
 * "Blocked" means something is in the way. It must be able to say what.
 *
 * ── What was on the screen ────────────────────────────────────────────
 * Stage 5 showed **Record the PEP determination — Blocked**, in red, with a
 * warning marker, while the case rail asked the operator to record exactly
 * that determination and the dialog behind it worked perfectly.
 *
 * Nothing was blocking it. The determination was owed and had not been made,
 * which is work, and `pepStep` had no word for that: its only states were
 * `not_required`, `blocked` and `done`. So an operator was told to go and
 * find an obstacle that did not exist.
 *
 * The promotion to `current` could not save it either. It was guarded by
 * `!isOutstanding(s.state)`, which only ever upgraded a step that was
 * already settled — so the one step the server was pointing at kept the red
 * badge precisely because it was outstanding.
 */

const subject = (over = {}) => ({
  id: "s1", name: "Pat Example", partyType: "primary_subject",
  required: true, state: "completed",
  pepDetermination: null,
  sanctions: { state: "clear" as const, resolved: true, detail: "" },
  pep: { resolved: false, detail: "No determination recorded." },
  outstanding: [],
  ...over,
});

const position = (over = {}) => ({
  read: true,
  subjects: [subject()],
  facts: null,
  ...over,
} as never);

const sync = (over = {}) => ({
  case_closed: false,
  enrolled: 1,
  provider_ready: true,
  provider_relevant: true,
  perimeter: {
    classified: true, classification: "designated_service",
    recorded_at: "2026-08-01T00:00:00.000Z", recorded_by_label: "MLRO",
  },
  scopes: [
    { scope: "sanctions", required: true, optional: false, state: "required",
      reason_code: "tfs_obligation", reason: "" },
    { scope: "pep", required: true, optional: false, state: "required",
      reason_code: "pep_determination_required", reason: "" },
  ],
  next_action: {
    key: "record_pep", label: "Record PEP determinations",
    headline: "PEP determinations outstanding", detail: "", owner: "reviewer",
  },
  ...over,
} as never);

const pepStep = (s = sync(), p = position()) =>
  deriveScreeningPath({ sync: s, position: p }).steps.find((x) => x.key === "pep")!;

describe("a determination that is owed and not made is WORK", () => {
  it("reads 'Do this now' when the server is asking for it", () => {
    const step = pepStep();
    expect(step.state).toBe("current");
    expect(STEP_STATE_LABEL[step.state]).toBe("Do this now");
    expect(step.blockedBy).toBeNull();
  });

  it("is still outstanding — it holds the stage open", () => {
    // Relabelling must not quietly settle it. "Do this now" is not "done".
    expect(isOutstanding(pepStep().state)).toBe(true);
    expect(deriveScreeningPath({ sync: sync(), position: position() }).complete).toBe(false);
  });

  it("reads 'Still to do' when the server is asking for something else", () => {
    /*
     * The state that did not exist. Before this, a PEP determination that
     * was owed but not the current step could only be `blocked` — the same
     * red badge, on a step nobody was even being pointed at.
     */
    const step = pepStep(sync({
      next_action: {
        key: "classify_perimeter", label: "Classify", headline: "", detail: "",
        owner: "reviewer",
      },
    }));
    expect(step.state).toBe("outstanding");
    expect(STEP_STATE_LABEL[step.state]).toBe("Still to do");
    expect(step.blockedBy).toBeNull();
  });
});

describe("the one thing that genuinely blocks it", () => {
  it("names having nobody to determine against, and says where to go", () => {
    const step = pepStep(sync(), position({ subjects: [] }));
    expect(step.state).toBe("blocked");
    expect(step.blockedBy).toMatch(/nobody is enrolled/i);
    expect(step.blockedBy).toMatch(/confirm who must be assessed/i);
  });

  it("a blocker outranks the server pointing at the step", () => {
    // The server can ask for a determination against nobody. The step must
    // not answer "Do this now" to that.
    expect(pepStep(sync(), position({ subjects: [] })).state).toBe("blocked");
  });
});

describe("the rule, one way round", () => {
  it("every blocked step names its blocker, and nothing else names one", () => {
    for (const p of [position(), position({ subjects: [] }), position({ read: false })]) {
      for (const step of deriveScreeningPath({ sync: sync(), position: p }).steps) {
        if (step.state === "blocked") {
          expect(step.blockedBy, `${step.key} is blocked and must say by what`).toBeTruthy();
        } else {
          expect(step.blockedBy, `${step.key} is ${step.state} and must name nothing`)
            .toBeNull();
        }
      }
    }
  });

  it("no label promises an obstacle the step cannot point at", () => {
    expect(STEP_STATE_LABEL.blocked).toBe("Blocked");
    expect(STEP_STATE_LABEL.outstanding).not.toMatch(/block/i);
    expect(STEP_STATE_LABEL.current).not.toMatch(/block/i);
  });
});

describe("two live decisions for one scope resolve toward the obligation", () => {
  it("takes the row that requires screening, whatever the order", () => {
    /*
     * The reader resolved the server's scope decisions last-wins, over a
     * `SELECT` with no `ORDER BY`. No case holds duplicates today and the
     * recorder has been hardened against the race that could leave a pair
     * behind — but the layer that DECIDES should not be the layer that
     * assumes.
     *
     * Sanctions bind every dealing and cannot be stood down by risk, so a
     * contradiction resolves toward the obligation in BOTH orders: being
     * wrong this way costs a screening nobody strictly owed, and the other
     * way is a dealing that was never screened.
     */
    const required = { scope: "sanctions" as const, required: true, optional: false,
      state: "required" as const, reason_code: "tfs_obligation", reason: "" };
    const notRequired = { scope: "sanctions" as const, required: false, optional: false,
      state: "not_required" as const, reason_code: "perimeter:enquiry_only", reason: "" };

    for (const rows of [[required, notRequired], [notRequired, required]]) {
      const decision = deriveAmlScreeningScope({ answers: null }, null, rows);
      const sanctions = decision.determinations.find((d) => d.scope === "sanctions");
      expect(sanctions?.required).toBe(true);
      expect(sanctions?.notRequired).not.toBe(true);
    }
  });

  it("agreement is unaffected", () => {
    const notRequired = { scope: "sanctions" as const, required: false, optional: false,
      state: "not_required" as const, reason_code: "perimeter:enquiry_only", reason: "" };
    const decision = deriveAmlScreeningScope({ answers: null }, null, [notRequired, notRequired]);
    expect(decision.determinations.find((d) => d.scope === "sanctions")?.required).toBe(false);
  });
});
