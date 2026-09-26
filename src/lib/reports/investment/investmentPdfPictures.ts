/**
 * The property's own photograph and floor plans, in the standard presentation.
 *
 * The standard presentation is what a report comes out in when no template is
 * chosen: `investmentPdfDocument.ts`, drawn with pdf-lib over the brand cover
 * and content page of `public/templates/npc_template.pdf`. A chosen template
 * carries the same pictures through `property.images` and
 * `property.floorPlans`; this is the same two things drawn for this document,
 * so a report does not gain a floor plan or lose its photograph by being left
 * on the default.
 *
 * The template's brand cover is NPC's artwork, and it opens only NPC's own
 * document on NPC's own deployment (`standardCover.pure.ts`). Every other
 * issuer's cover is drawn by `investmentPdfCover.ts`, which puts its photograph
 * in the same band, at the same place on the page.
 *
 * ## The cover: a photograph band beneath the lockup
 *
 * The cover is a finished brand page, not a layout, so everything here was
 * measured off it (144 dpi, 25 Sep 2026) rather than assumed:
 *   - the gold side borders end at x 12.5 and start again at x 581.5;
 *   - the gold divider under the tagline runs x 59.5–554.5 at 558–560.5pt
 *     from the top, centred at x 307 — ten points right of the page centre,
 *     like the tagline above it;
 *   - the bottom-right ornament's first grey is 592pt from the top, where its
 *     tip reaches into the right-hand border.
 *
 * All measured from the sheet's visible top edge, and placed against the
 * page's own box at draw time, because this template's box starts at y 7.83
 * rather than 0 (see `COVER_BAND_TOP_FROM_TOP`).
 *
 * So the photograph takes the whole field below the lockup — from 590pt down
 * to the trim, between the gold borders — which puts the ornament under it
 * rather than beside it: a band that stopped short of the ornament would sit
 * beside a fragment of it, and the ornament's diagonal would cut the
 * photograph's corner. The sliver of ornament inside the right-hand border is
 * painted back to the border's own gold (`COVER_RIGHT_BORDER`), and a gold
 * hairline closes the band's top edge, so the photograph reads as framed on
 * three sides by the cover's own gold. The picture fills the band (`cover`)
 * and is clipped to it, because a band with bars in it is a band that looks
 * broken.
 *
 * The address is set in the black between the divider and the band, centred
 * on the divider, in ivory capitals: a photograph on a cover should say which
 * property it is, and the band is otherwise the only thing on the cover that is
 * about THIS report. Ivory, not gold, because REPORT_RULES §2 forbids a
 * saturated accent below 10pt.
 *
 * ## The floor plan: a sheet of its own
 *
 * Laid out like the rest of the document rather than like a template: the
 * body's own section heading (gold bar, navy title, gold rule), the address
 * beneath it, the plan drawn WHOLE (`contain`) in the room left, and the same
 * three-line title block the templates print at the foot — not to scale, where
 * it came from, what to check it against. A plan is never cropped and never
 * rotated: a cropped plan is a plan with a room missing, and a rotated one has
 * lost its north.
 *
 * ## Nothing here can cost the document
 *
 * Every function answers `false` when a picture will not embed, and the caller
 * draws the document without it. A report with no photograph gets the cover it
 * always had, byte for byte; a report with no plan gets no plan page.
 */
import {
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setCharacterSpacing,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

/** One picture, as pdf-lib embeds it. */
export interface InvestmentPdfPicture {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
}

/** A rectangle in PDF points, origin bottom-left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the band starts, measured DOWN from the cover's visible top edge.
 *
 * Every vertical measurement on the cover is taken from the top of the sheet
 * as it prints, and turned into PDF space against the page's own box at draw
 * time — because the template's box does not start at zero:
 * `npc_template.pdf` declares its MediaBox as [0 7.83 595.5 850.08]. The first
 * draft assumed a 0–842 page and put the band's top 7pt low, which left the tip
 * of the ornament standing above the photograph in the border.
 */
const COVER_BAND_TOP_FROM_TOP = 590;

/** The band's horizontal extent: between the gold borders, measured from the left edge. */
const COVER_BAND_X = Object.freeze({ left: 12.5, right: 581.5 });

/** The field below the cover's lockup, for a cover whose visible box is `page`. */
export function standardCoverBand(page: Box): Box {
  const top = page.y + page.height - COVER_BAND_TOP_FROM_TOP;
  return {
    x: COVER_BAND_X.left,
    y: page.y,
    width: COVER_BAND_X.right - COVER_BAND_X.left,
    height: top - page.y,
  };
}

/** The cover's gold divider: its extent and its lower edge, from the top of the page. */
const COVER_DIVIDER = Object.freeze({ left: 59.5, right: 554.5, bottomFromTop: 560.5 });
/** The divider's own gold, sampled from the cover. */
const COVER_GOLD: RGB = rgb(225 / 255, 188 / 255, 89 / 255);
/** REPORT_RULES §1's paper ivory, for type reversed out of the cover's black. */
const COVER_IVORY: RGB = rgb(250 / 255, 247 / 255, 241 / 255);

/**
 * The right-hand border where the ornament overlaps it.
 *
 * Above the band the right border starts at x 581.5, as the left one ends at
 * 12.5; from 592pt down the ornament overlaps its inner five points (its tip
 * reaches 586.9), and the border's gold starts at 586.5. A photograph that
 * covers the ornament to 581.5 would leave that sliver of it standing beside
 * the band, so the border's own gold is drawn back over it, to 588.5 so the
 * ornament's edge goes with it: flat across the border's width, graded down
 * its height from `top` (590pt from the top) to `bottom` (the trim), both
 * sampled from the cover. Drawing gold over gold past 586.5 is invisible.
 */
const COVER_RIGHT_BORDER = Object.freeze({
  x: 581.5,
  width: 588.5 - 581.5,
  top: [229, 195, 100] as const,
  bottom: [200, 153, 53] as const,
});

/** Scale a picture to FILL a box; the caller clips what overhangs. Centred. */
export function coverFit(image: { width: number; height: number }, box: Box): Box {
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** Scale a picture to fit WHOLLY inside a box. Centred. */
export function containFit(image: { width: number; height: number }, box: Box): Box {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * Text the standard fonts can encode.
 *
 * pdf-lib's standard fonts speak WinAnsi and throw on anything else, and an
 * address is typed by a person: a curly apostrophe or an en dash is common, an
 * emoji is possible. Map what has a WinAnsi twin and drop the rest.
 */
export function winAnsiSafe(text: string): string {
  return String(text ?? '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The characters WinAnsi carries beyond Latin-1: the euro, the curly quotes,
 * the en and em dash, the bullet, the ellipsis and the rest of cp1252's 0x80
 * row.
 */
const WIN_ANSI_BEYOND_LATIN1 = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';
const NOT_WIN_ANSI = new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF${WIN_ANSI_BEYOND_LATIN1}]`, 'g');

/**
 * Text the standard fonts can encode, keeping the typography WinAnsi has.
 *
 * `winAnsiSafe` flattens every dash and curly quote to ASCII. The prime's own
 * cover is drawn through it, so it stays exactly as it is. But WinAnsi carries
 * the en and em dash, the curly quotes, the bullet and the ellipsis, and both
 * pdf-lib and jsPDF draw them from the standard fonts (measured, with and
 * without tracking). So a cover drawn for an issuer keeps them. "Scenario —
 * Finance Hand-off" set as "Scenario - Finance Hand-off" is a typing error the
 * document never made. Only what WinAnsi lacks is mapped or dropped.
 */
export function winAnsiTypographic(text: string): string {
  return String(text ?? '')
    .replace(/\u201B/g, '\u2019')
    .replace(/\u201F/g, '\u201D')
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/[\u2010\u2011\u2212]/g, '-')
    .replace(/\u2012/g, '\u2013')
    .replace(/\u2015/g, '\u2014')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(NOT_WIN_ANSI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How the cover's address line is set. */
export interface CoverAddressSetting {
  text: string;
  size: number;
  /** Extra space after each character, in points. */
  tracking: number;
  width: number;
}

/**
 * The largest setting of the address that fits the divider's measure.
 *
 * Capitals first, tracked like the tagline above them, stepping the tracking
 * and then the size down; then the address as written, which is narrower; and
 * only past all of that — longer than any address the corpus holds — the
 * address cut at a word with an ellipsis. Never smaller than 8pt: below that it
 * is not a line anybody reads on a cover.
 *
 * `sanitize` is `winAnsiSafe` for the prime's own cover, whose address line is
 * drawn exactly as it always was; an issuer's cover passes `winAnsiTypographic`.
 */
export function fitCoverAddress(
  address: string,
  measure: (text: string, size: number) => number,
  maxWidth: number = COVER_DIVIDER.right - COVER_DIVIDER.left,
  sanitize: (text: string) => string = winAnsiSafe,
): CoverAddressSetting | null {
  const written = sanitize(address);
  if (!written) return null;
  const widthOf = (text: string, size: number, tracking: number) =>
    measure(text, size) + tracking * Math.max(0, text.length - 1);
  const attempts: Array<[string, number, number]> = [];
  const capitals = written.toUpperCase();
  for (const size of [9, 8.5, 8]) for (const tracking of [1.2, 0.8, 0.4, 0]) attempts.push([capitals, size, tracking]);
  for (const size of [9, 8.5, 8]) for (const tracking of [0.4, 0]) attempts.push([written, size, tracking]);
  for (const [text, size, tracking] of attempts) {
    const width = widthOf(text, size, tracking);
    if (width <= maxWidth) return { text, size, tracking, width };
  }
  const words = written.split(' ');
  for (let n = words.length - 1; n > 0; n -= 1) {
    const text = `${words.slice(0, n).join(' ').replace(/[,\s]+$/, '')}...`;
    const width = widthOf(text, 8, 0);
    if (width <= maxWidth) return { text, size: 8, tracking: 0, width };
  }
  return null;
}

/**
 * One line of text that fits `room`: whole where it fits, otherwise cut at a
 * word with an ellipsis. Never cut inside a word.
 */
export function fitLine(text: string, measure: (text: string) => number, room: number): string | null {
  const written = winAnsiSafe(text);
  if (!written) return null;
  if (measure(written) <= room) return written;
  const words = written.split(' ');
  for (let n = words.length - 1; n > 0; n -= 1) {
    const cut = `${words.slice(0, n).join(' ').replace(/[,\s]+$/, '')}...`;
    if (measure(cut) <= room) return cut;
  }
  return null;
}

/** The right border's gold, redrawn beside the band in two-point slices (see `COVER_RIGHT_BORDER`). */
function restoreRightBorder(cover: PDFPage, band: Box): void {
  const SLICE = 2;
  const { x, width, top, bottom } = COVER_RIGHT_BORDER;
  for (let y = band.y; y < band.y + band.height; y += SLICE) {
    const height = Math.min(SLICE, band.y + band.height - y);
    const t = (y + height / 2 - band.y) / band.height;
    const channel = (i: 0 | 1 | 2) => (bottom[i] + (top[i] - bottom[i]) * t) / 255;
    // Half a point of overlap each side, so no hairline of the ornament shows
    // between two slices or at either edge.
    cover.drawRectangle({
      x: x - 0.25, y: y - 0.25, width: width + 0.5, height: height + 0.5,
      color: rgb(channel(0), channel(1), channel(2)),
    });
  }
}

async function embed(pdfDoc: PDFDocument, picture: InvestmentPdfPicture | null | undefined): Promise<PDFImage | null> {
  if (!picture?.bytes?.length) return null;
  try {
    const image = picture.format === 'png'
      ? await pdfDoc.embedPng(picture.bytes)
      : await pdfDoc.embedJpg(picture.bytes);
    return image.width > 0 && image.height > 0 ? image : null;
  } catch (err) {
    console.warn('[investmentPdfPictures] a picture could not be embedded', err);
    return null;
  }
}

/** Draw `text` at a baseline, with tracking applied through the text state. */
export function drawTracked(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; tracking: number; font: PDFFont; color: RGB },
): void {
  page.pushOperators(pushGraphicsState(), setCharacterSpacing(opts.tracking));
  page.drawText(text, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
  page.pushOperators(popGraphicsState());
}

/**
 * The lead photograph on the standard cover, with the address above it.
 *
 * Answers whether the photograph was drawn. When it was not, the cover has not
 * been touched.
 */
export async function drawStandardCoverPhotograph(
  pdfDoc: PDFDocument,
  cover: PDFPage,
  photograph: InvestmentPdfPicture | null | undefined,
  address: string | null | undefined,
  font: PDFFont,
): Promise<boolean> {
  const image = await embed(pdfDoc, photograph);
  if (!image) return false;

  const visible = cover.getCropBox();
  const band = standardCoverBand(visible);
  const placed = coverFit({ width: image.width, height: image.height }, band);
  cover.pushOperators(
    pushGraphicsState(),
    rectangle(band.x, band.y, band.width, band.height),
    clip(),
    endPath(),
  );
  cover.drawImage(image, placed);
  cover.pushOperators(popGraphicsState());

  const top = band.y + band.height;
  restoreRightBorder(cover, band);
  cover.drawLine({
    start: { x: band.x, y: top },
    end: { x: band.x + band.width, y: top },
    thickness: 0.75,
    color: COVER_GOLD,
  });

  const setting = fitCoverAddress(String(address ?? ''), (text, size) => font.widthOfTextAtSize(text, size));
  if (setting) {
    // Centred between the divider and the band, optically: on the cap height.
    const dividerBottom = visible.y + visible.height - COVER_DIVIDER.bottomFromTop;
    const middle = (dividerBottom + top) / 2;
    // Helvetica's cap height is 718/1000 of its size; the document embeds no other face.
    const capHeight = setting.size * 0.718;
    const centre = (COVER_DIVIDER.left + COVER_DIVIDER.right) / 2;
    drawTracked(cover, setting.text, {
      x: centre - setting.width / 2,
      y: middle - capHeight / 2,
      size: setting.size,
      tracking: setting.tracking,
      font,
      color: COVER_IVORY,
    });
  }
  return true;
}

/** What a floor plan is, in the three facts a reader of a plan looks for. */
export const FLOOR_PLAN_NOTES: ReadonlyArray<{ term: string; definition: string }> = Object.freeze([
  { term: 'Scale', definition: 'Not to scale. Printed to fit the page.' },
  { term: 'Source', definition: "The builder's or agent's marketing material." },
  { term: 'Before relying on it', definition: 'Confirm dimensions and areas against the contract drawings.' },
]);

/** The standard content page's geometry, as `investmentPdfDocument.ts` lays it out. */
export interface StandardPageGeometry {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  topMargin: number;
  /** Where the page-number pass draws the footer's gold rule. */
  footerRuleY: number;
}

export interface FloorPlanSheetLayout {
  /** Baseline of the section title, and the gold bar beside it. */
  titleY: number;
  bar: Box;
  /** The gold rule under the title. */
  underlineY: number;
  addressY: number;
  /** Where the plan may be drawn. */
  drawing: Box;
  /** One baseline per note, top first, and the rules between them. */
  noteBaselines: number[];
  noteRules: number[];
  termX: number;
  definitionX: number;
}

const NOTE_PITCH = 18;

/**
 * Where everything on the floor-plan sheet goes.
 *
 * The title sits where the body's first section title sits on a fresh page, so
 * the sheet opens like every other page of the document; the title block sits
 * above the footer the page-number pass draws; and the plan gets every point
 * between them.
 */
export function floorPlanSheetLayout(g: StandardPageGeometry): FloorPlanSheetLayout {
  const titleY = g.pageHeight - g.topMargin - 20;
  const underlineY = titleY - 20 + 6;
  const addressY = underlineY - 16;
  const lowestRule = g.footerRuleY + 22;
  const noteRules = Array.from({ length: FLOOR_PLAN_NOTES.length + 1 }, (_, i) => lowestRule + i * NOTE_PITCH).reverse();
  const noteBaselines = noteRules.slice(0, FLOOR_PLAN_NOTES.length).map((rule) => rule - 12);
  const drawingTop = addressY - 18;
  const drawingBottom = noteRules[0] + 16;
  return {
    titleY,
    bar: { x: g.margin - 8, y: titleY - 6, width: 3, height: 18 },
    underlineY,
    addressY,
    drawing: { x: g.margin, y: drawingBottom, width: g.pageWidth - 2 * g.margin, height: drawingTop - drawingBottom },
    noteBaselines,
    noteRules,
    termX: g.margin,
    definitionX: g.margin + 118,
  };
}

export interface FloorPlanSheetStyle {
  regular: PDFFont;
  bold: PDFFont;
  navy: RGB;
  gold: RGB;
  body: RGB;
  rule: RGB;
  titleSize: number;
}

/**
 * Embed a plan, or answer null — separately from drawing it, so the caller can
 * decide whether to add a page at all before it adds one.
 */
export async function embedFloorPlan(
  pdfDoc: PDFDocument,
  plan: InvestmentPdfPicture | null | undefined,
): Promise<PDFImage | null> {
  return embed(pdfDoc, plan);
}

/** Draw one floor-plan sheet on a fresh content page. */
export function drawStandardFloorPlanSheet(
  page: PDFPage,
  plan: PDFImage,
  opts: {
    geometry: StandardPageGeometry;
    style: FloorPlanSheetStyle;
    address: string | null | undefined;
    continued: boolean;
  },
): void {
  const { geometry: g, style: s } = opts;
  const layout = floorPlanSheetLayout(g);
  const title = opts.continued ? 'Floor plan (continued)' : 'Floor plan';

  page.drawRectangle({ ...layout.bar, color: s.gold });
  page.drawText(title, { x: g.margin, y: layout.titleY, size: s.titleSize, font: s.bold, color: s.navy });
  const titleWidth = s.bold.widthOfTextAtSize(title, s.titleSize);
  page.drawLine({
    start: { x: g.margin, y: layout.underlineY },
    end: { x: g.margin + Math.min(titleWidth + 20, g.pageWidth - 2 * g.margin), y: layout.underlineY },
    thickness: 1,
    color: s.gold,
  });

  const line = fitLine(String(opts.address ?? ''), (text) => s.regular.widthOfTextAtSize(text, 9), g.pageWidth - 2 * g.margin);
  if (line) page.drawText(line, { x: g.margin, y: layout.addressY, size: 9, font: s.regular, color: s.body });

  page.drawImage(plan, containFit({ width: plan.width, height: plan.height }, layout.drawing));

  for (const y of layout.noteRules) {
    page.drawLine({ start: { x: g.margin, y }, end: { x: g.pageWidth - g.margin, y }, thickness: 0.5, color: s.rule });
  }
  FLOOR_PLAN_NOTES.forEach((note, i) => {
    const y = layout.noteBaselines[i];
    page.drawText(note.term, { x: layout.termX, y, size: 8, font: s.bold, color: s.navy });
    page.drawText(note.definition, { x: layout.definitionX, y, size: 8, font: s.regular, color: s.body });
  });
}
