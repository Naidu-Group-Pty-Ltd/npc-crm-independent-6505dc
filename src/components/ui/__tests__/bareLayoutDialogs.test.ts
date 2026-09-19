import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `bareLayout` dialog owns its own position — and must actually supply one.
 *
 * ## What happened
 *
 * `PepDeterminationDialog` set `bareLayout` and gave the content only SIZE
 * classes. `bareLayout` drops every positioning class from the shared
 * primitive, so the base is `fixed z-50` and nothing else. A `position:
 * fixed` box with `auto` insets is laid out at its STATIC position — where
 * it would have sat in normal flow — and the portal is appended to
 * `document.body` after the whole application.
 *
 * Measured in Chromium, same component, same page, 1366×768:
 *
 *     without positioning   y = 3000px   inViewport: false
 *     with positioning      y =   38px   inViewport: true
 *
 * So the operator got the scrim and nothing else: a grey screen. Clicking
 * "Record PEP determination" appeared to break the page.
 *
 * ## Why every test passed
 *
 * **jsdom does no layout.** `getBoundingClientRect()` returns zeros,
 * `position: fixed` means nothing, and testing-library happily finds every
 * element in a dialog a real browser never paints. Eleven passing tests
 * drove that dialog end to end while it was invisible in production.
 *
 * That is the lesson worth keeping: a rendered test proves a component
 * MOUNTS, never that it can be SEEN. Anything load-bearing about geometry
 * has to be asserted as a rule, or measured in a real browser.
 */

const root = join(__dirname, "../../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk(root).filter((f) => !f.includes("__tests__"));

/**
 * Anything that gives a fixed box a definite position. `inset-*`, an edge,
 * or a translate — the shared primitive's own default treatment uses
 * exactly these.
 */
const POSITIONING = /\b(inset-|left-|right-|top-|bottom-|translate-|-translate-)/;

/** `<DialogContent … bareLayout … className={…}>` — the whole opening tag. */
const BARE_DIALOG = /<DialogContent\b[^>]*\bbareLayout\b[^>]*>/gs;

/**
 * The class source for one `<DialogContent>` tag: either the literal in the
 * tag, or — when it names a constant — that constant's declaration.
 *
 * `ManualDataOverrideModal` keeps its classes in `manualOverrideLayout.ts`,
 * which is a perfectly good pattern and one a naive scan reports as a
 * violation. Following the identifier is what makes this rule usable rather
 * than something people learn to work around.
 */
function classSourceFor(tag: string, allSources: string): string {
  const named = tag.match(/className=\{([A-Z][A-Z0-9_]*)\}/);
  if (named) {
    const decl = allSources.match(
      new RegExp(`export const ${named[1]}\\s*=\\s*\\[([\\s\\S]*?)\\]`),
    );
    return decl ? decl[1] : "";
  }
  return tag;
}

describe("every bareLayout dialog positions itself", () => {
  const corpus = files.map((f) => readFileSync(f, "utf8")).join("\n");

  it("supplies positioning classes, in the tag or in a named constant", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(BARE_DIALOG)) {
        const classes = classSourceFor(m[0], corpus);
        if (!POSITIONING.test(classes)) {
          offenders.push(file.replace(`${root}/`, ""));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the primitive still drops positioning when bareLayout is set", () => {
    // If this ever stops being true the rule above is pointless — and worse,
    // it would be silently pointless.
    const dialog = readFileSync(join(root, "components/ui/dialog.tsx"), "utf8");
    expect(dialog).toContain("bareLayout?: boolean");
    expect(dialog).toContain("!bareLayout && [");
    // The caller-supplied `className` is applied after the conditional block.
    expect(dialog).toMatch(/!bareLayout && \[[\s\S]*?\],\s*\n\s*className/);
  });

  it("the PEP determination dialog centres on desktop and sheets on mobile", () => {
    // Named explicitly because this is the one that shipped broken.
    const src = readFileSync(
      join(root, "components/aml/PepDeterminationDialog.tsx"), "utf8");
    const tag = src.match(BARE_DIALOG)?.[0] ?? "";
    expect(tag).toContain("inset-x-0");
    expect(tag).toContain("sm:left-1/2");
    expect(tag).toContain("sm:top-1/2");
    expect(tag).toContain("sm:-translate-x-1/2");
    expect(tag).toContain("sm:-translate-y-1/2");
  });
});
