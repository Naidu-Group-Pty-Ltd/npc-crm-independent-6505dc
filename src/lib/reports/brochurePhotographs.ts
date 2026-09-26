/**
 * Reading the photographs out of an uploaded brochure, in the browser, and
 * filing the ones the adviser chose under the report.
 *
 * The rules — what can be a report photograph, which pages are about this
 * property, what is offered and what is suggested — are in
 * `brochurePhotographs.pure.ts`. This is the part that cannot be pure: pdf.js
 * reading the file, a canvas turning its decoded pixels into a JPEG, and the
 * requests to `listing-images`.
 *
 * ## Why here and not on the server
 *
 * The brochure never reaches the server. The browser already renders its pages
 * for the parser and sends only page images, and reading a heavy brochure on
 * an edge worker was measured at ~2.4 s of CPU against a 2 s allowance when the
 * builder-stock pipeline did it. The browser has pdf.js loaded, decodes every
 * image encoding the format allows, and has a canvas to encode with.
 *
 * ## What it never does
 *
 *  - It never sends a picture nobody ticked.
 *  - It never fails the parse. A brochure whose pictures cannot be read gives a
 *    report with no photographs, which is the ordinary state of every report
 *    before this.
 *  - It never trusts itself. Every photograph it sends is judged again by the
 *    server, on the server's own decode of the bytes it received.
 *  - It never lets a close or a reload take a ticked picture silently. The
 *    pictures exist only in this page, so the page is held while they are in
 *    flight (`fileWhilePageHeld`).
 */
import { loadPdfjs } from '@/lib/pdf/pdfjs';
import {
  analyseRgba,
  ANALYSIS_SIZE,
} from '../../../supabase/functions/_shared/listingImageVision.pure';
import {
  BROCHURE_PHOTOGRAPH_MAX_BYTES,
  type PhotographSource,
} from '../../../supabase/functions/_shared/reportPhotographs.pure';
import {
  brochurePlanSelection,
  brochureSelection,
  fileBrochurePhotographs,
  gatherBrochureCandidates,
  imagePlacements,
  isPictureOfPage,
  joinPageText,
  pageShare,
  passesBrochureFloors,
  pixelKey,
  type BrochureCandidate,
  type BrochureFiling,
  type BrochurePhotographRequest,
  type BrochureTransportAnswer,
  type ImagePlacement,
  type OperatorCodes,
  type PdfTextRun,
  type RasterSighting,
} from './brochurePhotographs.pure';

/** Pages a brochure is read through. A brochure is not a book. */
export const MAX_BROCHURE_PAGES = 24;
/** Photographs encoded from one brochure, whatever it holds. */
export const MAX_BROCHURE_ENCODED = 16;
/**
 * The long edge a photograph is filed at: ~290 dpi across a full-bleed A4
 * cover, and a decode the server can afford inside one request.
 */
export const BROCHURE_PHOTOGRAPH_EDGE_PX = 2400;
/**
 * Above this many pixels, a decoded image is averaged down before it meets a
 * canvas. A print brochure can carry a 40-megapixel render, and a canvas that
 * size is 160 MB on a laptop that is also running the dashboard.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;
/** How long one decoded image may take to arrive from pdf.js's worker. */
const IMAGE_WAIT_MS = 8_000;
/**
 * A JPEG has no transparency, so whatever a brochure left transparent is set
 * on the colour of the page it was printed on. An encoding decision, not a
 * colour anybody sees in the interface, so it is not a theme token.
 */
const PAPER = 'white';

/** pdf.js's decoded image, in either of the two shapes it hands over. */
export interface PdfImageObject {
  width: number;
  height: number;
  /** An `ImageBitmap`, where the worker could make one. */
  bitmap?: CanvasImageSource;
  /** Raw samples, where it could not: `kind` says how they are laid out. */
  data?: Uint8Array | Uint8ClampedArray;
  kind?: number;
}

/** pdf.js's own numbering of those layouts (`ImageKind`). */
export interface ImageKinds {
  RGB_24BPP: number;
  RGBA_32BPP: number;
}

/** One page of a brochure as pdf.js reads it. */
export interface BrochurePageScan {
  /** 1-based. */
  page: number;
  /** The page box, `[x1, y1, x2, y2]`. */
  view: number[];
  text: string;
  placements: ImagePlacement[];
}

type Pdfjs = typeof import('pdfjs-dist');

/** The operator codes the walk reads, from pdf.js's own table. */
export function operatorCodes(OPS: Record<string, number>): OperatorCodes {
  return {
    save: OPS.save,
    restore: OPS.restore,
    transform: OPS.transform,
    paintFormXObjectBegin: OPS.paintFormXObjectBegin,
    paintFormXObjectEnd: OPS.paintFormXObjectEnd,
    beginGroup: OPS.beginGroup,
    endGroup: OPS.endGroup,
    beginAnnotation: OPS.beginAnnotation,
    endAnnotation: OPS.endAnnotation,
    beginMarkedContent: OPS.beginMarkedContent,
    beginMarkedContentProps: OPS.beginMarkedContentProps,
    endMarkedContent: OPS.endMarkedContent,
    paintImageXObject: OPS.paintImageXObject,
  };
}

interface PdfObjectStore { get(objId: string, callback: (value: unknown) => void): unknown }

function isImageObject(value: unknown): value is PdfImageObject {
  const v = value as PdfImageObject | null;
  return Boolean(v) && Number(v!.width) > 0 && Number(v!.height) > 0 && Boolean(v!.bitmap || v!.data);
}

/**
 * The decoded image pdf.js holds under `objId`, once its worker has sent it.
 *
 * `getOperatorList` answers before every image has arrived on this side, so
 * this waits for it — through the store's own callback, which answers at once
 * for an image already here — and gives up after `IMAGE_WAIT_MS`, because an
 * image the worker failed to decode may never arrive. An id beginning `g_` is
 * one pdf.js shares across pages.
 */
function imageObject(
  page: { objs: PdfObjectStore; commonObjs: PdfObjectStore },
  objId: string,
): Promise<PdfImageObject | null> {
  const store = objId.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PdfImageObject | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), IMAGE_WAIT_MS);
    try {
      store.get(objId, (value) => finish(isImageObject(value) ? value : null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Reads a brochure page by page: its text, where it draws each picture, and a
 * way to fetch a picture's pixels while the page is open.
 *
 * `visit` is awaited before the page is released, because pdf.js releases the
 * decoded pixels with it. The document is always closed, whatever happens.
 */
export async function scanBrochure(
  bytes: Uint8Array,
  visit: (scan: BrochurePageScan, image: (objId: string) => Promise<PdfImageObject | null>) => Promise<void>,
  options: { maxPages?: number; pdfjs?: Pdfjs } = {},
): Promise<{ pageCount: number; pagesRead: number }> {
  const pdfjs = options.pdfjs ?? await loadPdfjs();
  // A copy: the worker may take ownership of the buffer it is handed.
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const ops = operatorCodes(pdfjs.OPS as unknown as Record<string, number>);
    let isVisible: (properties: unknown) => boolean = () => true;
    try {
      const config = await doc.getOptionalContentConfig();
      isVisible = (properties) => config.isVisible(properties as never);
    } catch {
      /* no layers, or none readable: everything drawn is visible */
    }
    const limit = Math.min(doc.numPages, Math.max(1, options.maxPages ?? MAX_BROCHURE_PAGES));
    let pagesRead = 0;
    for (let number = 1; number <= limit; number += 1) {
      const page = await doc.getPage(number);
      try {
        const [list, content] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
        const runs: PdfTextRun[] = [];
        for (const item of content.items) if ('str' in item) runs.push(item);
        const text = joinPageText(runs);
        const placements = imagePlacements(list, ops, isVisible);
        await visit(
          { page: number, view: Array.from(page.view), text, placements },
          (objId) => imageObject(page as unknown as { objs: PdfObjectStore; commonObjs: PdfObjectStore }, objId),
        );
        pagesRead += 1;
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: doc.numPages, pagesRead };
  } finally {
    await task.destroy();
  }
}

/**
 * pdf.js's raw samples as RGBA, averaged down by `factor` in each direction.
 *
 * Only the two layouts a photograph arrives in: RGB, and RGBA where the image
 * carried a soft mask. A one-bit layout is a mask or line art and is refused.
 */
export function rgbaFromPdfImage(
  image: PdfImageObject,
  kinds: ImageKinds,
  factor = 1,
): { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null {
  const { data, width, height, kind } = image;
  if (!data || !(width > 0) || !(height > 0)) return null;
  const channels = kind === kinds.RGBA_32BPP ? 4 : kind === kinds.RGB_24BPP ? 3 : 0;
  if (!channels || data.length < width * height * channels) return null;
  const step = Math.max(1, Math.floor(factor));
  const outWidth = Math.max(1, Math.floor(width / step));
  const outHeight = Math.max(1, Math.floor(height / step));
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  const area = step * step;
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < step; dy += 1) {
        let at = ((y * step + dy) * width + x * step) * channels;
        for (let dx = 0; dx < step; dx += 1) {
          r += data[at]; g += data[at + 1]; b += data[at + 2];
          a += channels === 4 ? data[at + 3] : 255;
          at += channels;
        }
      }
      const out = (y * outWidth + x) * 4;
      rgba[out] = r / area;
      rgba[out + 1] = g / area;
      rgba[out + 2] = b / area;
      rgba[out + 3] = a / area;
    }
  }
  return { rgba, width: outWidth, height: outHeight };
}

/** How far a decoded image is averaged down before it meets a canvas. */
export function reductionFactor(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_CANVAS_PIXELS)));
}

/** Something a canvas can draw, for either shape pdf.js hands over. */
function drawable(image: PdfImageObject, kinds: ImageKinds): CanvasImageSource | null {
  if (image.bitmap) return image.bitmap;
  const reduced = rgbaFromPdfImage(image, kinds, reductionFactor(image.width, image.height));
  if (!reduced) return null;
  const canvas = document.createElement('canvas');
  canvas.width = reduced.width;
  canvas.height = reduced.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.putImageData(new ImageData(reduced.rgba, reduced.width, reduced.height), 0, 0);
  return canvas;
}

/** The 64-pixel square the judgement reads, over white where the picture is transparent. */
function analysisSquare(source: CanvasImageSource): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_SIZE;
  canvas.height = ANALYSIS_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  context.drawImage(source, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  return context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number, type = 'image/jpeg'): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

/**
 * The picture, its long edge at most `BROCHURE_PHOTOGRAPH_EDGE_PX`, within the
 * size the server takes: a photograph as a JPEG, a floor plan as a PNG where
 * one fits, because JPEG smears the thin lines and small labels a plan is
 * made of, and a plan is mostly flat white that PNG stores for almost nothing.
 */
async function encodePhotograph(
  source: CanvasImageSource,
  width: number,
  height: number,
  kind: 'photo' | 'floorplan' = 'photo',
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const scale = Math.min(1, BROCHURE_PHOTOGRAPH_EDGE_PX / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, outWidth, outHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, outWidth, outHeight);
  if (kind === 'floorplan') {
    const png = await canvasBlob(canvas, 1, 'image/png');
    if (png && png.size <= BROCHURE_PHOTOGRAPH_MAX_BYTES) return { blob: png, width: outWidth, height: outHeight };
  }
  for (const quality of [0.9, 0.8]) {
    const blob = await canvasBlob(canvas, quality);
    if (blob && blob.size <= BROCHURE_PHOTOGRAPH_MAX_BYTES) return { blob, width: outWidth, height: outHeight };
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One photograph encoded from the brochure, ready to be shown and filed. */
export interface BrochurePhotographFile {
  blob: Blob;
  width: number;
  height: number;
}

export interface BrochureReading {
  /** The brochure file's SHA-256: which document the photographs came from. */
  documentSha256: string;
  pageCount: number;
  pagesRead: number;
  /** Each page's text, page 1 first. */
  pageTexts: string[];
  candidates: BrochureCandidate[];
  /** The encoded photographs and floor plans, by candidate key. Nothing else is encoded. */
  files: Map<string, BrochurePhotographFile>;
}

/**
 * Every picture in the brochure that could be a report photograph, judged,
 * with the photographs among them encoded and ready to show.
 *
 * Throws only where the file is not a readable PDF at all; the caller treats
 * that as a brochure with no photographs.
 */
export async function readBrochurePhotographs(
  file: Blob,
  options: { maxPages?: number } = {},
): Promise<BrochureReading> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentSha256 = await sha256Hex(bytes);
  const pdfjs = await loadPdfjs();
  const kinds = pdfjs.ImageKind as unknown as ImageKinds;
  const sightings: RasterSighting[] = [];
  const pageTexts: string[] = [];
  const files = new Map<string, BrochurePhotographFile>();

  const { pageCount, pagesRead } = await scanBrochure(bytes, async (scan, image) => {
    pageTexts[scan.page - 1] = scan.text;
    const textLength = scan.text.replace(/\s+/g, '').length;
    const byImage = new Map<string, number[]>();
    for (const placement of scan.placements) {
      const share = pageShare(placement.drawn, scan.view);
      if (!passesBrochureFloors({ width: placement.width, height: placement.height, pageShare: share })) continue;
      if (isPictureOfPage({ pageShare: share, pageTextLength: textLength })) continue;
      byImage.set(placement.objId, [...(byImage.get(placement.objId) ?? []), share]);
    }
    for (const [objId, shares] of byImage) {
      const decoded = await image(objId);
      if (!decoded) continue;
      const source = drawable(decoded, kinds);
      const square = source ? analysisSquare(source) : null;
      if (!source || !square) continue;
      const key = pixelKey(square, decoded.width, decoded.height);
      const analysis = analyseRgba(square, decoded.width, decoded.height, ANALYSIS_SIZE);
      for (const share of shares) {
        sightings.push({
          page: scan.page,
          key,
          width: decoded.width,
          height: decoded.height,
          pageShare: share,
          kind: analysis.kind,
          signature: analysis.signature,
        });
      }
      const keeps = analysis.kind === 'photo' || analysis.kind === 'floorplan';
      if (keeps && !files.has(key) && files.size < MAX_BROCHURE_ENCODED) {
        const encoded = await encodePhotograph(source, decoded.width, decoded.height, analysis.kind === 'floorplan' ? 'floorplan' : 'photo');
        if (encoded) files.set(key, encoded);
      }
    }
  }, { maxPages: options.maxPages, pdfjs });

  return {
    documentSha256,
    pageCount,
    pagesRead,
    pageTexts: Array.from({ length: pagesRead }, (_, index) => pageTexts[index] ?? ''),
    // A photograph or plan that could not be encoded cannot be shown or filed,
    // so it is not a candidate; anything else is, so it is counted for what it is.
    candidates: gatherBrochureCandidates(sightings)
      .filter((c) => (c.kind !== 'photo' && c.kind !== 'floorplan') || files.has(c.key)),
    files,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Files the photographs the adviser ticked under the report, in the order the
 * picker shows them, the first as the cover, and then the ticked floor plans.
 * Never throws.
 */
export async function fileChosenBrochurePhotographs(args: {
  invoke: (request: BrochurePhotographRequest) => Promise<BrochureTransportAnswer>;
  reportId: string;
  documentSha256: string;
  source: PhotographSource;
  offered: readonly BrochureCandidate[];
  ticked: ReadonlySet<string>;
  plans?: readonly BrochureCandidate[];
  tickedPlans?: ReadonlySet<string>;
  files: ReadonlyMap<string, BrochurePhotographFile>;
}): Promise<BrochureFiling> {
  const requests: BrochurePhotographRequest[] = [];
  const chosen = [
    ...brochureSelection(args.offered, args.ticked).map((pick) => ({ ...pick, plan: false })),
    ...brochurePlanSelection(args.plans ?? [], args.tickedPlans ?? new Set()).map((pick) => ({ ...pick, plan: true })),
  ];
  for (const { key, place, plan } of chosen) {
    const file = args.files.get(key);
    if (!file) continue;
    try {
      requests.push({
        op: 'capture_brochure_photograph',
        reportId: args.reportId,
        documentSha256: args.documentSha256,
        source: args.source,
        place,
        image: await blobToBase64(file.blob),
        ...(plan ? { kind: 'floorplan' as const } : {}),
      });
    } catch {
      /* a picture that cannot be read back is simply not sent */
    }
  }
  if (!requests.length) return { filed: 0, refused: {}, failed: 0 };
  return fileBrochurePhotographs(args.invoke, requests);
}

/** How long Generate waits for the ticked pictures before it lets the adviser go on. */
export const BROCHURE_FILING_PATIENCE_MS = 60_000;

/** The part of `window` that holds a page open. */
export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
}

export type HeldFiling =
  | { state: 'settled'; outcome: BrochureFiling | null }
  | { state: 'pending' };

/**
 * Files the ticked pictures while the page is held open.
 *
 * The pictures exist only in this page. They were cut out of the brochure in
 * the browser and nothing on the server can cut them out again, so a filing
 * that a close or a reload interrupts is lost for good, and the report is
 * finished without them. For as long as the filing is in flight, closing or
 * reloading the page asks first.
 *
 * The caller waits on this before it announces the report and clears the
 * form, because announcing it is what tells an adviser they may leave. The
 * wait is bounded: each picture may take three attempts at the transport's
 * minute, so an outage could otherwise hold the button for many minutes. Past
 * the patience this resolves `pending`; the filing carries on, still holding
 * the page, and `onLateOutcome` reports it when it lands. `outcome` is null
 * where the filing threw, which it is not meant to.
 */
export function fileWhilePageHeld(
  file: () => Promise<BrochureFiling>,
  options: {
    patienceMs?: number;
    target?: UnloadTarget | null;
    onLateOutcome?: (outcome: BrochureFiling | null) => void;
  } = {},
): Promise<HeldFiling> {
  const target = options.target === undefined
    ? (typeof window === 'undefined' ? null : window)
    : options.target;
  const hold = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  target?.addEventListener('beforeunload', hold);
  const filing = (async () => {
    try {
      return await file();
    } catch {
      return null;
    } finally {
      target?.removeEventListener('beforeunload', hold);
    }
  })();
  return new Promise<HeldFiling>((resolve) => {
    let answered = false;
    const patience = setTimeout(() => {
      answered = true;
      resolve({ state: 'pending' });
    }, options.patienceMs ?? BROCHURE_FILING_PATIENCE_MS);
    void filing.then((outcome) => {
      if (answered) {
        options.onLateOutcome?.(outcome);
        return;
      }
      answered = true;
      clearTimeout(patience);
      resolve({ state: 'settled', outcome });
    });
  });
}
