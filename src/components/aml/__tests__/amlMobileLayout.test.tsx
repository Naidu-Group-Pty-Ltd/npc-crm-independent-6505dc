/**
 * The AML/CTF Command Centre on a phone.
 *
 * ── What was measured ─────────────────────────────────────────────────
 * Every surface here was rendered into a real Chromium at 390×844 and at
 * every width from 390 to 768. jsdom computes no layout, so these tests
 * assert the RULES the measurements produced — a declared flex basis, a
 * cluster that is allowed to shrink, one layout at a time — rather than
 * pixel widths it cannot see.
 *
 * The numbers in the comments are from those renders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AmlPageHeader } from "@/components/aml/primitives";
import { AmlWorkspaceHeader } from "@/components/aml/workspace/AmlWorkspaceHeader";
import { AmlJourneyRail } from "@/components/aml/workspace/AmlJourneyRail";
import type { AmlCase } from "@/lib/aml/amlCasesApi";
import { austracKindChip, austracStatusLabel } from "@/lib/aml/austracDraftGuidance.pure";

const read = (p: string) => readFileSync(p, "utf8");

describe("a page header wraps rather than crushing its own title", () => {
  /*
    `flex-1` alone is `flex: 1 1 0%`. A flex line wraps when its items'
    HYPOTHETICAL sizes overflow it, and a basis of zero contributes nothing
    — so the line never overflowed, never wrapped, and the title took
    whatever was left after the action cluster had taken its content width.
    With `min-w-0` beside it, that could be eighteen pixels.

    Measured on the AUSTRAC hub, whose actions are Refresh and Start AUSTRAC
    Report: at 430px the heading box was 18px wide and 532px TALL — one
    character per line — and it was still broken at 480, 560 and 640. It
    escaped notice at 390 only because the action cluster alone overflows
    there and forces the wrap by itself.
  */
  it("gives the title column a flex basis to wrap against", () => {
    const { container } = render(
      <AmlPageHeader title="AUSTRAC Reporting Hub" description="…" actions={<button>Start</button>} />,
    );
    const title = container.querySelector("h2")!.closest("div.flex-1") as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.className).toMatch(/\bbasis-\d/);
    expect(title.className).toContain("min-w-0");
  });

  it("keeps the actions in a cluster that can wrap", () => {
    const { container } = render(
      <AmlPageHeader title="T" actions={<button>Start AUSTRAC Report</button>} />,
    );
    const row = container.querySelector("header > div") as HTMLElement;
    expect(row.className).toContain("flex-wrap");
  });
});

describe("the case header does not push itself off the screen", () => {
  const caseRow = {
    id: "c1", case_reference: "AML-2026-00001", subject_type: "individual",
    subject_display_name: "Avery Client", status: "kyc_complete", risk_rating: "medium",
    client_id: null, purchase_file_id: null, risk_score: null,
    assigned_analyst_id: null, assigned_mlro_id: null,
    opened_at: "2026-08-01T00:00:00Z", closed_at: null, metadata: {}, created_by: null,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
  } as AmlCase;

  it("lets the badge cluster shrink, so it wraps instead of overflowing", () => {
    /* It was `shrink-0`. A flex item that cannot shrink keeps its
       max-content width — the three controls in one row, 418px — so on a
       390px screen it hung 44px past the right edge, "Service gate: Under
       review" was cut in half, and the whole workspace scrolled sideways.
       The badges carry their own nowrap, so letting the CLUSTER shrink
       compresses nothing: it wraps, which is what `flex-wrap` was for. */
    const { container } = render(
      <MemoryRouter>
        <AmlWorkspaceHeader caseRow={caseRow} onClose={() => {}} />
      </MemoryRouter>,
    );
    const cluster = container.querySelector('[aria-label="Case position"]') as HTMLElement;
    expect(cluster.className).toContain("flex-wrap");
    expect(cluster.className).not.toMatch(/\bshrink-0\b/);
  });

  it("still gives the identity block a basis to wrap against", () => {
    const src = read("src/components/aml/workspace/AmlWorkspaceHeader.tsx");
    expect(src).toMatch(/min-w-0 flex-1 basis-\d/);
  });
});

describe("the journey rail brings the open stage into view", () => {
  /*
    Ten stages need ~880px; a phone shows four. Clicking a step focuses it
    and the browser scrolls focus into view — but ARRIVING is most of the
    cases and none of them focus anything: a `?stage=` deep link, the
    Previous/Next stage buttons under the content, the next-action card and
    every link from Compliance Home. The rail stayed parked on Activation
    while the reader was on Screening, with the stage they were actually on
    clipped at the right-hand edge.
  */
  const stage = (n: number, id: string, label: string) => ({
    id, number: n, label, shortLabel: label, status: "not_started" as const,
    attention: "none" as const, blocking: false, aheadOfSequence: false,
    owner: "none" as const, ownerLabel: "", href: null,
  });
  const journey = {
    stages: Array.from({ length: 10 }, (_, i) => stage(i + 1, `s${i + 1}`, `Stage ${i + 1}`)),
  } as never;
  const visible = new Set(Array.from({ length: 10 }, (_, i) => `s${i + 1}`)) as never;

  const mountRail = (active: string) => render(
    <AmlJourneyRail
      journey={journey}
      activeStageId={active as never}
      visibleStages={visible}
      onSelectStage={() => {}}
    />,
  );

  it("marks each step so the rail can find the open one without a ref per step", () => {
    const { container } = mountRail("s5");
    expect(container.querySelector('[data-stage="s5"]')).toBeTruthy();
    expect(container.querySelector('[data-stage="s5"]')?.getAttribute("aria-current")).toBe("step");
  });

  it("scrolls the open stage to the middle when the rail overflows", () => {
    const view = render(
      <AmlJourneyRail
        journey={journey} activeStageId={"s1" as never} visibleStages={visible}
        onSelectStage={() => {}}
      />,
    );
    const rail = view.container.querySelector("ol") as HTMLOListElement;
    const scrollTo = vi.fn();
    Object.defineProperty(rail, "scrollTo", { value: scrollTo, configurable: true });
    Object.defineProperty(rail, "clientWidth", { value: 390, configurable: true });
    Object.defineProperty(rail, "scrollWidth", { value: 880, configurable: true });
    const step = rail.querySelector('[data-stage="s7"]') as HTMLElement;
    Object.defineProperty(step, "offsetLeft", { value: 528, configurable: true });
    Object.defineProperty(step, "offsetWidth", { value: 88, configurable: true });

    // Arriving on stage 7 without anything on the rail taking focus — a
    // `?stage=` deep link, the Next-stage button, the next-action card.
    view.rerender(
      <AmlJourneyRail
        journey={journey} activeStageId={"s7" as never} visibleStages={visible}
        onSelectStage={() => {}}
      />,
    );
    // 528 - (390 - 88) / 2 = 377, clamped to the 490px of travel available.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 377 }));
  });

  it("does nothing at all when every stage already fits", () => {
    /* A rail that fits must not move: scrolling a strip that is not
       scrollable is how a page comes to jump on a desktop for a fix that
       was only ever needed on a phone. */
    const { container } = mountRail("s5");
    const rail = container.querySelector("ol") as HTMLOListElement;
    const scrollTo = vi.fn();
    Object.defineProperty(rail, "scrollTo", { value: scrollTo, configurable: true });
    Object.defineProperty(rail, "clientWidth", { value: 900, configurable: true });
    Object.defineProperty(rail, "scrollWidth", { value: 880, configurable: true });
    render(
      <AmlJourneyRail
        journey={journey} activeStageId={"s9" as never} visibleStages={visible}
        onSelectStage={() => {}}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never scrolls the page, only the strip", () => {
    /* `scrollIntoView` can scroll ancestors on both axes. Moving the PAGE
       because a strip inside it moved is worse than the defect being
       fixed. */
    /* Comments are stripped before matching: this file explains WHY it does
       not use that method, and a source scan that trips over its own
       reasoning is a test about prose. */
    const src = read("src/components/aml/workspace/AmlJourneyRail.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toContain("scrollIntoView");
    expect(src).toContain("scrollTo");
  });
});

describe("database vocabulary never reaches a chip", () => {
  it("names a report kind, never its stored value", () => {
    /* The register drew `kind.toUpperCase()`, so a compliance report wore a
       chip reading COMPLIANCE_REPORT — and in a 40px column on a phone it
       set one letter per line and made the row 150px tall. */
    expect(austracKindChip("compliance_report")).toBe("Compliance");
    expect(austracKindChip("compliance")).toBe("Compliance");
    expect(austracKindChip("annual")).toBe("Annual");
    expect(austracKindChip("smr")).toBe("SMR");
    for (const k of ["smr", "ttr", "ifti", "compliance", "annual", "compliance_report"]) {
      expect(austracKindChip(k)).not.toMatch(/_/);
    }
  });

  it("names a report status, never its stored value", () => {
    expect(austracStatusLabel("awaiting_mlro")).toBe("Awaiting MLRO");
    expect(austracStatusLabel("in_review")).toBe("In review");
    expect(austracStatusLabel("submitted")).toBe("Lodged");
    // An unmapped value is still readable rather than absent.
    expect(austracStatusLabel("some_new_status")).toBe("Some new status");
    expect(austracStatusLabel(null)).toBe("—");
  });
});

describe("a link in a sentence is not a control", () => {
  it("does not give every anchor a 44px box below 768px", () => {
    /* The selector was a bare `a`, so under 768px an inline link inside
       running text was given a 44x44 box: its text rode at the top of a
       44px line and stopped sharing the line box with the words around it.
       Compliance Home's one-sentence "Also in this workspace" footer set
       its links 14px above the label beside them and occupied 96px of a
       line that should be 16px.

       The floor is kept for every anchor that IS a control. This asserts
       the rule, not the selector's exact text. */
    const css = read("src/styles/utilities.css");
    const block = css.slice(
      css.indexOf("@media (max-width: 767px)"),
      css.indexOf("/* Touch-friendly utility classes */"),
    );
    expect(block).toMatch(/a:not\(/);
    expect(block).toMatch(/:where\([^)]*\bp\b/);
    // The considered version of this accommodation is still there.
    expect(css).toContain("@media (pointer: coarse)");
  });
});
