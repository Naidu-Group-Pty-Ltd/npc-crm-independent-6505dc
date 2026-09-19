export const PAGE = { width: 595, height: 842 } as const;
export const FOOTER_HEIGHT = 22;

/**
 * Macro scan — the measurement itself, with no templates attached.
 *
 * ## What this catches that the spec suite does not
 *
 * The per-format catalogue specs assert structure: fifty masters, unique slugs,
 * distinct manifests, a colourway that repaints and never moves anything. They
 * render with `SAMPLE_REPORT_DATA` and assert no page comes out blank.
 *
 * None of that looks at the *boxes*. A block whose declared height is larger
 * than the space left under it does not fail any of those assertions — it
 * prints over the next block, and `flow()` cannot see it because `flow()` is
 * the thing that placed them. Nor do they look across the two authoring
 * systems at once: the forty-three voice templates and the five hundred family
 * masters are asserted separately, so a defect class present in both is
 * reported twice and fixed once.
 *
 * So this walks all 543 as one set and measures what the authoring helpers
 * actually emitted:
 *
 *  - a box that leaves the page, or runs under the footer band
 *  - two boxes on one page that overlap
 *  - a degenerate box (zero or negative width/height)
 *  - a binding that is malformed rather than merely unresolved
 *  - a page whose every block is conditional, which can draw completely blank
 *  - a duplicate page name inside one template, which makes a conditional
 *    ambiguous to read and a screenshot impossible to address
 *
 * It is a *reporting* tool and fixes nothing. Read the report, fix the source,
 * re-run. `npm run templates:macro-scan`.
 *
 * Kept free of template imports so the negative control in
 * `macroScan.spec.ts` can plant a defect without pulling 543 templates and
 * 7,449 pages into a unit test.
 */

export interface Finding {
  kind: string;
  template: string;
  reportType: string;
  page: string;
  detail: string;
}

/**
 * Blocks that legitimately sit in or below the footer band.
 *
 * The running foot and the page number are placed *into* that reserve on
 * purpose, so measuring them against it would report every page of every
 * template.
 */
const FOOTER_BLOCKS = new Set(['page-number', 'running-head', 'footer-block']);

/**
 * A block that deliberately runs to the trim.
 *
 * Luxury Editorial is a monograph: `platePage({ bleed: true })` sets the plate
 * at the full sheet on purpose, and such a page carries neither running head
 * nor page number, so there is no footer band for it to run under. Measuring a
 * bleed against the text-page reserve reports the design rather than a defect.
 */
function isFullBleed(box: { x: number; y: number; w: number; h: number },
  pageW: number, pageH: number): boolean {
  return box.x <= 0 && box.y <= 0 && box.w >= pageW && box.h >= pageH;
}

/**
 * A caption scrim over a photograph, which is a composition and not a collision.
 *
 * The bleed plate's foot is a `hero` carrying `tint`/`tintFade` — a ramped
 * 0.55-opacity wash that exists precisely so reversed type stays legible over
 * an unknown picture. It is *supposed* to sit on the image. So an intersection
 * is only reported when neither party is a deliberate wash over the other.
 */
function isScrimOver(a: any, b: any): boolean {
  const wash = (x: any) => x?.type === 'hero'
    && (x?.props?.tintFade === true || typeof x?.props?.tint === 'string');
  const picture = (x: any) => x?.type === 'image';
  return (wash(a) && picture(b)) || (wash(b) && picture(a));
}

/** A box, in the renderer's own coordinates. */
function boxOf(b: any): { x: number; y: number; w: number; h: number } | null {
  const p = b?.props ?? {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const x = n(p.x); const y = n(p.y); const w = n(p.width); const h = n(p.height);
  if (y === null) return null;
  return { x: x ?? 0, y, w: w ?? 0, h: h ?? 0 };
}

/** Every string value anywhere in a block's props. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/**
 * Scan one template, appending to `findings`.
 *
 * Exported so the negative control can plant a defect and assert it is caught —
 * a scan whose result over the library is zero has to prove it can find
 * something, or zero means nothing.
 */
export function scanTemplate(template: any, reportType: string, findings: Finding[]): void {
  const add = (kind: string, tName: string, rType: string, page: string, detail: string) => {
    findings.push({ kind, template: tName, reportType: rType, page, detail });
  };
  const name: string = template.slug ?? template.name ?? '(unnamed)';
  const pages: any[] = template.schema?.pages ?? [];
  const seenPageNames = new Map<string, number>();

  for (const page of pages) {
    const pageName: string = page.name ?? '(unnamed page)';
    seenPageNames.set(pageName, (seenPageNames.get(pageName) ?? 0) + 1);

    const pageH = page.size?.height ?? PAGE.height;
    const pageW = page.size?.width ?? PAGE.width;
    const blocks: any[] = page.blocks ?? [];

    // ── a page that can draw entirely blank ──────────────────────────────
    // Every block conditional means every block can be absent at once. The
    // page itself is then an empty sheet with a footer on it. A page-level
    // conditional is the fix, and most already have one.
    const drawable = blocks.filter((b) => !FOOTER_BLOCKS.has(b.type));
    if (drawable.length > 0 && drawable.every((b) => b.conditional) && !page.conditional) {
      add('blank-page-risk', name, reportType, pageName,
        `all ${drawable.length} content blocks are conditional but the page is not`);
    }

    const boxes: Array<{ b: any; box: NonNullable<ReturnType<typeof boxOf>> }> = [];

    for (const b of blocks) {
      const box = boxOf(b);

      // ── malformed bindings ───────────────────────────────────────────
      for (const s of strings(b.props)) {
        const opens = (s.match(/\{\{/g) ?? []).length;
        const closes = (s.match(/\}\}/g) ?? []).length;
        if (opens !== closes) {
          add('malformed-binding', name, reportType, pageName,
            `${b.type}: unbalanced braces in ${JSON.stringify(s.slice(0, 80))}`);
        }
        if (/\{\{\s*\}\}/.test(s)) {
          add('malformed-binding', name, reportType, pageName,
            `${b.type}: empty binding {{}}`);
        }
      }

      if (!box) continue;

      // ── degenerate boxes ─────────────────────────────────────────────
      if (box.w < 0 || box.h < 0) {
        add('negative-box', name, reportType, pageName,
          `${b.type}: ${box.w}×${box.h} at (${box.x}, ${Math.round(box.y)})`);
      }

      // ── off the sheet ────────────────────────────────────────────────
      if (box.y < 0 || box.x < 0) {
        add('off-page', name, reportType, pageName,
          `${b.type}: origin (${Math.round(box.x)}, ${Math.round(box.y)}) is negative`);
      }
      if (box.x + box.w > pageW + 1) {
        add('off-page', name, reportType, pageName,
          `${b.type}: right edge ${Math.round(box.x + box.w)} past page width ${pageW}`);
      }
      if (box.y + box.h > pageH + 1) {
        add('off-page', name, reportType, pageName,
          `${b.type}: bottom ${Math.round(box.y + box.h)} past page height ${pageH}`);
      }

      const bleeds = isFullBleed(box, pageW, pageH);
      // A page carrying a bleed has no footer band — the running head and page
      // number are not drawn on a plate — so nothing on it can run "under" one.
      const pageBleeds = blocks.some((x) => {
        const bx = boxOf(x);
        return bx ? isFullBleed(bx, pageW, pageH) : false;
      });

      // ── into the footer band ─────────────────────────────────────────
      if (!FOOTER_BLOCKS.has(b.type) && box.h > 0 && !bleeds && !pageBleeds) {
        const bottom = box.y + box.h;
        const footerTop = pageH - FOOTER_HEIGHT;
        if (bottom > footerTop + 1) {
          add('under-footer', name, reportType, pageName,
            `${b.type}: bottom ${Math.round(bottom)} runs under the footer band (top ${footerTop})`);
        }
      }

      if (box.h > 0 && box.w > 0 && !FOOTER_BLOCKS.has(b.type)) boxes.push({ b, box });
    }

    // ── declared overlap ─────────────────────────────────────────────────
    // Only between blocks that can both be present. Two blocks under
    // *different* conditionals may be alternatives by design; two with no
    // conditional at all are always both drawn, so an intersection is a
    // guaranteed collision rather than a possible one.
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const A = boxes[i]; const B = boxes[j];
        if (A.b.conditional || B.b.conditional) continue;
        if (isScrimOver(A.b, B.b)) continue;
        const a = A.box; const b2 = B.box;
        const dx = Math.min(a.x + a.w, b2.x + b2.w) - Math.max(a.x, b2.x);
        const dy = Math.min(a.y + a.h, b2.y + b2.h) - Math.max(a.y, b2.y);
        if (dx > 1 && dy > 1) {
          add('overlap', name, reportType, pageName,
            `${A.b.type} over ${B.b.type} by ${Math.round(dy)}pt vertically`);
        }
      }
    }
  }

  for (const [pageName, count] of seenPageNames) {
    if (count > 1) {
      add('duplicate-page-name', name, reportType, pageName, `appears ${count} times`);
    }
  }
}

