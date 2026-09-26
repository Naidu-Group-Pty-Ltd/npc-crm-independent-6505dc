/**
 * The standard presentation's cover for a document that is not NPC's.
 *
 * `standardCover.pure.ts` decides which cover a document gets; this draws the
 * one that belongs to the issuer. It is composed to sit where the template
 * cover sits, so the two presentations of a report differ in whose name is on
 * them and nothing else:
 *   - the same sheet (595.5 × 842.25pt, the template's own);
 *   - the same dark field as the closing page, with the issuer's brand in
 *     the accent — its brand family (`brandFamily.pure.ts`), or the platform's
 *     gold where it has no colour — so the first and last pages of the
 *     document are a pair;
 *   - the lockup (the issuer's mark, its name, the document's title) in the
 *     upper field, where the template carries its lockup;
 *   - the divider 560.5pt down and the photograph band from 590pt down, exactly
 *     where the template cover has them, so the photograph lands in the same
 *     place on either cover. With no photograph, the band's place holds the
 *     document's standfirst instead.
 *
 * Nothing here is NPC's: no monogram, no tagline, no ornament from the artwork.
 * The issuer's name is set in the platform's serif capitals, and its mark is
 * the knockout lockup the Branding page stores for a dark ground.
 *
 * Every text on the sheet is real text, so the cover reads aloud and copies
 * out as what it says.
 */
import {
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { resolveBrandFamily, type BrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { hexToRgb01 } from '@/lib/reportDesign/color.pure';
import {
  containFit,
  coverFit,
  drawTracked,
  fitCoverAddress,
  winAnsiTypographic,
  type Box,
  type InvestmentPdfPicture,
} from './investmentPdfPictures';
import { balanceLines, fitIssuerName, type IssuerNameSetting } from './standardCover.pure';

/** The template's sheet, so every page of the document is one size. */
export const ISSUER_COVER_SIZE = Object.freeze({ width: 595.5, height: 842.25 });

/** The gold frame's distance from the trim. */
const FRAME_INSET = 22;
/** The measure the name, the divider and the address are set to. */
const MEASURE = Object.freeze({ left: 70, right: ISSUER_COVER_SIZE.width - 70 });
/** Where the template cover's divider and photograph band sit, from the top. */
const DIVIDER_FROM_TOP = 560.5;
const BAND_FROM_TOP = 590;
/** The field the lockup is centred in, from the top. */
const LOCKUP_ZONE = Object.freeze({ top: 72, bottom: 530 });
/**
 * The mark's box: 22mm tall, the height the design system prints a cover mark
 * at, and never more than 150dpi can hold sharp.
 */
const MARK_BOX = Object.freeze({ width: 220, height: 62 });
const MARK_PT_PER_PX = 72 / 150;

/** Cap heights of the two standard faces, as a fraction of their size. */
const TIMES_CAP = 0.662;
const HELVETICA_CAP = 0.718;

const NAME_PITCH = 1.14;
const MARK_GAP = 26;
const RULE_GAP = 16;
const TITLE_GAP = 18;
const TITLE_SIZE = 9;
const TITLE_TRACKING = 2.2;
const STANDFIRST = Object.freeze({ size: 12.5, leading: 18, measure: 330 });

/**
 * How the issuer's cover sets its type, for a second drawing of the same cover
 * in another library (`legacyIssuerCover.ts`, in jsPDF) — one set of numbers,
 * so the two drawings cannot drift apart.
 */
export const ISSUER_COVER_TYPE = Object.freeze({
  timesCap: TIMES_CAP,
  helveticaCap: HELVETICA_CAP,
  title: Object.freeze({ size: TITLE_SIZE, tracking: TITLE_TRACKING }),
  standfirst: STANDFIRST,
  measure: MEASURE,
  frameStroke: 0.6,
  rule: 0.75,
  divider: 0.5,
});

/** The mark's printed size: fitted to its box, never upscaled past 150dpi. */
export function issuerMarkSize(image: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(MARK_BOX.width / image.width, MARK_BOX.height / image.height, MARK_PT_PER_PX);
  return { width: image.width * scale, height: image.height * scale };
}

export interface IssuerCoverLayout {
  frame: Box;
  mark: Box | null;
  /** One baseline per line of the name, top first. */
  nameBaselines: number[];
  rule: { y: number; x1: number; x2: number };
  titleBaseline: number;
  divider: { y: number; x1: number; x2: number };
  /** The optical middle of the address line. */
  addressMiddle: number;
  band: Box;
  /** Where the standfirst is centred when there is no photograph. */
  standfirstZone: { top: number; bottom: number };
}

/**
 * Where everything on the issuer's cover goes, in PDF space.
 *
 * The lockup — mark, name, rule, title — is one group, centred in the upper
 * field; the divider, address and band are fixed, where the template cover has
 * them. The layout is computed before anything is drawn, so a test can hold it
 * to its promises without a PDF.
 */
export function issuerCoverLayout(input: {
  mark: { width: number; height: number } | null;
  name: { lines: number; size: number };
}): IssuerCoverLayout {
  const { width: W, height: H } = ISSUER_COVER_SIZE;
  const fromTop = (d: number) => H - d;
  const cap = input.name.size * TIMES_CAP;
  const pitch = input.name.size * NAME_PITCH;
  const markBlock = input.mark ? input.mark.height + MARK_GAP : 0;
  const groupHeight = markBlock + cap + (input.name.lines - 1) * pitch
    + RULE_GAP + TITLE_GAP + TITLE_SIZE * HELVETICA_CAP;
  const groupTop = (LOCKUP_ZONE.top + LOCKUP_ZONE.bottom) / 2 - groupHeight / 2;

  const mark = input.mark
    ? {
      x: (W - input.mark.width) / 2,
      y: fromTop(groupTop + input.mark.height),
      width: input.mark.width,
      height: input.mark.height,
    }
    : null;
  const firstBaseline = groupTop + markBlock + cap;
  const nameBaselines = Array.from({ length: input.name.lines }, (_, i) => fromTop(firstBaseline + i * pitch));
  const lastBaseline = firstBaseline + (input.name.lines - 1) * pitch;
  const ruleFromTop = lastBaseline + RULE_GAP;
  const titleBaseline = fromTop(ruleFromTop + TITLE_GAP + TITLE_SIZE * HELVETICA_CAP);

  const bandTop = fromTop(BAND_FROM_TOP);
  const dividerY = fromTop(DIVIDER_FROM_TOP);
  return {
    frame: { x: FRAME_INSET, y: FRAME_INSET, width: W - 2 * FRAME_INSET, height: H - 2 * FRAME_INSET },
    mark,
    nameBaselines,
    rule: { y: fromTop(ruleFromTop), x1: W / 2 - 20, x2: W / 2 + 20 },
    titleBaseline,
    divider: { y: dividerY, x1: MEASURE.left, x2: MEASURE.right },
    addressMiddle: (dividerY + bandTop) / 2,
    band: { x: FRAME_INSET, y: FRAME_INSET, width: W - 2 * FRAME_INSET, height: bandTop - FRAME_INSET },
    standfirstZone: { top: bandTop - 24, bottom: FRAME_INSET + 36 },
  };
}

const hex = (value: string): RGB => {
  const [r, g, b] = hexToRgb01(value);
  return rgb(r, g, b);
};

async function embedMark(pdfDoc: PDFDocument, mark: InvestmentPdfPicture | null): Promise<PDFImage | null> {
  if (!mark?.bytes?.length) return null;
  try {
    const image = mark.format === 'png' ? await pdfDoc.embedPng(mark.bytes) : await pdfDoc.embedJpg(mark.bytes);
    return image.width > 0 && image.height > 0 ? image : null;
  } catch (err) {
    console.warn('[investmentPdfCover] the issuer mark could not be embedded', err);
    return null;
  }
}

async function embedPhotograph(pdfDoc: PDFDocument, photograph: InvestmentPdfPicture | null | undefined): Promise<PDFImage | null> {
  if (!photograph?.bytes?.length) return null;
  try {
    const image = photograph.format === 'png'
      ? await pdfDoc.embedPng(photograph.bytes)
      : await pdfDoc.embedJpg(photograph.bytes);
    return image.width > 0 && image.height > 0 ? image : null;
  } catch (err) {
    console.warn('[investmentPdfCover] the cover photograph could not be embedded', err);
    return null;
  }
}

export interface IssuerCoverInput {
  /** The name the document is issued under. Never empty — the resolver guarantees it. */
  issuerName: string;
  mark: InvestmentPdfPicture | null;
  /** The tier's document title, e.g. "Investment Compass". */
  documentTitle: string;
  /** The tier's one-line description, drawn where a photograph would be. */
  standfirst: string | null;
  address: string | null | undefined;
  photograph: InvestmentPdfPicture | null | undefined;
  fonts: { serif: PDFFont; italic: PDFFont; sans: PDFFont };
  /** The issuer's colours. Absent, the platform's — the family of no brand colour. */
  family?: BrandFamily | null;
}

/** What was drawn, for the log line and the tests. */
export interface IssuerCoverResult {
  page: PDFPage;
  name: IssuerNameSetting | null;
  markDrawn: boolean;
  photographDrawn: boolean;
}

/**
 * Add the issuer's cover as the next page of `pdfDoc` — the first, in a
 * document that has none yet.
 */
export async function drawIssuerCover(pdfDoc: PDFDocument, input: IssuerCoverInput): Promise<IssuerCoverResult> {
  const family = input.family ?? resolveBrandFamily(null);
  const field = hex(family.field);
  const gold = hex(family.accentOnField);
  const ivory = hex(family.onField);
  const { serif, italic, sans } = input.fonts;
  const { width: W, height: H } = ISSUER_COVER_SIZE;

  const page = pdfDoc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: field });

  const markImage = await embedMark(pdfDoc, input.mark);
  const markSize = markImage ? issuerMarkSize({ width: markImage.width, height: markImage.height }) : null;
  const name = fitIssuerName(
    winAnsiTypographic(input.issuerName),
    (text, size) => serif.widthOfTextAtSize(text, size),
    MEASURE.right - MEASURE.left,
  );
  const layout = issuerCoverLayout({
    mark: markSize,
    name: { lines: name?.lines.length ?? 1, size: name?.size ?? 24 },
  });

  const photo = await embedPhotograph(pdfDoc, input.photograph);
  if (photo) {
    const placed = coverFit({ width: photo.width, height: photo.height }, layout.band);
    page.pushOperators(
      pushGraphicsState(),
      rectangle(layout.band.x, layout.band.y, layout.band.width, layout.band.height),
      clip(),
      endPath(),
    );
    page.drawImage(photo, placed);
    page.pushOperators(popGraphicsState());
    const top = layout.band.y + layout.band.height;
    page.drawLine({ start: { x: layout.band.x, y: top }, end: { x: layout.band.x + layout.band.width, y: top }, thickness: ISSUER_COVER_TYPE.rule, color: gold });
  }

  // The frame last among the rules, so it runs cleanly over the photograph's edge.
  page.drawRectangle({ ...layout.frame, borderColor: gold, borderWidth: ISSUER_COVER_TYPE.frameStroke });

  if (markImage && layout.mark) page.drawImage(markImage, containFit({ width: markImage.width, height: markImage.height }, layout.mark));

  if (name) {
    name.lines.forEach((line, i) => {
      const width = serif.widthOfTextAtSize(line, name.size) + name.tracking * Math.max(0, line.length - 1);
      drawTracked(page, line, {
        x: W / 2 - width / 2, y: layout.nameBaselines[i], size: name.size, tracking: name.tracking, font: serif, color: gold,
      });
    });
  }
  page.drawLine({ start: { x: layout.rule.x1, y: layout.rule.y }, end: { x: layout.rule.x2, y: layout.rule.y }, thickness: ISSUER_COVER_TYPE.rule, color: gold });

  const title = winAnsiTypographic(input.documentTitle).toUpperCase();
  if (title) {
    const width = sans.widthOfTextAtSize(title, TITLE_SIZE) + TITLE_TRACKING * Math.max(0, title.length - 1);
    drawTracked(page, title, { x: W / 2 - width / 2, y: layout.titleBaseline, size: TITLE_SIZE, tracking: TITLE_TRACKING, font: sans, color: ivory });
  }

  page.drawLine({ start: { x: layout.divider.x1, y: layout.divider.y }, end: { x: layout.divider.x2, y: layout.divider.y }, thickness: ISSUER_COVER_TYPE.divider, color: gold });

  const address = fitCoverAddress(
    String(input.address ?? ''),
    (text, size) => sans.widthOfTextAtSize(text, size),
    MEASURE.right - MEASURE.left,
    winAnsiTypographic,
  );
  if (address) {
    drawTracked(page, address.text, {
      x: W / 2 - address.width / 2,
      y: layout.addressMiddle - (address.size * HELVETICA_CAP) / 2,
      size: address.size,
      tracking: address.tracking,
      font: sans,
      color: ivory,
    });
  }

  const standfirst = winAnsiTypographic(input.standfirst ?? '');
  if (!photo && standfirst) {
    const lines = balanceLines(standfirst, (line) => italic.widthOfTextAtSize(line, STANDFIRST.size), STANDFIRST.measure).slice(0, 4);
    const middle = (layout.standfirstZone.top + layout.standfirstZone.bottom) / 2;
    const blockHeight = (lines.length - 1) * STANDFIRST.leading;
    lines.forEach((line, i) => {
      const width = italic.widthOfTextAtSize(line, STANDFIRST.size);
      page.drawText(line, {
        x: W / 2 - width / 2,
        y: middle + blockHeight / 2 - i * STANDFIRST.leading - (STANDFIRST.size * TIMES_CAP) / 2,
        size: STANDFIRST.size,
        font: italic,
        color: ivory,
      });
    });
  }

  return { page, name, markDrawn: Boolean(markImage), photographDrawn: Boolean(photo) };
}
