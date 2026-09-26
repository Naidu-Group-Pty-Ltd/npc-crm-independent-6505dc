/**
 * Which pictures in an uploaded brochure a report may carry, and which one to
 * suggest.
 *
 * ## Why this exists
 *
 * A new-build report is usually made from the builder's PDF brochure, and the
 * brochure holds the property's own pictures: the facade render of the design
 * on this lot, often its interiors. Nothing read them. The browser rendered
 * the brochure's pages for the parser and sent page images, so the report was
 * written without a single photograph while the cover the owner chose for it
 * was built to carry one (`PROPERTY_PHOTOGRAPHS.md`).
 *
 * ## What happens, in order
 *
 *  1. pdf.js reads the brochure in the browser, page by page. Its operator
 *     list says which image it draws and under which matrix, so this module
 *     knows where each picture sits on its page and how big it is drawn
 *     (`imagePlacements`). pdf.js decodes every encoding the format allows,
 *     so no encoding is guessed at here.
 *  2. Floors that need no pixels refuse what cannot be a report photograph: a
 *     logo or an icon (too small a share of its page), a banner (too extreme a
 *     shape), a picture below the print floor the server holds every report
 *     photograph to, and a raster that IS the page — a scanned or flattened
 *     page, whose "photograph" has the brochure's type baked into it.
 *  3. The server's own judgement of the pixels (`listingImageVision.pure.ts`,
 *     the same module, run on the same 64-pixel square) says which survivors
 *     are photographs and which are floor plans. A plan is offered apart from
 *     the photographs, because it is drawn apart: whole, on a page of its own,
 *     never in a photo slot that crops. A graphic is never offered.
 *  4. The pages are read for the property, in the words the page prints
 *     (`joinPageText`). A page that names this property's lot, or its street
 *     number and street, is where its pictures are; a page naming another lot
 *     is somebody else's (`readBrochurePage`).
 *  5. The adviser is offered what survives, and nothing is sent unless they
 *     tick it (`offerBrochurePhotographs`).
 *
 * ## The owner's rules, and what they decide here
 *
 * A report carries photographs of its own address and property, never a
 * picture chosen to fill a slot. So:
 *
 *  - **Only a page that names this property can offer a picture.** A
 *    builder's brochure is one page about the lot and several about the
 *    builder. The owner's example (Lot 1629 Hornsea Street, Armstrong Creek,
 *    nine pages) names the lot on page 1, beside the design's facade render
 *    and its floor plan. Its page 5 is a couple walking through another
 *    estate, and its page 6 is four photographs of homes the builder has
 *    built elsewhere. Nothing in the pixels says which is which, and the
 *    page's own words are the only evidence there is, so a picture on a page
 *    that names no property is not offered, ticked or not. A brochure that
 *    names the property nowhere offers nothing, and the picker says why.
 *  - **A page that names another lot is that lot's.** A picture drawn there is
 *    never offered, even where the page names this lot too (a price list, a
 *    masterplan), because it could be any of them.
 *  - **One photograph is suggested, and only one.** The largest photograph on
 *    a page that names this property.
 *  - **Furniture is not a photograph.** A picture drawn more than once on a
 *    page, or on three or more pages, is a background, a banner or a
 *    letterhead, and is never offered.
 *
 * Pure: no DOM, no pdf.js import. The operator codes are passed in, so the
 * walk is tested against operator lists written by hand as well as against
 * pdf.js itself (`brochurePhotographsPdf.spec.ts`).
 */
import {
  addressTokens,
  lotDesignation,
  lotsNamedIn,
  MIN_PRINT_LONG_EDGE_PX,
  REPORT_FLOOR_PLAN_LIMIT,
  REPORT_PHOTOGRAPH_LIMIT,
  streetLineWithoutLot,
  type PhotographSource,
} from '../../../supabase/functions/_shared/reportPhotographs.pure';
import { parseAddress, STREET_TYPES } from '../../../supabase/functions/_shared/addressMatch.pure';
import type { VisualKind } from '../../../supabase/functions/_shared/listingImageVision.pure';

/* -------------------------------------------------------------------------- */
/* Where the page draws each picture                                           */
/* -------------------------------------------------------------------------- */

/** A 2-D affine matrix as PDF and pdf.js write it: [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A rectangle in PDF user space, y up from the bottom-left. */
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * The pdf.js operator codes the walk reads. Passed in rather than imported,
 * so the walk needs no pdf.js to be tested and pdf.js's numbering stays its own.
 */
export interface OperatorCodes {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginGroup: number;
  endGroup: number;
  beginAnnotation: number;
  endAnnotation: number;
  beginMarkedContent: number;
  beginMarkedContentProps: number;
  endMarkedContent: number;
  paintImageXObject: number;
}

/** One drawing of one image, where the page puts it. */
export interface ImagePlacement {
  /** pdf.js's id for the decoded image, which is how the pixels are fetched. */
  objId: string;
  /** The image's own pixel size, as the operator list states it. */
  width: number;
  height: number;
  /** The unit square through the matrix in force: the rectangle it covers on the page. */
  drawn: Rect;
}

/** Apply `a`, then `b` — the order a content stream's `cm` composes in. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** The unit square through a matrix, as an axis-aligned rectangle. */
export function unitSquareRect(m: Matrix): Rect {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function matrixOf(value: unknown): Matrix | null {
  if (!value || typeof (value as ArrayLike<number>).length !== 'number') return null;
  const list = Array.from(value as ArrayLike<unknown>).slice(0, 6).map(Number);
  return list.length === 6 && list.every(Number.isFinite) ? (list as Matrix) : null;
}

/**
 * Every image the operator list draws, with the rectangle it covers.
 *
 * A minimal reading of the list, answering one question: how big each picture
 * appears, and where. It follows the matrix through `save`/`restore`,
 * `transform`, a form (whose own matrix applies inside it), a transparency
 * group (which pdf.js draws under the matrix already in force), a widget's
 * appearance (placed on the page by its own transform, whatever came before),
 * and optional content, whose hidden layers pdf.js does not draw and neither
 * does this. The same conditions pdf.js's canvas applies, in the same places.
 *
 * `isVisible` answers for a layer's properties; a failure to answer counts as
 * visible, because a picture wrongly counted is refused later by what it is,
 * while one wrongly hidden can never be offered.
 */
export function imagePlacements(
  list: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> },
  ops: OperatorCodes,
  isVisible: (properties: unknown) => boolean = () => true,
): ImagePlacement[] {
  const placements: ImagePlacement[] = [];
  const stack: Matrix[] = [];
  const annotations: Array<{ ctm: Matrix; depth: number }> = [];
  const layers: boolean[] = [];
  const visible = () => layers.every(Boolean);
  let ctm: Matrix = IDENTITY;

  for (let index = 0; index < list.fnArray.length; index += 1) {
    const fn = list.fnArray[index];
    const args = (list.argsArray[index] ?? []) as unknown[];
    switch (fn) {
      case ops.save:
        stack.push(ctm);
        break;
      case ops.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case ops.transform: {
        const m = matrixOf(args);
        if (m) ctm = multiply(m, ctm);
        break;
      }
      case ops.paintFormXObjectBegin: {
        if (!visible()) break;
        stack.push(ctm);
        const m = matrixOf(args[0]);
        if (m) ctm = multiply(m, ctm);
        break;
      }
      case ops.paintFormXObjectEnd:
      case ops.endGroup:
        if (!visible()) break;
        ctm = stack.pop() ?? ctm;
        break;
      case ops.beginGroup:
        if (!visible()) break;
        stack.push(ctm);
        break;
      case ops.beginAnnotation: {
        annotations.push({ ctm, depth: stack.length });
        const placed = matrixOf(args[2]) ?? IDENTITY;
        const own = matrixOf(args[3]) ?? IDENTITY;
        ctm = multiply(own, placed);
        break;
      }
      case ops.endAnnotation: {
        const outer = annotations.pop();
        if (outer) {
          ctm = outer.ctm;
          stack.length = Math.min(stack.length, outer.depth);
        }
        break;
      }
      case ops.beginMarkedContent:
        layers.push(true);
        break;
      case ops.beginMarkedContentProps: {
        let shown = true;
        if (args[0] === 'OC') {
          try { shown = isVisible(args[1]) !== false; } catch { shown = true; }
        }
        layers.push(shown);
        break;
      }
      case ops.endMarkedContent:
        layers.pop();
        break;
      case ops.paintImageXObject: {
        if (!visible()) break;
        const [objId, width, height] = args;
        if (typeof objId !== 'string' || !objId) break;
        const w = Number(width);
        const h = Number(height);
        if (!(w > 0) || !(h > 0)) break;
        placements.push({ objId, width: w, height: h, drawn: unitSquareRect(ctm) });
        break;
      }
      default:
        break;
    }
  }
  return placements;
}

/** The share of a page a rectangle covers, counting only what lies on the page. */
export function pageShare(drawn: Rect, view: readonly number[]): number {
  const [x1, y1, x2, y2] = view.map(Number);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const bottom = Math.min(y1, y2);
  const top = Math.max(y1, y2);
  const area = (right - left) * (top - bottom);
  if (!(area > 0)) return 0;
  const width = Math.min(right, drawn.x + drawn.width) - Math.max(left, drawn.x);
  const height = Math.min(top, drawn.y + drawn.height) - Math.max(bottom, drawn.y);
  return width > 0 && height > 0 ? (width * height) / area : 0;
}

/* -------------------------------------------------------------------------- */
/* What can be a report photograph, before any pixel is read                   */
/* -------------------------------------------------------------------------- */

/**
 * The floors, measured on builder documents when the builder-stock pipeline
 * read the same thing out of the same kind of file: below 6% of its page a
 * picture was a logo, an icon, a QR code or a rule; outside 0.3–4 a banner or
 * a spine. The pixel floor is the server's print floor, because anything under
 * it is refused on arrival and offering it would be a control that does
 * nothing.
 */
export const BROCHURE_FLOORS = {
  minPageShare: 0.06,
  minAspect: 0.3,
  maxAspect: 4,
  minLongEdge: MIN_PRINT_LONG_EDGE_PX,
} as const;

/**
 * A raster covering this much of a page, on a page with fewer than
 * `PAGE_IMAGE_MAX_TEXT` characters of text of its own, is the page itself: a
 * scan, or a brochure exported as pictures. Its "photograph" carries the
 * brochure's headings and prices baked into the pixels. A full-bleed
 * photograph with the brochure's type set OVER it has that type as text, so
 * it is not this.
 */
export const PAGE_IMAGE_SHARE = 0.9;
export const PAGE_IMAGE_MAX_TEXT = 20;

export function passesBrochureFloors(args: { width: number; height: number; pageShare: number }): boolean {
  const { width, height, pageShare: share } = args;
  if (!(width > 0) || !(height > 0)) return false;
  if (Math.max(width, height) < BROCHURE_FLOORS.minLongEdge) return false;
  const aspect = width / height;
  if (aspect < BROCHURE_FLOORS.minAspect || aspect > BROCHURE_FLOORS.maxAspect) return false;
  return share >= BROCHURE_FLOORS.minPageShare;
}

export function isPictureOfPage(args: { pageShare: number; pageTextLength: number }): boolean {
  return args.pageShare >= PAGE_IMAGE_SHARE && args.pageTextLength < PAGE_IMAGE_MAX_TEXT;
}

/**
 * One picture's identity across the whole brochure: its size, and a hash of
 * the 64-pixel square the judgement reads. pdf.js names the same image
 * differently on different pages, and a writer may embed one logo once a page,
 * so the pixels are what can say "the same picture again". FNV-1a, 32 bits:
 * this only has to tell pictures in one document apart.
 */
export function pixelKey(square: ArrayLike<number>, width: number, height: number): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < square.length; index += 1) {
    hash ^= square[index] & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${width}x${height}-${hash.toString(16).padStart(8, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* One picture, however many times the brochure draws it                       */
/* -------------------------------------------------------------------------- */

/** One drawing of a picture that passed the floors, and what its pixels are. */
export interface RasterSighting {
  /** 1-based, the page a person sees. */
  page: number;
  key: string;
  width: number;
  height: number;
  /** Share of the page it covers here. */
  pageShare: number;
  kind: VisualKind | 'unknown';
  signature: string | null;
}

export interface BrochureCandidate {
  key: string;
  width: number;
  height: number;
  kind: VisualKind | 'unknown';
  signature: string | null;
  /** Every page it is drawn on, ascending. */
  pages: number[];
  /** The largest share of a page it covers, by page. */
  shareByPage: Record<number, number>;
  /** Drawn more than once on one page: a tile, a pattern, a repeated rule. */
  tiled: boolean;
}

/** The sightings gathered into one candidate a picture, in the order first drawn. */
export function gatherBrochureCandidates(sightings: readonly RasterSighting[]): BrochureCandidate[] {
  const byKey = new Map<string, BrochureCandidate>();
  const seenOnPage = new Map<string, number>();
  for (const sighting of sightings) {
    const onPage = `${sighting.key}@${sighting.page}`;
    const drawings = (seenOnPage.get(onPage) ?? 0) + 1;
    seenOnPage.set(onPage, drawings);
    let candidate = byKey.get(sighting.key);
    if (!candidate) {
      candidate = {
        key: sighting.key,
        width: sighting.width,
        height: sighting.height,
        kind: sighting.kind,
        signature: sighting.signature,
        pages: [],
        shareByPage: {},
        tiled: false,
      };
      byKey.set(sighting.key, candidate);
    }
    if (!candidate.pages.includes(sighting.page)) candidate.pages.push(sighting.page);
    candidate.shareByPage[sighting.page] = Math.max(candidate.shareByPage[sighting.page] ?? 0, sighting.pageShare);
    if (drawings > 1) candidate.tiled = true;
  }
  for (const candidate of byKey.values()) candidate.pages.sort((a, b) => a - b);
  return [...byKey.values()];
}

/** A picture drawn on this many pages is part of the brochure's design, not of the property. */
export const FURNITURE_PAGES = 3;

export function isFurniture(candidate: BrochureCandidate): boolean {
  return candidate.tiled || candidate.pages.length >= FURNITURE_PAGES;
}

const largestShare = (candidate: BrochureCandidate, pages?: ReadonlySet<number>): number =>
  Math.max(0, ...Object.entries(candidate.shareByPage)
    .filter(([page]) => !pages || pages.has(Number(page)))
    .map(([, share]) => share));

/* -------------------------------------------------------------------------- */
/* A page's words, as the page prints them                                     */
/* -------------------------------------------------------------------------- */

/** The fields of one pdf.js text run that the join reads. */
export interface PdfTextRun {
  str: string;
  hasEOL?: boolean;
  /** The run's matrix, `[a, b, c, d, x, y]`: `d` is the type size, `x, y` where the run starts. */
  transform?: readonly number[];
  width?: number;
  height?: number;
}

/** A run starting within this many ems of where the last one ended continues its word. */
const SAME_WORD_GAP_EM = 0.3;
/** A run whose baseline is within this many ems of the last one's is on its line. */
const SAME_LINE_EM = 0.5;

const upright = (m: readonly number[]): boolean => Math.abs(m[1]) < 1e-3 && Math.abs(m[2]) < 1e-3;

function continuesRun(previous: PdfTextRun, next: PdfTextRun): boolean {
  if (previous.hasEOL) return false;
  const a = previous.transform;
  const b = next.transform;
  if (!a || !b || a.length < 6 || b.length < 6 || !upright(a) || !upright(b)) return false;
  const size = Math.max(Math.abs(a[3]), Math.abs(b[3]), previous.height ?? 0, next.height ?? 0);
  if (!(size > 0)) return false;
  if (Math.abs(b[5] - a[5]) > SAME_LINE_EM * size) return false;
  const gap = b[4] - (a[4] + (previous.width ?? 0));
  return Math.abs(gap) <= SAME_WORD_GAP_EM * size;
}

/**
 * A page's text the way a reader sees it.
 *
 * pdf.js hands a page's text over in runs, and a run ends wherever the PDF
 * changes font or starts a new text object, which a designed brochure does in
 * the middle of a word. The owner's example brochure prints its address line
 * as seven runs: `L` · `ot` · ` ` · `1` · `629` · ` ` · `Hornsea Street`.
 * pdf.js already writes the spaces the page has (as runs of their own, or
 * inside a run), so joining every run with a space read that line as
 * `L ot 1 629 Hornsea Street`, and no page of the brochure could name its own
 * lot.
 *
 * So a run joins the one before it with nothing, and with a space only where
 * the page separates them: a line ends (`hasEOL`), the next run sits on
 * another line, or it starts clear of where the last one finished. A run whose
 * position cannot be read, or that is set at an angle, is separated, which is
 * the reading this replaced.
 */
export function joinPageText(runs: readonly PdfTextRun[]): string {
  let text = '';
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (index > 0 && !continuesRun(runs[index - 1], run)) text += ' ';
    text += typeof run.str === 'string' ? run.str : '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Which pages are about this property                                         */
/* -------------------------------------------------------------------------- */

/** What identifies the report's property in a brochure's text. */
export interface BrochurePropertyIdentity {
  lot: string | null;
  number: string | null;
  /** The street's words up to and including its type: `smith street`. */
  street: string[];
}

const STREET_TYPE_WORDS = new Set(Object.values(STREET_TYPES));

/** The identifiers a street line carries, read the way the address rules read it. */
export function brochurePropertyIdentity(streetLine: string | null | undefined): BrochurePropertyIdentity {
  const line = typeof streetLine === 'string' ? streetLine.trim() : '';
  if (!line) return { lot: null, number: null, street: [] };
  const lot = lotDesignation(line);
  const parsed = parseAddress(streetLineWithoutLot(line));
  const words = parsed.street ? parsed.street.split(' ').filter(Boolean) : [];
  const end = words.findIndex((word) => STREET_TYPE_WORDS.has(word));
  return { lot, number: parsed.number, street: end >= 0 ? words.slice(0, end + 1) : words };
}

function containsRun(words: readonly string[], run: readonly string[]): boolean {
  if (!run.length || run.length > words.length) return false;
  for (let start = 0; start + run.length <= words.length; start += 1) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

/**
 * - `this` — the page names this property: its lot, or its street number and street.
 * - `mixed` — it names this property and another lot too: a price list, a masterplan.
 * - `other` — it names another lot and not this one.
 * - `unnamed` — it names no property this can recognise.
 *
 * Other lots are read only where the property itself has a lot to compare
 * them with. An established home's brochure can carry its legal description,
 * `Lot 5 DP 12345`, and that is the same property, not another one.
 */
export type BrochurePageReading = 'this' | 'mixed' | 'other' | 'unnamed';

export function readBrochurePage(text: string | null | undefined, identity: BrochurePropertyIdentity): BrochurePageReading {
  const body = typeof text === 'string' ? text : '';
  const lots = identity.lot ? lotsNamedIn(body) : [];
  const namesLot = identity.lot !== null && lots.includes(identity.lot);
  const namesStreetAddress = Boolean(identity.number && identity.street.length)
    && containsRun(addressTokens(body), [identity.number as string, ...identity.street]);
  const namesOther = identity.lot !== null && lots.some((lot) => lot !== identity.lot);
  if (namesLot || namesStreetAddress) return namesOther ? 'mixed' : 'this';
  return namesOther ? 'other' : 'unnamed';
}

/* -------------------------------------------------------------------------- */
/* What the adviser is offered                                                 */
/* -------------------------------------------------------------------------- */

/** The most pictures the picker shows. A brochure is not a gallery. */
export const MAX_BROCHURE_OFFER = 12;

/** The most floor plans the picker shows: one a storey, and a spare. */
export const MAX_BROCHURE_PLAN_OFFER = 4;

export interface BrochureOffer {
  /** Lead first, then in the brochure's own order. */
  offered: BrochureCandidate[];
  /** The one photograph suggested; null only where nothing is offered. */
  lead: string | null;
  /** Some page names another lot. */
  multiProperty: boolean;
  /** Some page names this property. */
  namesProperty: boolean;
  /**
   * The floor plans on this property's pages, in the brochure's order: offered
   * apart from the photographs, and filed apart (`kind: 'floorplan'`).
   */
  plans: BrochureCandidate[];
  /**
   * What was read and not offered, by why. `notPhotographs` is a picture that
   * is neither a photograph nor a plan (a logo, a graphic); `otherProperties`
   * one on a page naming another lot; `unnamedPages` one on pages naming no
   * property.
   */
  leftOut: {
    notPhotographs: number;
    furniture: number;
    otherProperties: number;
    unnamedPages: number;
    overLimit: number;
  };
}

/**
 * The pictures to offer, and the one to suggest.
 *
 * `readings[n]` is page `n + 1`'s reading. A candidate is offered when it is a
 * photograph or a floor plan, is not furniture, is drawn on a page naming this
 * property, and is drawn on no page naming another. The lead is the offered
 * photograph drawn largest on a page naming this property, so there is one
 * whenever a photograph is offered. Plans are offered apart, in the
 * brochure's order.
 */
export function offerBrochurePhotographs(
  candidates: readonly BrochureCandidate[],
  readings: readonly BrochurePageReading[],
  limit = MAX_BROCHURE_OFFER,
): BrochureOffer {
  const readingOf = (page: number): BrochurePageReading => readings[page - 1] ?? 'unnamed';
  const multiProperty = readings.some((reading) => reading === 'other' || reading === 'mixed');
  const namingPages = new Set(
    readings.flatMap((reading, index) => (reading === 'this' ? [index + 1] : [])),
  );
  const leftOut = { notPhotographs: 0, furniture: 0, otherProperties: 0, unnamedPages: 0, overLimit: 0 };

  const eligible: BrochureCandidate[] = [];
  const plans: BrochureCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.kind !== 'photo' && candidate.kind !== 'floorplan') { leftOut.notPhotographs += 1; continue; }
    if (isFurniture(candidate)) { leftOut.furniture += 1; continue; }
    const pages = candidate.pages.map(readingOf);
    if (pages.includes('other') || (!pages.includes('this') && pages.includes('mixed'))) {
      leftOut.otherProperties += 1;
      continue;
    }
    if (!pages.includes('this')) { leftOut.unnamedPages += 1; continue; }
    (candidate.kind === 'floorplan' ? plans : eligible).push(candidate);
  }

  let lead: BrochureCandidate | null = null;
  for (const candidate of eligible) {
    const share = largestShare(candidate, namingPages);
    if (!(share > 0)) continue;
    if (!lead) { lead = candidate; continue; }
    const leading = largestShare(lead, namingPages);
    const firstNaming = (c: BrochureCandidate) => Math.min(...c.pages.filter((page) => namingPages.has(page)));
    if (share > leading || (share === leading && firstNaming(candidate) < firstNaming(lead))) lead = candidate;
  }

  const ordered = [...eligible].sort((a, b) =>
    (a === lead ? -1 : b === lead ? 1 : 0)
    || a.pages[0] - b.pages[0]
    || largestShare(b) - largestShare(a));
  const offered = ordered.slice(0, Math.max(0, limit));
  leftOut.overLimit = ordered.length - offered.length;

  const offeredPlans = [...plans]
    .sort((a, b) => a.pages[0] - b.pages[0] || largestShare(b) - largestShare(a))
    .slice(0, MAX_BROCHURE_PLAN_OFFER);
  leftOut.overLimit += plans.length - offeredPlans.length;

  return {
    offered,
    lead: lead ? lead.key : null,
    multiProperty,
    namesProperty: namingPages.size > 0 || readings.includes('mixed'),
    plans: offeredPlans,
    leftOut,
  };
}

/**
 * The photographs to file, in the order the report uses them — the order
 * offered, so the lead is the cover — and no more than a report can carry.
 * `place` is that order, which is what the stored name carries.
 */
export function brochureSelection(
  offered: readonly BrochureCandidate[],
  ticked: ReadonlySet<string>,
  limit = REPORT_PHOTOGRAPH_LIMIT,
): Array<{ key: string; place: number }> {
  return offered
    .filter((candidate) => ticked.has(candidate.key))
    .slice(0, Math.max(0, limit))
    .map((candidate, place) => ({ key: candidate.key, place }));
}

/**
 * The floor plans to file, in the order offered, no more than a report
 * carries. `place` is that order: the first plan is drawn first.
 */
export function brochurePlanSelection(
  plans: readonly BrochureCandidate[],
  ticked: ReadonlySet<string>,
  limit = REPORT_FLOOR_PLAN_LIMIT,
): Array<{ key: string; place: number }> {
  return brochureSelection(plans, ticked, limit);
}

/** Where in the brochure a picture is drawn, in the words a person uses. */
export function brochurePageLabel(candidate: Pick<BrochureCandidate, 'pages'>): string {
  const pages = candidate.pages;
  if (pages.length <= 1) return `Page ${pages[0] ?? '–'}`;
  return `Pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/* Filing them under the report                                                */
/* -------------------------------------------------------------------------- */

export interface BrochurePhotographRequest {
  op: 'capture_brochure_photograph';
  reportId: string;
  /** The brochure's SHA-256, hex. */
  documentSha256: string;
  /** The address the brochure states, as its parse extracted it. */
  source: PhotographSource;
  /** Its place among the report's photographs (0 is the cover), or among its plans. */
  place: number;
  /** The picture, base64: a photograph as a JPEG, a plan as a PNG. */
  image: string;
  /** Sent for a plan only; a request without it is a photograph, as before. */
  kind?: 'floorplan';
}

/** The transport's answer, as much of it as a decision needs. */
export interface BrochureTransportAnswer {
  data?: unknown;
  error: { message?: string; status?: number; network?: boolean } | null;
}

/** How long to wait before each further try at one photograph. */
export const BROCHURE_UPLOAD_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

export interface BrochureFiling {
  /** Photographs kept. */
  filed: number;
  /** Floor plans kept; absent where none were sent, so a photographs-only filing reads as it always did. */
  filedPlans?: number;
  /** Photographs the server looked at and would not keep, by its reason. */
  refused: Record<string, number>;
  /** Photographs whose request never landed. */
  failed: number;
}

/** Whether a failure is one a second try can cure: it did not arrive, or the server could not take it. */
export function isRetryableBrochureFailure(error: BrochureTransportAnswer['error']): boolean {
  if (!error) return false;
  if (error.network === true) return true;
  const status = Number(error.status);
  return status === 429 || status >= 500;
}

function refusalReason(answer: BrochureTransportAnswer): string {
  const reason = (answer.data as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' && reason ? reason : `http_${Number(answer.error?.status) || 0}`;
}

/**
 * Sends the chosen photographs one at a time, in place order, then the plans.
 *
 * One at a time because each is a decode on the server, which is paid for in
 * that request's CPU; and in place order so the cover is filed first. A
 * failure a second try can cure is tried again after each delay; a refusal is
 * the server's verdict on that picture and is not repeated. Never throws: a
 * report without photographs is not a failed report.
 */
export async function fileBrochurePhotographs(
  invoke: (request: BrochurePhotographRequest) => Promise<BrochureTransportAnswer>,
  requests: readonly BrochurePhotographRequest[],
  options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<BrochureFiling> {
  const delays = options.delaysMs ?? BROCHURE_UPLOAD_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const outcome: BrochureFiling = { filed: 0, refused: {}, failed: 0 };
  const isPlan = (request: BrochurePhotographRequest) => request.kind === 'floorplan';
  const ordered = [...requests].sort((a, b) => Number(isPlan(a)) - Number(isPlan(b)) || a.place - b.place);
  if (ordered.some(isPlan)) outcome.filedPlans = 0;

  for (const request of ordered) {
    let answer: BrochureTransportAnswer | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        answer = await invoke(request);
      } catch (thrown) {
        answer = { error: { message: thrown instanceof Error ? thrown.message : String(thrown), network: true } };
      }
      if (!answer.error || !isRetryableBrochureFailure(answer.error)) break;
    }
    if (!answer || !answer.error) {
      if (isPlan(request)) outcome.filedPlans = (outcome.filedPlans ?? 0) + 1;
      else outcome.filed += 1;
      continue;
    }
    if (isRetryableBrochureFailure(answer.error)) { outcome.failed += 1; continue; }
    const reason = refusalReason(answer);
    outcome.refused[reason] = (outcome.refused[reason] ?? 0) + 1;
  }
  return outcome;
}

/** What the server's reason for not keeping a photograph means, in the adviser's words. */
const REFUSAL_WORDS: Record<string, string> = {
  floorplan: 'it is a floor plan',
  photo: 'it is not a floor plan',
  graphic: 'it is not a photograph',
  below_print_floor: 'it is too small to print',
  duplicate: 'it repeats another',
  unreadable: 'it could not be read',
  undecodable: 'it could not be read',
  address_mismatch: "the brochure's address is not the report's",
  address_changed: "the brochure's address is not the report's",
  address_unknown: "the brochure's address names no street and suburb",
  listing_capture: 'this report takes its photographs from its listing',
  different_document: 'the report already holds photographs from another brochure',
  limit: 'the report already holds as many as it carries',
};

/**
 * What to tell the adviser once the chosen photographs have been filed, or
 * null where nothing was chosen. Every reason is said once, however many
 * photographs it applied to.
 */
export function describeBrochureFiling(outcome: BrochureFiling): { title: string; description: string } | null {
  const refusedCount = Object.values(outcome.refused).reduce((sum, count) => sum + count, 0);
  const notUsed = refusedCount + outcome.failed;
  const plans = outcome.filedPlans ?? 0;
  const kept = outcome.filed + plans;
  if (kept === 0 && notUsed === 0) return null;
  const photographs = (count: number) => `${count} photograph${count === 1 ? '' : 's'}`;
  const floorPlans = (count: number) => `${count === 1 ? 'the floor plan' : `${count} floor plans`}`;
  const keptWords = [
    ...(outcome.filed ? [photographs(outcome.filed)] : []),
    ...(plans ? [floorPlans(plans)] : []),
  ].join(' and ');
  const keptTitle = outcome.filed && plans
    ? 'photographs and floor plan'
    : plans ? (plans === 1 ? 'floor plan' : 'floor plans') : 'photographs';
  // A filing that sent plans speaks of pictures; one that did not reads as it always did.
  const noun = outcome.filedPlans === undefined ? 'photograph' : 'picture';
  const pictures = (count: number) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const reasons = [...new Set(Object.keys(outcome.refused).map((reason) => REFUSAL_WORDS[reason] ?? 'it could not be checked'))];
  if (outcome.failed) reasons.push('the request did not go through');
  const why = reasons.length ? ` (${reasons.join('; ')})` : '';
  if (!notUsed) {
    return {
      title: `Brochure ${keptTitle} added`,
      description: `${keptWords.charAt(0).toUpperCase()}${keptWords.slice(1)} from the brochure will appear in the report.`,
    };
  }
  if (kept) {
    return {
      title: `Some brochure ${keptTitle} added`,
      description: `${keptWords.charAt(0).toUpperCase()}${keptWords.slice(1)} will appear in the report; ${pictures(notUsed)} could not be used${why}.`,
    };
  }
  return {
    title: `Brochure ${noun}s not added`,
    description: `None of the ${pictures(notUsed)} could be used${why}. The report is made without them.`,
  };
}

/**
 * What to tell the adviser when the patience for the filing ran out first.
 * The report has started, and the pictures are still on their way from this
 * page, which is the only place they exist.
 */
export const BROCHURE_FILING_STILL_RUNNING: { title: string; description: string } = {
  title: 'Still adding the brochure pictures',
  description: 'The report has started. Keep this page open until the pictures are confirmed.',
};

/** What to tell the adviser when the filing could not be carried out at all. */
export const BROCHURE_FILING_BROKE: { title: string; description: string } = {
  title: 'Brochure pictures not added',
  description: 'The pictures chosen from the brochure could not be sent. The report is made without them.',
};
