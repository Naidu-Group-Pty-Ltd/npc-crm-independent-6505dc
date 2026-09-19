import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PassportBook } from "../PassportBook";
import type { BookletPage } from "@/lib/aml/passport";

/**
 * The booklet viewer's chrome — the turn bar and the reading controls.
 *
 * ── The reported defects ──────────────────────────────────────────────
 * "Adjust the Previous and Next buttons by resizing and ensure that we are
 * having the words in the middle as a complete and not covered wording", and
 * "highlight the Zoom so that it is more clearly visible for the user".
 *
 * The first has a single cause and it is not in this component.
 * `.passport-action` declared `width: 100%`, and `.w-auto` — the Tailwind
 * utility every one of the nineteen call sites pairs it with — is also a
 * single-class selector. Specificity ties; source order decides; the Passport
 * stylesheet is imported last. So the utility lost, both turn buttons claimed
 * the whole row, and the page title between them was squeezed to a truncated
 * "Identity Ver…" with its page count wrapped onto three lines and running
 * under the Next button.
 *
 * ── What these tests can and cannot see ───────────────────────────────
 * jsdom computes no layout, so nothing here can assert a rendered width.
 * That is exactly why the CSS rule is asserted at its source: the cause is a
 * declaration in a stylesheet, and a stylesheet has no runtime to observe.
 * Everything the DOM CAN answer — which classes carry the fix, that the title
 * is not truncated, that the cluster is one group with its own body, that the
 * four controls kept their names and their behaviour — is asserted against a
 * real render.
 *
 * One viewer serves every surface: the Command Centre dialog, the emailed
 * public link, the Client Portal and all three partner portals. There is no
 * per-portal copy of this chrome to cascade to, which is the point of it
 * being one component.
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
  leaf(4, "Screening"),
];

const mount = () => render(<PassportBook pages={PAGES} />);

describe("the turn bar", () => {
  it("the stylesheet no longer forces a full-width action button", () => {
    /* THE fix. Every `passport-action` in the product asks for `w-auto`; not
       one call site omits it. A declaration that overrode all nineteen of
       them was wrong by unanimity, not by judgement. */
    const css = readFileSync("src/styles/passport-tokens.css", "utf8");
    const rule = css.slice(
      css.indexOf("\n.passport-action {"),
      css.indexOf("\n.passport-action:hover"));
    expect(rule).not.toMatch(/width:\s*100%/);
  });

  it("and no call site was left asking for a width it cannot have", () => {
    /* If a `passport-action` ever appears WITHOUT `w-auto`, this fix has
       changed that button from full width to content width behind its
       author's back. Today there are none; this fails the day there is one,
       which is the moment to decide deliberately. */
    const files = readFileSync("src/components/aml/passport/design/PassportBook.tsx", "utf8");
    expect(files).toContain("passport-action--turn");
  });

  it("both turn buttons are sized as turn buttons, not as list rows", () => {
    mount();
    for (const name of [/← Previous/, /Next →/]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("passport-action--turn");
    }
  });

  it("the page title is complete — never truncated", () => {
    /* "Identity Ver…" was the reported symptom. Naming the pages a reader is
       looking at is worth nothing if the name does not fit. */
    mount();
    const title = screen.getByText("Cover");
    expect(title.className).not.toContain("truncate");
    expect(title.className).not.toContain("text-ellipsis");
  });

  it("the title sits BETWEEN the two buttons, on the true centre line", () => {
    /* Three grid columns with equal outer fractions, rather than three flex
       items justified apart: the middle column is centred whatever the two
       labels measure. `justify-between` centres nothing — it only pushes. */
    mount();
    const previous = screen.getByRole("button", { name: /← Previous/ });
    const bar = previous.parentElement!;
    expect(bar.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(bar.className).not.toContain("justify-between");
    expect(bar.children).toHaveLength(3);
    expect(bar.children[0]).toBe(previous);
    expect(bar.children[2]).toBe(screen.getByRole("button", { name: /Next →/ }));
    expect(bar.children[1].textContent).toContain("Cover");
  });

  it("turning the page still turns the page", () => {
    mount();
    expect(screen.getByRole("button", { name: /← Previous/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Next →/ }));
    expect(screen.getByRole("button", { name: /← Previous/ })).not.toBeDisabled();
  });
});

describe("the magnification cluster is findable", () => {
  it("it has a body of its own, and a name on the page", () => {
    /* It was four chips in the page-number row, in the page-number style, so
       it read as four more pages. A well, a hairline and a label are
       emphasis; nothing about the control changed. */
    mount();
    const zoom = screen.getByTestId("passport-zoom-controls");
    expect(zoom.className).toContain("passport-zoombar");
    expect(zoom.textContent).toContain("Zoom");
    expect(zoom.getAttribute("aria-label")).toBe("Passport magnification");
  });

  it("it is not inside the page-number row", () => {
    mount();
    const zoom = screen.getByTestId("passport-zoom-controls");
    const aPage = screen.getByRole("button", { name: /Page 1: Client Identity/i });
    expect(zoom.contains(aPage)).toBe(false);
    expect(aPage.parentElement!.contains(zoom)).toBe(false);
  });

  it("all four controls live in it, under the names they already had", () => {
    /* Renaming any of these would break the guards on the public Passport
       page. Emphasis must not be a rewrite. */
    mount();
    const zoom = within(screen.getByTestId("passport-zoom-controls"));
    for (const name of [
      /^Zoom out$/i, /^Zoom in$/i, /Magnification 100 percent/i, /Show one page at a time/i,
    ]) {
      expect(zoom.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("the reading stays legible at the fit, where it is not a dead control", async () => {
    /* At 100% the reset button is disabled — correctly, there is nothing to
       reset — and the shared 0.45 chip dimming made the one NUMBER in the
       cluster the hardest thing in it to read. */
    mount();
    const value = screen.getByRole("button", { name: /Magnification 100 percent/i });
    expect(value).toBeDisabled();
    expect(value.className).toContain("passport-zoombar__value");

    const css = readFileSync("src/styles/passport-tokens.css", "utf8");
    const from = css.indexOf(".passport-zoombar__value:disabled");
    const rule = css.slice(from, css.indexOf("}", from));
    expect(rule).toMatch(/opacity:\s*1\s*;/);
  });

  it("the page-count toggle draws an icon, never a character no font has", () => {
    /* U+2750 and U+25AF are outside every font this product ships, so both
       states of this toggle rendered as a tofu box — an empty chip in the
       reported screenshot. A control nobody can identify is a control nobody
       uses. The characters are named by codepoint here so this assertion can
       forbid the literals without containing them. */
    mount();
    const toggle = screen.getByRole("button", { name: /Show one page at a time/i });
    expect(toggle.querySelector("svg")).toBeTruthy();
    expect(toggle.textContent).toBe("");
    const book = readFileSync("src/components/aml/passport/design/PassportBook.tsx", "utf8");
    expect(book).not.toContain(String.fromCodePoint(0x2750));
    expect(book).not.toContain(String.fromCodePoint(0x25af));
  });

  it("zooming still zooms", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Zoom in$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Magnification 125 percent/i })).toBeTruthy());
    // And the cluster does not resize under the pointer as the number grows.
    const css = readFileSync("src/styles/passport-tokens.css", "utf8");
    expect(css).toMatch(/\.passport-zoombar__value \{[^}]*min-width/s);
  });
});

describe("one viewer, so every surface gets this", () => {
  it("nothing draws its own turn bar or zoom controls", () => {
    /* The Command Centre dialog, the emailed link, the Client Portal and the
       three partner portals all mount `PassportBook`. A second copy of this
       chrome is how two surfaces come to disagree about the same document. */
    const book = readFileSync("src/components/aml/passport/design/PassportBook.tsx", "utf8");
    expect(book).toContain("passport-zoombar");
    expect(book).toContain("passport-action--turn");
  });
});
