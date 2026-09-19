import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PassportBook } from "../PassportBook";
import type { BookletPage } from "@/lib/aml/passport";

/**
 * The magnified passport, and the space it is read in.
 *
 * ── What was reported ─────────────────────────────────────────────────
 * "When the passport is zoomed in for a clearer view it cuts out of the
 * screen without the ability for it to be scrolled left/right and up/down."
 * The screenshot showed page IX severed at the dialog's right edge, the turn
 * bar pushed off the bottom, and no scrollbar on either axis.
 *
 * ── The cause, measured in a browser ──────────────────────────────────
 * The scroll container asked for its height with `h-full`. A percentage
 * height resolves against the containing block's height, and the box holding
 * it is a flex ITEM whose height comes from the flex algorithm rather than
 * from a declared length — so `height: 100%` resolved to `auto`, the
 * scroller grew to its own content (1,553px inside a 667px box), and
 * `overflow: auto` had nothing left to clip. The board spilled past the
 * dialog, which clips it. The horizontal scrollbar did exist; it was 1,553px
 * down, off the bottom of the screen.
 *
 * ── What these tests can see ──────────────────────────────────────────
 * jsdom computes no layout, so nothing here can assert a rendered height.
 * What it CAN assert is the rule: the scroller's height must come from flex
 * and never from a percentage, the centring must be done by auto margins
 * rather than by `justify-content`, and the reader's affordances must appear
 * exactly when the DOM says there is somewhere to go. The measurements above
 * were taken against a real Chromium at four viewport sizes.
 */

const leaf = (n: number, title: string): BookletPage => ({
  id: `p${n}`,
  variant: "leaf",
  kicker: `PAGE ${n}`,
  title,
  numeral: String(n),
  blocks: [],
});

const PAGES: BookletPage[] = [
  { id: "cover", variant: "cover", kicker: "", title: "Cover", numeral: null, blocks: [] },
  leaf(1, "Client Identity"),
  leaf(2, "Compliance Summary"),
  leaf(3, "Identity Verification"),
];

const mount = () => render(<PassportBook pages={PAGES} />);

const boardOf = (c: HTMLElement) => c.querySelector(".passport-board") as HTMLElement;
const scrollerOf = (c: HTMLElement) => boardOf(c).parentElement as HTMLElement;

/** jsdom reports 0 for every scroll metric; this is how the DOM is told it
 *  has somewhere to go. */
function stubOverflow(el: HTMLElement, over: boolean) {
  const set = (k: string, v: number) =>
    Object.defineProperty(el, k, { value: v, configurable: true });
  set("clientWidth", 800);
  set("clientHeight", 600);
  set("scrollWidth", over ? 1600 : 800);
  set("scrollHeight", over ? 1200 : 600);
}

describe("the board is a scroll container, and its height comes from flex", () => {
  it("never takes its height from a percentage", () => {
    /* This is the defect itself, and it is a declaration rather than
       behaviour, so it is asserted at its source. `h-full` on the scroller
       is what made a bounded box grow to its content. */
    const src = readFileSync("src/components/aml/passport/design/PassportBook.tsx", "utf8");
    const scroller = src.slice(src.indexOf("ref={scrollerRef}"), src.indexOf("passport-board relative"));
    expect(scroller).not.toMatch(/\bh-full\b/);
    expect(scroller).toMatch(/\bmin-h-0 w-full flex-1\b/);
  });

  it("holds the scroller in a flex column, so flex can give it a height", () => {
    const { container } = mount();
    const area = scrollerOf(container).parentElement!;
    expect(area.className).toContain("flex");
    expect(area.className).toContain("flex-col");
    expect(area.className).toContain("min-h-0");
  });

  it("centres with auto margins rather than with justify-content", () => {
    /* Centring an overflowing box with `justify-content` pins it at a
       negative offset no scrollbar can reach — the start of the document
       becomes unreachable. An auto margin takes the free space when there is
       some and collapses to zero when there is not, so ONE layout serves the
       fitted document and the magnified one. */
    const { container } = mount();
    expect(scrollerOf(container).className).toContain("items-start");
    expect(scrollerOf(container).className).toContain("justify-start");
    expect(boardOf(container).className).toContain("m-auto");
  });

  it("is always a scroll container, whatever the magnification", () => {
    /* The fit has a minimum-scale floor, so a short window draws a leaf
       larger than its space at 100% — the document was cropped before
       anybody touched the zoom. */
    const { container } = mount();
    expect(scrollerOf(container).className).toContain("overflow-auto");
  });
});

describe("the reader is told the document can be moved", () => {
  it("offers nothing while the whole document is on screen", () => {
    const { container } = mount();
    const scroller = scrollerOf(container);
    expect(scroller.className).not.toContain("cursor-grab");
    expect(scroller.getAttribute("tabindex")).toBe("-1");
    expect(scroller.getAttribute("role")).toBeNull();
  });

  it("offers a grab cursor and a keyboard stop once there is somewhere to go", () => {
    const { container } = mount();
    const scroller = scrollerOf(container);
    stubOverflow(scroller, true);
    // Any redraw re-asks the DOM; magnifying is the one a reader performs.
    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));
    expect(scroller.className).toContain("cursor-grab");
    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("role")).toBe("region");
    expect(scroller.getAttribute("aria-label")).toMatch(/scrollable/i);
  });

  it("asks the DOM rather than assuming a magnified board must overflow", () => {
    /* `zoom > 1` was neither necessary nor sufficient: one leaf at 125% in a
       wide dialog still fits, and it used to shunt a centred document into
       the corner the moment anybody touched the zoom. */
    const { container } = mount();
    const scroller = scrollerOf(container);
    stubOverflow(scroller, false);
    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));
    expect(scroller.className).not.toContain("cursor-grab");
    expect(scroller.getAttribute("tabindex")).toBe("-1");
  });
});

describe("the arrow keys", () => {
  /* The turn bar's own line — "COVER", "PAGES 1–2 OF 13". Read by its class
     rather than by its words, which differ with how many leaves are up. */
  const pageLabel = (c: HTMLElement) =>
    (c.querySelector(".passport-mono.passport-faint") as HTMLElement).textContent ?? "";

  it("turn the page from the chrome, as they always have", () => {
    const { container } = mount();
    const before = pageLabel(container);
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: "ArrowRight" });
    expect(pageLabel(container)).not.toBe(before);
  });

  it("move the document instead when the reader is standing in a magnified board", () => {
    /* Panning is what the arrows mean inside a document bigger than its
       window. Previous / Next and the page chips still turn the page, so
       nothing is lost. */
    const { container } = mount();
    const scroller = scrollerOf(container);
    stubOverflow(scroller, true);
    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));
    const before = pageLabel(container);
    fireEvent.keyDown(scroller, { key: "ArrowRight" });
    expect(pageLabel(container)).toBe(before);
  });

  it("still turn the page from a board with nothing to pan", () => {
    const { container } = mount();
    const before = pageLabel(container);
    fireEvent.keyDown(scrollerOf(container), { key: "ArrowRight" });
    expect(pageLabel(container)).not.toBe(before);
  });
});

describe("the scrollbars are drawn, because a hidden affordance is no affordance", () => {
  it("styles them in the document's own palette", () => {
    /* The platform default is either browser chrome bolted onto a navy
       dialog or, where the browser uses overlay scrollbars, nothing visible
       at all until something has already been scrolled. */
    const css = readFileSync("src/styles/passport-tokens.css", "utf8");
    expect(css).toMatch(/\.passport-pan \{[^}]*scrollbar-width:\s*thin/s);
    expect(css).toContain(".passport-pan::-webkit-scrollbar");
    expect(css).toContain(".passport-pan::-webkit-scrollbar-thumb");
    // The stylesheet states how the bars look and never whether they exist:
    // that is a measurement, and only the component can make it.
    const rule = css.slice(css.indexOf(".passport-pan {"), css.indexOf(".passport-pan::"));
    expect(rule).not.toMatch(/\boverflow\b/);
  });
});
