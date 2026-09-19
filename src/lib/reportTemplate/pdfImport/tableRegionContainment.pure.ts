/**
 * Contain an unverified table, not the page it sits on.
 *
 * WHAT THIS CHANGES
 * -----------------
 * `critical-visual-containment-v1` treats ANY reconstructed table as unverified
 * (`unverifiedTableNativeEnabled` is false by default and fixed in code), and
 * that veto is right: a native table can put a value in the wrong cell, silently,
 * in a document about somebody's money. A source crop shows exact pixels; a
 * native table only claims to.
 *
 * The veto is right. Its SCOPE is not. The remedy rasterizes the whole page, so
 * everything else on it — headings, prose, page furniture, none of which is
 * under suspicion — becomes pixels too. Measured on a production import
 * (template 355c6c63, 8 pages):
 *
 *     6 of 8 pages forced to raster-only, every one of them
 *     `unsafe_table_source_page_used`
 *     the 2 pages that stayed native are exactly the 2 with no table overlay
 *     scores on the rasterized pages: 0.80–0.87
 *     scores on the pages that stayed native: 0.75, 0.77
 *
 * The rasterized pages scored HIGHER. Nothing was wrong with them except that
 * they contained a table. In the rendered PDF that costs 2,199 of 3,756
 * characters — 59% of the document has no text layer at all: unsearchable,
 * unselectable, uncopyable, and unreadable to a screen reader.
 *
 * THE SAME GUARANTEE, AT REGION SCALE
 * -----------------------------------
 * The page raster IS the pixel source, and it is already signed and resolved at
 * render time for exactly this reason. A window onto it, positioned over the
 * table's own box, shows the identical pixels the full-page raster would have
 * shown there — so the table's fidelity is unchanged — while the rest of the
 * page keeps its text.
 *
 * No new artifact, no new signing path, and nothing about a table becomes more
 * trusted than it was.
 *
 * WHEN IT REFUSES
 * ---------------
 * Narrowing the scope has to be provably safe, so it is refused unless every
 * one of these holds. Refusing costs nothing — the caller keeps today's
 * full-page raster, so this can never be worse than the behaviour it replaces:
 *
 *   - Every critical defect on the page is a TABLE defect. One chart, picture,
 *     dense-vector or coverage defect and the page's own scope stands.
 *   - A source raster is available. It is the pixels.
 *   - Every unsafe table has a usable box inside the page.
 *   - The windows do not cover most of the page. Past that they ARE the page,
 *     and a full-page raster is the simpler way to say the same thing.
 *
 * Pure and deterministic.
 */

export interface ContainmentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Points added around a table's box before it becomes a window. */
export const CONTAINMENT_PAD_PT = 2;

/**
 * Share of the page above which region containment stops being worth it.
 *
 * Windows covering most of the sheet reproduce the full-page raster with extra
 * machinery and extra seams. The page-scope fallback is the same picture.
 */
export const MAX_CONTAINED_AREA_SHARE = 0.6;

/**
 * Share of an overlay that must lie inside a window before it is suppressed.
 *
 * The window paints source pixels over that area, so anything essentially
 * inside it would be a second copy of content the crop already shows. A
 * page-spanning backdrop is nowhere near this threshold and is never touched.
 */
export const MIN_OVERLAY_INSIDE_SHARE = 0.8;

export interface ContainmentDefectInput {
  severity: string;
  contentKind: string | null;
}

export interface ContainmentOverlayInput {
  id: string;
  kind: string;
  bbox?: ContainmentBox | null;
}

export interface TableRegionContainmentInput {
  defects: readonly ContainmentDefectInput[];
  overlays: readonly ContainmentOverlayInput[];
  pageWidth: number;
  pageHeight: number;
  sourceRasterAvailable: boolean;
}

export interface ContainmentWindow extends ContainmentBox {
  /** Overlay ids this window covers, and which must not also render natively. */
  overlayIds: string[];
}

export interface TableRegionContainmentPlan {
  windows: ContainmentWindow[];
  /** Every overlay id suppressed across all windows, deduplicated. */
  suppressedOverlayIds: string[];
  /** Share of the page the windows cover, for the audit record. */
  coveredAreaShare: number;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseBox(
  box: ContainmentBox | null | undefined,
  pageWidth: number,
  pageHeight: number,
  padPt: number,
): ContainmentBox | null {
  const x = finite(box?.x);
  const y = finite(box?.y);
  const width = finite(box?.width);
  const height = finite(box?.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (width <= 0 || height <= 0) return null;
  const left = Math.max(0, x - padPt);
  const top = Math.max(0, y - padPt);
  const right = Math.min(pageWidth, x + width + padPt);
  const bottom = Math.min(pageHeight, y + height + padPt);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlaps(a: ContainmentBox, b: ContainmentBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function union(a: ContainmentBox, b: ContainmentBox): ContainmentBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** Share of `inner`'s area that lies within `outer`. */
export function insideShare(inner: ContainmentBox, outer: ContainmentBox): number {
  const area = inner.width * inner.height;
  if (!(area > 0)) return 0;
  const w = Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x));
  const h = Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y));
  return (w * h) / area;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Decide whether a page's table veto can be served by windows instead of by
 * rasterizing the page. Returns null to mean "keep the page-scope fallback".
 */
export function planTableRegionContainment(
  input: TableRegionContainmentInput,
): TableRegionContainmentPlan | null {
  if (!input.sourceRasterAvailable) return null;

  const criticals = input.defects.filter((d) => d?.severity === 'critical');
  if (!criticals.length) return null;
  // One non-table critical defect and this page's own scope stands: the other
  // kinds say something is wrong somewhere the table windows do not cover.
  if (!criticals.every((d) => d?.contentKind === 'table')) return null;

  const pageWidth = finite(input.pageWidth);
  const pageHeight = finite(input.pageHeight);
  if (pageWidth == null || pageHeight == null || pageWidth <= 0 || pageHeight <= 0) return null;

  const tables = input.overlays.filter((o) => o?.kind === 'table');
  if (!tables.length) return null;

  const boxes: ContainmentBox[] = [];
  for (const table of tables) {
    const box = normaliseBox(table.bbox, pageWidth, pageHeight, CONTAINMENT_PAD_PT);
    // A table we cannot place is a table we cannot contain. The page keeps its
    // own scope rather than leaving one unverified table rendering natively.
    if (!box) return null;
    boxes.push(box);
  }

  // Merge windows that touch, so no two windows paint the same pixels twice.
  const merged: ContainmentBox[] = [];
  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hit = merged.findIndex((m) => overlaps(m, box));
    if (hit >= 0) merged[hit] = union(merged[hit], box);
    else merged.push(box);
  }
  // Merging can create new overlaps; settle them.
  let settled = false;
  while (!settled) {
    settled = true;
    outer: for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        if (overlaps(merged[i], merged[j])) {
          merged[i] = union(merged[i], merged[j]);
          merged.splice(j, 1);
          settled = false;
          break outer;
        }
      }
    }
  }

  const coveredArea = merged.reduce((sum, m) => sum + m.width * m.height, 0);
  const share = coveredArea / (pageWidth * pageHeight);
  if (share > MAX_CONTAINED_AREA_SHARE) return null;

  const windows: ContainmentWindow[] = merged.map((box) => ({
    x: round3(box.x),
    y: round3(box.y),
    width: round3(box.width),
    height: round3(box.height),
    overlayIds: input.overlays
      .filter((o) => o?.id && o.bbox && insideShare(o.bbox, box) >= MIN_OVERLAY_INSIDE_SHARE)
      .map((o) => o.id),
  }));

  return {
    windows,
    suppressedOverlayIds: [...new Set(windows.flatMap((w) => w.overlayIds))],
    coveredAreaShare: round3(share),
  };
}
