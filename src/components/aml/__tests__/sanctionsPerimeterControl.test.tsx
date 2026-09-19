import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SanctionsPerimeterControl } from "../SanctionsPerimeterControl";
import { describeScreeningStage, deriveAmlScreeningScope } from "@/lib/aml/screeningScope";
import { ADMIN_AML_CONFIGURATION_PATH } from "@/lib/aml/amlRoutes";

/**
 * The operator flow the per-scope policy shipped without.
 *
 * The backend could record `sanctions = not_required`, but only from an
 * `aml.case_screening_perimeter` row, and nothing in the product wrote one.
 * So every case stayed inside the perimeter — correct, and unreachable:
 * Stage 5 kept reporting a provider fault and a missing DFAT list on cases
 * that may never have needed sanctions screening, and the single action it
 * offered navigated to a route that does not exist.
 */

const classifyScreeningPerimeter = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    classifyScreeningPerimeter: (...a: unknown[]) => classifyScreeningPerimeter(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const onChanged = vi.fn();

const renderControl = (props: Partial<Parameters<typeof SanctionsPerimeterControl>[0]> = {}) =>
  render(
    <SanctionsPerimeterControl
      caseId={CASE_ID} perimeter={null} canClassify onChanged={onChanged} {...props}
    />,
  );

const OUTSIDE = {
  classification: "outside_perimeter" as const,
  reason_code: "enquiry_only",
  scopes_excluded: ["sanctions" as const],
  recorded_by_label: "mlro@npcservices.com.au",
  recorded_at: "2026-08-18T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  classifyScreeningPerimeter.mockResolvedValue({ perimeter: {} });
});

describe("1-2. the configuration route", () => {
  const repo = join(__dirname, "../../../..");
  const read = (p: string) => readFileSync(join(repo, p), "utf8");

  it("points at the registered admin route", () => {
    expect(ADMIN_AML_CONFIGURATION_PATH).toBe("/admin/aml/configuration");
  });

  it("no source file navigates to the unregistered /aml/configuration", () => {
    /*
     * `/aml` and `/aml/passport` ARE routes — the CLIENT-facing surfaces — so
     * `/aml/configuration` looked plausible and 404'd at run time rather than
     * failing the build.
     */
    // The fix's own comment quotes the broken path to explain it, so
    // comments are stripped before the code is judged.
    const code = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const f of [
      "src/pages/aml/AmlCaseWorkspace.tsx",
      "src/components/aml/ScreeningStageCard.tsx",
      "src/components/aml/PartyScreeningPanel.tsx",
      "src/components/aml/AmlLayout.tsx",
      "src/pages/aml/AmlOverview.tsx",
      "src/pages/aml/AmlComplianceHomeV3.tsx",
    ]) {
      expect(code(read(f))).not.toMatch(/["'`]\/aml\/configuration["'`]/);
    }
  });

  it("the workspace navigates via the named constant", () => {
    const ws = read("src/pages/aml/AmlCaseWorkspace.tsx");
    expect(ws).toMatch(/navigate\(ADMIN_AML_CONFIGURATION_PATH\)/);
  });
});

describe("5, 17. the current perimeter state is stated, never inferred", () => {
  it("says an unclassified case is inside by default", () => {
    renderControl({ perimeter: null });
    expect(screen.getByText(/not yet classified/i)).toBeTruthy();
    expect(screen.getByText(/default under policy is inside the perimeter/i)).toBeTruthy();
    expect(screen.getByText(/sanctions screening is required/i)).toBeTruthy();
  });

  it("shows the reason, the recorder and the date once classified", () => {
    renderControl({ perimeter: OUTSIDE });
    expect(screen.getByText(/outside the sanctions perimeter/i)).toBeTruthy();
    expect(screen.getByText(/enquiry only/i)).toBeTruthy();
    expect(screen.getByText(/mlro@npcservices\.com\.au/i)).toBeTruthy();
    expect(screen.getByText(/targeted financial sanctions/i)).toBeTruthy();
  });

  it("18. never calls a policy determination a screening result", () => {
    renderControl({ perimeter: OUTSIDE });
    expect(screen.getByText(/policy determination, not a screening result/i)).toBeTruthy();
    expect(screen.getByText(/nobody has been screened and nobody has been cleared/i)).toBeTruthy();
    expect(screen.queryByText(/\bclear\b(?!ed)/i)).toBeNull();
    expect(screen.queryByText(/no match/i)).toBeNull();
  });
});

describe("3-5. authorization", () => {
  it("offers the control to a reviewer or MLRO", () => {
    renderControl({ canClassify: true });
    expect(screen.getByRole("button", { name: /classify perimeter/i })).toBeTruthy();
  });

  it("shows an analyst the status read-only, with no action", () => {
    renderControl({ canClassify: false, perimeter: OUTSIDE });
    expect(screen.getByText(/outside the sanctions perimeter/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /classify perimeter/i })).toBeNull();
    expect(screen.getByText(/only a reviewer or the mlro can change this/i)).toBeTruthy();
  });
});

describe("3. the workspace grants the action to reviewer AND MLRO, and nobody else", () => {
  const repo = join(__dirname, "../../../..");
  const ws = readFileSync(join(repo, "src/pages/aml/AmlCaseWorkspace.tsx"), "utf8");

  it("passes canClassify for MLRO or reviewer only", () => {
    /*
     * Asserted on the wiring rather than by rendering the whole workspace:
     * the component test above proves what each value DOES, and this proves
     * which roles get which value. `canWrite` — which includes analysts — is
     * deliberately not the gate.
     */
    const call = ws.slice(
      ws.indexOf("<SanctionsPerimeterControl"),
      ws.indexOf("/>", ws.indexOf("<SanctionsPerimeterControl")));
    expect(call).toMatch(
      /canClassify=\{access\.isMlro \|\| access\.roles\.has\("reviewer"\)\}/);
    expect(call).not.toMatch(/canClassify=\{canWrite\}/);
    // ...and the card resolves its own permission per action rather than
    // taking the blanket write flag.
    expect(ws).not.toMatch(/canAct=\{canWrite\}/);
  });

  it("reloads the stage from the server after a classification", () => {
    const call = ws.slice(
      ws.indexOf("<SanctionsPerimeterControl"),
      ws.indexOf("/>", ws.indexOf("<SanctionsPerimeterControl")));
    expect(call).toMatch(/onChanged=\{\(\) => \{ screeningStage\.reload\(\); load\(\); \}\}/);
  });

  it("reads the perimeter from the server's sync, not from local state", () => {
    const call = ws.slice(
      ws.indexOf("<SanctionsPerimeterControl"),
      ws.indexOf("/>", ws.indexOf("<SanctionsPerimeterControl")));
    expect(call).toMatch(/perimeter=\{screeningStage\.sync\?\.perimeter \?\? null\}/);
  });
});

describe("the classify next-action lands on this control", () => {
  const repo = join(__dirname, "../../../..");
  const ws = readFileSync(join(repo, "src/pages/aml/AmlCaseWorkspace.tsx"), "utf8");

  it("opens the existing dialog rather than scrolling or navigating", () => {
    /*
     * This originally asserted a scroll, which is what the CTA did and why it
     * looked broken: the dialog's state was private to the control, so the
     * prominent button could not open it, and when the control was already on
     * screen the click had no visible effect at all.
     */
    const handler = ws.slice(
      ws.indexOf('case "classify_perimeter":'),
      ws.indexOf('case "fix_provider":'));
    expect(handler).toMatch(/setPerimeterDialogOpen\(true\)/);
    expect(handler).not.toMatch(/scrollIntoView/);
    expect(handler).not.toMatch(/navigate\(/);
  });

  it("the parent owns the dialog state and passes it down", () => {
    // One state, two entry points: this CTA and the control's own button.
    expect(ws).toMatch(/const \[perimeterDialogOpen, setPerimeterDialogOpen\] = useState\(false\)/);
    const call = ws.slice(
      ws.indexOf("<SanctionsPerimeterControl"),
      ws.indexOf("/>", ws.indexOf("<SanctionsPerimeterControl")));
    expect(call).toMatch(/open=\{perimeterDialogOpen\}/);
    expect(call).toMatch(/onOpenChange=\{setPerimeterDialogOpen\}/);
  });

  it("an analyst still sees the requirement, and cannot act on it", () => {
    // The card tells everyone the decision is outstanding; only a reviewer or
    // MLRO is given the means to make it.
    renderControl({ canClassify: false, perimeter: null });
    expect(screen.getByText(/not yet classified/i)).toBeTruthy();
    expect(screen.getByText(/sanctions screening is required/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /classify perimeter/i })).toBeNull();
    expect(screen.getByText(/only a reviewer or the mlro can change this/i)).toBeTruthy();
  });
});

describe("7, 20. recording a finding", () => {
  it("sends the classification and reason, and never a required flag", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /classify perimeter/i }));
    fireEvent.click(await screen.findByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(classifyScreeningPerimeter).toHaveBeenCalled());
    const arg = classifyScreeningPerimeter.mock.calls[0][0];
    expect(arg).toMatchObject({
      case_id: CASE_ID,
      classification: "outside_perimeter",
      reason_code: "enquiry_only",
      scopes_excluded: ["sanctions"],
    });
    // The browser states a finding. It never states an outcome.
    expect(arg).not.toHaveProperty("required");
    expect(arg).not.toHaveProperty("state");
  });

  it("excludes sanctions WITHOUT excluding PEP", () => {
    // One finding is not a finding about every control. Pre-ticking PEP would
    // stand down an obligation nobody assessed.
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /classify perimeter/i }));
    expect((screen.getByLabelText(/targeted financial sanctions/i) as HTMLInputElement))
      .toBeTruthy();
    const pep = screen.getByLabelText(/politically exposed person/i);
    expect(pep.getAttribute("data-state") ?? pep.getAttribute("aria-checked"))
      .not.toBe("checked");
  });

  it("refuses to record a finding that excludes nothing", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /classify perimeter/i }));
    fireEvent.click(await screen.findByLabelText(/targeted financial sanctions/i));
    expect(await screen.findByText(/excludes nothing exempts nothing/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /record determination/i }) as HTMLButtonElement)
      .disabled).toBe(true);
  });

  it("4. reloads Stage 5 once the finding is recorded", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /classify perimeter/i }));
    fireEvent.click(await screen.findByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("16. can put a case back inside the perimeter", async () => {
    renderControl({ perimeter: OUTSIDE });
    fireEvent.click(screen.getByRole("button", { name: /reclassify perimeter/i }));
    fireEvent.click(await screen.findByLabelText(/inside perimeter/i));
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(classifyScreeningPerimeter).toHaveBeenCalled());
    const arg = classifyScreeningPerimeter.mock.calls[0][0];
    expect(arg.classification).toBe("designated_service");
    // Inside needs no reason and excludes nothing.
    expect(arg.reason_code).toBeUndefined();
    expect(arg.scopes_excluded).toBeUndefined();
  });
});

describe("6, 8, 19. the Stage 5 headline after classification", () => {
  const notReady = {
    canRun: false, blockers: ["The DFAT list has never been loaded"],
  } as never;
  /*
   * All four, because that is what `sync_screening_stage` sends. A partial
   * fixture leaves the missing scopes to the browser's own fallback rule,
   * which requires adverse media on incomplete answers — and adverse media
   * IS provider-backed, so the blocker would correctly still appear and the
   * test would be measuring the fixture rather than the code.
   */
  const serverScopes = [
    { scope: "sanctions", required: false, optional: true, state: "not_required",
      reason_code: "perimeter:enquiry_only", reason: "An enquiry or quotation." },
    { scope: "pep", required: true, optional: false, state: "required",
      reason_code: "pep_determination_required", reason: "A determination must be established." },
    { scope: "adverse_media", required: false, optional: true, state: "not_required",
      reason_code: "risk_not_triggered", reason: "Not triggered for this profile." },
    { scope: "watchlist", required: false, optional: true, state: "not_required",
      reason_code: "risk_not_triggered", reason: "Not triggered for this profile." },
  ] as never;

  it("stops blaming the provider once sanctions is not required", () => {
    /*
     * This is the bug: `describeScreeningStage` short-circuited on
     * `readiness.canRun` alone, so a case whose only outstanding work was a
     * PEP determination was headlined "Screening cannot run yet — an
     * administrator must restore the screening provider and sanctions data".
     * A blocker about a provider the case does not use, hiding the one thing
     * that actually was outstanding.
     */
    const scope = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes);
    const stage = describeScreeningStage(scope, notReady, false);
    expect(stage.headline).not.toMatch(/cannot run/i);
    expect(stage.whatHappensNext).toMatch(/PEP determination/i);
    expect(stage.whatHappensNext).not.toMatch(/sanctions data/i);
  });

  it("still blames the provider when a required scope needs it", () => {
    const scope = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, null);
    expect(describeScreeningStage(scope, notReady, true).headline)
      .toMatch(/cannot run yet/i);
  });

  it("derives relevance from the scope when the server does not say", () => {
    // An older server sends no `provider_relevant`, so relevance is derived
    // from the scopes it DID send. Same answer by another route.
    const exempt = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, serverScopes);
    expect(describeScreeningStage(exempt, notReady).headline).not.toMatch(/cannot run/i);

    const required = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null, null);
    expect(describeScreeningStage(required, notReady).headline).toMatch(/cannot run yet/i);
  });

  it("a provider-backed scope that is still required keeps the blocker", () => {
    // Sanctions stood down but adverse media kept: the provider is still
    // needed, so the blocker is correct and must not be suppressed.
    const mixed = deriveAmlScreeningScope(
      { answers: null, sanctionsState: "not_started" }, null,
      [
        { scope: "sanctions", required: false, optional: true, state: "not_required",
          reason_code: "perimeter:enquiry_only", reason: "An enquiry." },
        { scope: "pep", required: true, optional: false, state: "required",
          reason_code: "pep_determination_required", reason: "x" },
        { scope: "adverse_media", required: true, optional: false, state: "required",
          reason_code: "risk_triggered", reason: "the case is rated high risk" },
        { scope: "watchlist", required: true, optional: false, state: "required",
          reason_code: "risk_triggered", reason: "the case is rated high risk" },
      ] as never);
    expect(describeScreeningStage(mixed, notReady).headline).toMatch(/cannot run yet/i);
  });

  it("reports complete when nothing required remains", () => {
    const scope = deriveAmlScreeningScope({
      answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
      entityType: "individual",
      sanctionsState: "not_started",
      pepDetermination: {
        result: "not_pep", determinedAt: "2026-08-01T00:00:00.000Z",
        reviewDueAt: "2027-08-01T00:00:00.000Z", supersededAt: null,
      },
      now: "2026-08-18T00:00:00.000Z",
    }, null, serverScopes);
    expect(describeScreeningStage(scope, notReady, false).headline).toMatch(/complete/i);
  });
});
