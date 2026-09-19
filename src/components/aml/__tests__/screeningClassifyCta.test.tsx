import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SanctionsPerimeterControl } from "../SanctionsPerimeterControl";
import {
  canPerformScreeningAction, screeningActionDeniedNote,
} from "@/lib/aml/screeningActionAccess";

/**
 * The Stage 5 CTA that appeared to do nothing.
 *
 * The next action was right and the button was right; pressing it scrolled
 * to the control and stopped. The dialog's `open` state was private to
 * `SanctionsPerimeterControl`, reachable only from its own smaller button —
 * so the prominent CTA could not open it, and when the control was already
 * on screen the click had no visible effect whatsoever.
 *
 * A second defect sat beside it: the card took one `canAct` boolean and the
 * workspace passed `canWrite`, which includes analysts. Classifying a
 * perimeter is reviewer-or-MLRO on the server, so an analyst was shown a
 * prominent button for work the server refuses.
 */

const classifyScreeningPerimeter = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    classifyScreeningPerimeter: (...a: unknown[]) => classifyScreeningPerimeter(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const repo = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const onChanged = vi.fn();

const OUTSIDE = {
  classification: "outside_perimeter" as const, classified: true,
  reason_code: "enquiry_only", scopes_excluded: ["sanctions" as const],
  recorded_by_label: "mlro@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  classifyScreeningPerimeter.mockResolvedValue({ perimeter: {} });
});

/** Mirrors the workspace: parent owns the state, both entry points share it. */
function Harness({
  perimeter = null, canClassify = true,
}: { perimeter?: typeof OUTSIDE | null; canClassify?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* Stands in for the Stage 5 next-action CTA rendered above the control. */}
      <button type="button" onClick={() => setOpen(true)}>
        Classify sanctions screening requirement
      </button>
      <SanctionsPerimeterControl
        caseId={CASE_ID} perimeter={perimeter} canClassify={canClassify}
        open={open} onOpenChange={setOpen} onChanged={onChanged}
      />
    </div>
  );
}

describe("1-5. the top CTA opens the real dialog, in one click", () => {
  it("reviewer/MLRO: one click opens it — no scroll, no second button", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", {
      name: /classify sanctions screening requirement/i,
    }));
    // Immediately, from that one click.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/within the sanctions screening perimeter\?/i)).toBeTruthy();
  });

  it("5-6. the lower button opens THE SAME dialog, and there is only one", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^classify perimeter$/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // ...and the top CTA drives the same state: closing via one closes both.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", {
      name: /classify sanctions screening requirement/i,
    }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("16. an already-classified case reclassifies through the same dialog", () => {
    render(<Harness perimeter={OUTSIDE} />);
    fireEvent.click(screen.getByRole("button", { name: /^reclassify perimeter$/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("4, 19. the handler opens the dialog rather than scrolling or navigating", () => {
    const ws = read("src/pages/aml/AmlCaseWorkspace.tsx");
    const handler = ws.slice(
      ws.indexOf('case "classify_perimeter":'),
      ws.indexOf('case "fix_provider":'));
    expect(handler).toMatch(/setPerimeterDialogOpen\(true\)/);
    expect(handler).not.toMatch(/scrollIntoView/);
    expect(handler).not.toMatch(/navigate\(/);
    expect(handler).not.toMatch(/ADMIN_AML_CONFIGURATION_PATH/);
  });

  it("6. no second dialog was introduced", () => {
    const ws = read("src/pages/aml/AmlCaseWorkspace.tsx");
    expect([...ws.matchAll(/<SanctionsPerimeterControl/g)]).toHaveLength(1);
    const control = read("src/components/aml/SanctionsPerimeterControl.tsx");
    expect([...control.matchAll(/<Dialog\b/g)]).toHaveLength(1);
  });

  it("uses no DOM simulation, hidden buttons or window events", () => {
    for (const f of [
      "src/pages/aml/AmlCaseWorkspace.tsx",
      "src/components/aml/SanctionsPerimeterControl.tsx",
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/querySelector\([^)]*\)\.click|dispatchEvent|new CustomEvent/);
    }
  });
});

describe("7-9. authorization", () => {
  const analyst = { canWrite: true, isReviewer: false, isMlro: false };
  const reviewer = { canWrite: true, isReviewer: true, isMlro: false };
  const mlro = { canWrite: true, isReviewer: false, isMlro: true };

  it("classification is reviewer or MLRO only", () => {
    expect(canPerformScreeningAction("classify_perimeter", analyst)).toBe(false);
    expect(canPerformScreeningAction("classify_perimeter", reviewer)).toBe(true);
    expect(canPerformScreeningAction("classify_perimeter", mlro)).toBe(true);
  });

  it("adjudication is too, and other actions keep the existing rule", () => {
    expect(canPerformScreeningAction("adjudicate_match", analyst)).toBe(false);
    /*
     * `record_pep` moved out of this list, because it never belonged in it:
     * `record_pep_determination` answers a non-reviewer with 403, so an
     * analyst was being offered the one action Stage 5 was asking for on the
     * reported case. `screeningActionAccess.test.ts` now reads the edge
     * function's own role guards rather than trusting a hand-kept list.
     */
    expect(canPerformScreeningAction("record_pep", analyst)).toBe(false);
    for (const key of [
      "fix_provider", "run_screening", "enrol_subjects",
      "screening_stalled", "escalate", "await_submission",
    ] as const) {
      expect(canPerformScreeningAction(key, analyst)).toBe(true);
      // ...and nobody without write access gets any of them.
      expect(canPerformScreeningAction(key, {
        canWrite: false, isReviewer: false, isMlro: false,
      })).toBe(false);
    }
  });

  it("names who can, instead of going quiet", () => {
    expect(screeningActionDeniedNote("classify_perimeter"))
      .toBe("A reviewer or the MLRO must classify this case.");
    expect(screeningActionDeniedNote("fix_provider")).toBeNull();
  });

  it("8. an analyst gets no classification control at all", () => {
    render(<Harness canClassify={false} />);
    expect(screen.queryByRole("button", { name: /^classify perimeter$/i })).toBeNull();
    expect(screen.getByText(/only a reviewer or the mlro can change this/i)).toBeTruthy();
  });

  it("the card resolves permission per action, not per session", () => {
    const card = read("src/components/aml/ScreeningStageCard.tsx");
    expect(card).toMatch(/canPerformScreeningAction\(action\.key, actor\)/);
    expect(card).not.toMatch(/canAct: boolean/);
    const ws = read("src/pages/aml/AmlCaseWorkspace.tsx");
    expect(ws).not.toMatch(/canAct=\{canWrite\}/);
  });

  it("9, 20. the server gate and the step-up control are untouched", () => {
    const cases = read("supabase/functions/aml-cases/index.ts");
    const op = cases.slice(
      cases.indexOf("case 'classify_screening_perimeter'"),
      cases.indexOf("case 'run_optional_screening'"));
    expect(op).toMatch(/if \(!roles\.has\('reviewer'\) && !roles\.has\('mlro'\)\)/);
    expect(op).toMatch(/insufficient_role/);
    for (const f of [
      "src/lib/aml/screeningActionAccess.ts",
      "src/components/aml/SanctionsPerimeterControl.tsx",
    ]) {
      expect(read(f).replace(/\/\*[\s\S]*?\*\//g, ""))
        .not.toMatch(/step[_-]?up|reauth|session_token|custom_users/i);
    }
  });
});

describe("10-13, 17-18. the dialog itself, opened from the top CTA", () => {
  const openFromCta = () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", {
      name: /classify sanctions screening requirement/i,
    }));
  };

  it("10-11. defaults sanctions checked and PEP unchecked", () => {
    openFromCta();
    const sanctions = screen.getByLabelText(/targeted financial sanctions/i);
    const pep = screen.getByLabelText(/politically exposed person/i);
    expect(sanctions.getAttribute("data-state") ?? sanctions.getAttribute("aria-checked"))
      .toBe("checked");
    expect(pep.getAttribute("data-state") ?? pep.getAttribute("aria-checked"))
      .not.toBe("checked");
  });

  it("12. records the determination and refreshes Stage 5", async () => {
    openFromCta();
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(classifyScreeningPerimeter).toHaveBeenCalledWith({
      case_id: CASE_ID,
      classification: "outside_perimeter",
      reason_code: "enquiry_only",
      scopes_excluded: ["sanctions"],
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // ...and the dialog closes on success.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("15. inside perimeter records no exemption", async () => {
    openFromCta();
    fireEvent.click(screen.getByLabelText(/inside perimeter/i));
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(classifyScreeningPerimeter).toHaveBeenCalled());
    const arg = classifyScreeningPerimeter.mock.calls[0][0];
    expect(arg.classification).toBe("designated_service");
    expect(arg.scopes_excluded).toBeUndefined();
  });

  it("17. a failure is reported and the dialog stays usable", async () => {
    classifyScreeningPerimeter.mockRejectedValueOnce(new Error("Reviewer or MLRO role required"));
    openFromCta();
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })));
    // Still open, still submittable — the operator can correct and retry.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: /record determination/i }) as HTMLButtonElement)
      .disabled).toBe(false);
  });

  it("18. a busy submit cannot be fired twice", async () => {
    let release: (v: unknown) => void = () => {};
    classifyScreeningPerimeter.mockReturnValueOnce(new Promise((r) => { release = r; }));
    openFromCta();
    const submit = screen.getByRole("button", { name: /record determination/i });
    fireEvent.click(submit);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(submit);
    expect(classifyScreeningPerimeter).toHaveBeenCalledTimes(1);
    await act(async () => { release({ perimeter: {} }); });
  });
});
