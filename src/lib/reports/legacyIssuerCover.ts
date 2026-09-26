/**
 * The issuer's cover, drawn in jsPDF for the older client-side documents.
 *
 * On a clone these documents open on the same cover the standard Investment
 * presentation opens on (`investmentPdfCover.ts`): the issuer's mark, its name
 * in tracked serif capitals, the document's title, a divider, the document's
 * subject, and the document's one-line description where the standard cover
 * puts a photograph — in the issuer's brand family on the dark field. Every
 * position comes from that cover's own layout (`issuerCoverLayout`), set in
 * points on its 595.5 × 842.25 sheet and scaled to this document's page, so a
 * tenant's documents open on one design whichever library draws them.
 *
 * It draws on the CURRENT page, which must be empty: it is page one of a
 * document that has only just been created.
 *
 * ## In a template design
 *
 * A document given a design somebody chose (`drawnDesign.pure.ts`) takes the
 * design's cover rather than the issuer's: its ground — the whole sheet in
 * the field colour, a band of it across the head of the sheet carrying the
 * lockup, or the design's paper — a frame only where the design has one, and
 * the issuer's name in the standard face nearest the design's. Every ink is
 * the one the design's own audit holds to the ground it is drawn on: field
 * inks in the field and the band, paper inks on paper. Without a design every
 * call below is made exactly as it always was, so the issuer's own cover is
 * unchanged to the byte.
 */
import type { jsPDF } from 'jspdf';
import type { BrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import {
  isLightGround,
  lockupGround,
  type DrawnDocumentDesign,
  type DrawnFace,
} from '@/lib/reportDesign/drawnDesign.pure';
import {
  ISSUER_COVER_SIZE,
  ISSUER_COVER_TYPE,
  issuerCoverLayout,
  issuerMarkSize,
} from './investment/investmentPdfCover';
import { containFit, fitCoverAddress, winAnsiTypographic, type InvestmentPdfPicture } from './investment/investmentPdfPictures';
import { balanceLines, fitIssuerName } from './investment/standardCover.pure';
import { rgbTriple } from './legacyDocumentBrand';

/** Points in a millimetre — jsPDF's text spacing is in the document's unit. */
const PT_PER_MM = 72 / 25.4;

/**
 * Cap heights of the three standard faces as a fraction of their size, so a
 * name set in any of them sits on the baseline the layout gives it. Courier's
 * is its own font metric (562/1000).
 */
const CAP: Readonly<Record<DrawnFace, number>> = Object.freeze({
  times: ISSUER_COVER_TYPE.timesCap,
  helvetica: ISSUER_COVER_TYPE.helveticaCap,
  courier: 0.562,
});

/**
 * A band cover's band, from the top of the sheet in points, and the zone the
 * lockup is centred in inside it. Deep enough for the tallest lockup the cover
 * sets — a mark, three lines of name, the rule and the title come to about
 * 200pt — with the divider, the subject and the standfirst on paper below.
 */
const BAND_FROM_TOP = 300;
const BAND_LOCKUP_ZONE = Object.freeze({ top: 40, bottom: BAND_FROM_TOP - 20 });

/**
 * A string's width in points at `size`, as jsPDF will draw it.
 *
 * jsPDF measures the standard fonts with their kerning pairs by default, but
 * draws them unkerned — so a line centred on the kerned width sits a fraction
 * left of centre. Measuring unkerned is measuring what is drawn.
 */
function drawnWidth(doc: jsPDF, text: string, size: number): number {
  return doc.getStringUnitWidth(text, { doKerning: false }) * size;
}

export interface LegacyIssuerCoverInput {
  /** The name the document is issued under. Never empty — the resolver guarantees it. */
  issuerName: string;
  mark: InvestmentPdfPicture | null;
  /** What the document is, e.g. "Borrowing Capacity Snapshot". */
  documentTitle: string;
  /** Who or what it is about, set under the divider: an address or a client's name. */
  subject?: string | null;
  /** One line on what the document is for, where the standard cover has a photograph. */
  standfirst?: string | null;
  family: BrandFamily;
  /**
   * A template design's cover — its ground, frame and faces — or absent for
   * the issuer's own: the field, framed, the name in Times.
   */
  design?: DrawnDocumentDesign | null;
  /** The issuer's mark for a light ground, drawn where the design sets the lockup on one. */
  paperMark?: InvestmentPdfPicture | null;
}

/** What was drawn, for the log line and the tests. */
export interface LegacyIssuerCoverResult {
  nameLines: string[];
  markDrawn: boolean;
}

/**
 * Draw the issuer's cover on the current page of a jsPDF document whose unit
 * is millimetres.
 */
export function drawLegacyIssuerCover(doc: jsPDF, input: LegacyIssuerCoverInput): LegacyIssuerCoverResult {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const sx = pageW / ISSUER_COVER_SIZE.width;
  const sy = pageH / ISSUER_COVER_SIZE.height;
  /** A point on the cover's sheet, measured up from its foot, to this page's millimetres. */
  const x = (pt: number) => pt * sx;
  const y = (pt: number) => (ISSUER_COVER_SIZE.height - pt) * sy;
  const { family } = input;
  const design = input.design ?? null;
  const ground = design?.cover.ground ?? 'field';
  const palette = family.palette;
  const field = rgbTriple(family.field);
  const gold = rgbTriple(family.accentOnField);
  const ivory = rgbTriple(family.onField);
  // The lockup (mark, name, rule, title) sits on paper only on a paper cover;
  // everything under it sits on paper on a band cover too.
  const lockupOnPaper = ground === 'paper';
  const lowerOnPaper = ground !== 'field';
  const nameInk = lockupOnPaper ? rgbTriple(palette.accentOnPaper) : gold;
  const titleInk = lockupOnPaper ? rgbTriple(palette.bodyInk) : ivory;
  const dividerInk = lowerOnPaper ? rgbTriple(palette.accentOnPaper) : gold;
  const subjectInk = lowerOnPaper ? rgbTriple(palette.bodyInk) : ivory;
  const standfirstInk = lowerOnPaper ? rgbTriple(palette.mutedInk) : ivory;
  const frameInk = ground === 'field' ? gold : ground === 'paper' ? rgbTriple(palette.accentOnPaper) : rgbTriple(family.accent);
  const nameFace: DrawnFace = design?.faces.cover ?? 'times';
  const standfirstFace: DrawnFace = design && design.faces.heading !== 'times' ? 'helvetica' : 'times';

  if (ground === 'field') {
    doc.setFillColor(...field);
    doc.rect(0, 0, pageW, pageH, 'F');
  } else {
    doc.setFillColor(...rgbTriple(palette.paper));
    doc.rect(0, 0, pageW, pageH, 'F');
    if (ground === 'band') {
      doc.setFillColor(...field);
      doc.rect(0, 0, pageW, BAND_FROM_TOP * sy, 'F');
    }
  }

  // The mark drawn for the ground the lockup sits on: the knockout on a dark
  // one, the issuer's colour mark on a light one.
  const coverMark = design && isLightGround(lockupGround(design)) ? input.paperMark ?? null : input.mark;

  // The mark's printed size needs its pixel size; a mark jsPDF cannot read is no mark.
  let markSize: { width: number; height: number } | null = null;
  let markFormat: 'PNG' | 'JPEG' = 'PNG';
  if (coverMark?.bytes?.length) {
    try {
      const props = doc.getImageProperties(coverMark.bytes);
      if (props.width > 0 && props.height > 0) {
        markSize = issuerMarkSize({ width: props.width, height: props.height });
        markFormat = coverMark.format === 'jpeg' ? 'JPEG' : 'PNG';
      }
    } catch (err) {
      console.warn('[legacyIssuerCover] the issuer mark could not be read', err);
    }
  }

  doc.setFont(nameFace, 'normal');
  const name = fitIssuerName(
    winAnsiTypographic(input.issuerName),
    (text, size) => drawnWidth(doc, text, size),
    ISSUER_COVER_TYPE.measure.right - ISSUER_COVER_TYPE.measure.left,
  );
  const layout = issuerCoverLayout({
    mark: markSize,
    name: { lines: name?.lines.length ?? 1, size: name?.size ?? 24 },
    ...(design ? { nameCap: CAP[nameFace] } : {}),
    ...(ground === 'band' ? { lockupZone: BAND_LOCKUP_ZONE } : {}),
  });

  // The frame — the issuer's own cover always has one; a design, only where it does.
  if (design ? design.cover.frame : true) {
    doc.setDrawColor(...frameInk);
    doc.setLineWidth(ISSUER_COVER_TYPE.frameStroke * sx);
    doc.rect(x(layout.frame.x), y(layout.frame.y + layout.frame.height), layout.frame.width * sx, layout.frame.height * sy, 'S');
  }

  let markDrawn = false;
  if (markSize && layout.mark && coverMark) {
    try {
      const placed = containFit(markSize, layout.mark);
      doc.addImage(coverMark.bytes, markFormat, x(placed.x), y(placed.y + placed.height), placed.width * sx, placed.height * sy);
      markDrawn = true;
    } catch (err) {
      console.warn('[legacyIssuerCover] the issuer mark could not be drawn', err);
    }
  }

  // The name, centred, one baseline per line.
  if (name) {
    doc.setFont(nameFace, 'normal');
    doc.setFontSize(name.size);
    doc.setTextColor(...nameInk);
    name.lines.forEach((line, i) => {
      const width = drawnWidth(doc, line, name.size) + name.tracking * Math.max(0, line.length - 1);
      doc.text(line, x(ISSUER_COVER_SIZE.width / 2 - width / 2), y(layout.nameBaselines[i]), {
        charSpace: name.tracking / PT_PER_MM,
      });
    });
  }

  // The issuer's own cover draws the rule in the frame's gold, already set.
  if (design) doc.setDrawColor(...nameInk);
  doc.setLineWidth(ISSUER_COVER_TYPE.rule * sx);
  doc.line(x(layout.rule.x1), y(layout.rule.y), x(layout.rule.x2), y(layout.rule.y));

  // The document's title in tracked capitals.
  const title = winAnsiTypographic(input.documentTitle).toUpperCase();
  if (title) {
    const { size, tracking } = ISSUER_COVER_TYPE.title;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...titleInk);
    const width = drawnWidth(doc, title, size) + tracking * Math.max(0, title.length - 1);
    doc.text(title, x(ISSUER_COVER_SIZE.width / 2 - width / 2), y(layout.titleBaseline), { charSpace: tracking / PT_PER_MM });
  }

  doc.setDrawColor(...dividerInk);
  doc.setLineWidth(ISSUER_COVER_TYPE.divider * sx);
  doc.line(x(layout.divider.x1), y(layout.divider.y), x(layout.divider.x2), y(layout.divider.y));

  // The subject under the divider, where the standard cover sets the address.
  doc.setFont('helvetica', 'normal');
  const subject = fitCoverAddress(
    String(input.subject ?? ''),
    (text, size) => drawnWidth(doc, text, size),
    ISSUER_COVER_TYPE.measure.right - ISSUER_COVER_TYPE.measure.left,
    winAnsiTypographic,
  );
  if (subject) {
    doc.setFontSize(subject.size);
    doc.setTextColor(...subjectInk);
    doc.text(
      subject.text,
      x(ISSUER_COVER_SIZE.width / 2 - subject.width / 2),
      y(layout.addressMiddle - (subject.size * ISSUER_COVER_TYPE.helveticaCap) / 2),
      { charSpace: subject.tracking / PT_PER_MM },
    );
  }

  // The standfirst, where the standard cover puts a photograph.
  const standfirst = winAnsiTypographic(input.standfirst ?? '');
  if (standfirst) {
    const { size, leading, measure } = ISSUER_COVER_TYPE.standfirst;
    doc.setFont(standfirstFace, 'italic');
    doc.setFontSize(size);
    doc.setTextColor(...standfirstInk);
    const lines = balanceLines(standfirst, (line) => drawnWidth(doc, line, size), measure).slice(0, 4);
    const middle = (layout.standfirstZone.top + layout.standfirstZone.bottom) / 2;
    const blockHeight = (lines.length - 1) * leading;
    lines.forEach((line, i) => {
      const width = drawnWidth(doc, line, size);
      doc.text(
        line,
        x(ISSUER_COVER_SIZE.width / 2 - width / 2),
        y(middle + blockHeight / 2 - i * leading - (size * CAP[standfirstFace]) / 2),
      );
    });
  }

  // Leave the document as a caller expects to find it: no spacing, plain Helvetica.
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'normal');
  return { nameLines: name?.lines ?? [], markDrawn };
}
