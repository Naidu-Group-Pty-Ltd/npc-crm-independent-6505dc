import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom rewrites import.meta.url to an http
// scheme, so resolve the sources from the working directory instead.
const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const casesPage = read("src/pages/aml/AmlCases.tsx");
const dialogSource = read("src/components/aml/AmlCaseWorkspaceDialog.tsx");
const tabsSource = read("src/components/aml/CaseWorkspaceTabs.tsx");

describe("AML case workspace — centred dialog replaces the right-side Sheet", () => {
  it("the register page no longer renders the case detail in a Sheet", () => {
    expect(casesPage).not.toContain("CaseDetailSheet");
    expect(casesPage).not.toContain('from "@/components/ui/sheet"');
    expect(casesPage).not.toContain("<SheetContent");
    expect(casesPage).toContain("<AmlCaseWorkspaceDialog");
  });

  it("the workspace is a centred, viewport-bounded Dialog", () => {
    expect(dialogSource).toContain('from "@/components/ui/dialog"');
    expect(dialogSource).not.toContain('from "@/components/ui/sheet"');
    expect(dialogSource).toContain("sm:w-[min(94vw,1240px)]");
    expect(dialogSource).toContain("sm:max-h-[92vh]");
    expect(dialogSource).toContain("sm:-translate-x-1/2 sm:-translate-y-1/2");
    // Mobile: full-screen shell; the shell itself never scrolls as one block.
    expect(dialogSource).toContain("h-[100dvh]");
    expect(dialogSource).toContain("overflow-hidden");
  });

  it("the opening contract is preserved: rows, keyboard, deep links, activation", () => {
    // Row click + Enter/Space still route through openCase.
    expect(casesPage).toContain("onClick={() => openCase(c)}");
    expect(casesPage).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    // ?open=<id>&tab=<hint> deep link unchanged.
    expect(casesPage).toContain('searchParams.get("open")');
    expect(casesPage).toContain("setInitialTab(tab)");
    // Activation success still opens the created case.
    expect(casesPage).toContain("openCase(c);");
    // Dialog wiring keeps the original state contract.
    expect(casesPage).toContain("caseId={activeId}");
    expect(casesPage).toContain("initialTab={initialTab}");
    expect(casesPage).toContain("onChanged={load}");
  });

  it("transition rules and API calls are unchanged — presentation only", () => {
    // The legal-transition map moved verbatim into the dialog.
    for (const line of [
      'draft: ["kyc_in_progress", "closed"]',
      'kyc_in_progress: ["kyc_complete", "edd_required", "blocked", "closed"]',
      'kyc_complete: ["under_review", "edd_required", "cleared", "closed"]',
      'edd_required: ["under_review", "escalated_mlro", "blocked", "closed"]',
      'under_review: ["cleared", "escalated_mlro", "edd_required", "blocked", "closed"]',
      'escalated_mlro: ["cleared", "blocked", "closed"]',
      'cleared: ["under_review", "closed"]',
      'blocked: ["under_review", "closed"]',
      "closed: []",
    ]) {
      expect(dialogSource).toContain(line);
    }
    // Same API surface as the Sheet it replaces — nothing new, nothing direct.
    expect(dialogSource).toContain("amlCasesApi.get(");
    expect(dialogSource).toContain("amlCasesApi.transition(");
    expect(dialogSource).not.toMatch(/supabase|invokeSecureFunction|fetch\(/);
  });

  it("destructive transitions are separated and confirmed with a required reason", () => {
    expect(dialogSource).toContain('DESTRUCTIVE_TRANSITIONS = new Set<AmlCaseStatus>(["blocked", "closed"])');
    expect(dialogSource).toContain("AlertDialog");
    expect(dialogSource).toContain("!destructiveReason.trim()");
    // Ordinary transitions keep the optional reason input.
    expect(dialogSource).toContain('placeholder="Reason (optional)"');
  });

  it("statuses render through human-readable labels, not raw enums", () => {
    expect(dialogSource).toContain("CASE_STATUS_LABELS");
    expect(tabsSource).toContain("CASE_STATUS_LABELS[caseRow.status]");
    // The Overview no longer prints the raw status column.
    expect(tabsSource).not.toContain('<Row k="Status" v={caseRow.status} />');
    // Display capitalisation uses the shared name utility (data unchanged).
    expect(dialogSource).toContain("smartCapitalize(caseRow.subject_display_name)");
  });

  it("tabs stay persistent with the active tab body as the scroll region", () => {
    // Workspace mode: Tabs fill the flex parent; each tab body scrolls.
    expect(tabsSource).toContain("fillHeight?: boolean");
    expect(tabsSource).toContain('fillHeight && "flex min-h-0 flex-1 flex-col"');
    expect(tabsSource).toContain("overflow-y-auto overflow-x-hidden");
    expect(dialogSource).toContain("fillHeight");
    // Controlled selection: refreshes don't reset the tab; Overview can jump
    // to the full Audit trail; initialTab deep links still validated.
    expect(tabsSource).toContain("value={tab}");
    expect(tabsSource).toContain("KNOWN_TABS.has(initialTab)");
    expect(tabsSource).toContain('setTab("audit")');
    // Small screens: the tab bar scrolls horizontally instead of wrapping.
    expect(tabsSource).toContain("overflow-x-auto");
  });

  it("uses semantic tokens only — no raw hex colours in the workspace", () => {
    expect(dialogSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(tabsSource).not.toMatch(/text-\[#|bg-\[#|border-\[#/);
  });

  it("reuses the loaded events for the Overview activity preview — no duplicate fetch", () => {
    const overview = tabsSource.slice(
      tabsSource.indexOf("function OverviewTab"),
      tabsSource.indexOf("function InfoCell"),
    );
    expect(overview).toContain("events.slice(0, 4)");
    expect(overview).not.toMatch(/amlCasesApi|listEvents|useEffect/);
  });
});
