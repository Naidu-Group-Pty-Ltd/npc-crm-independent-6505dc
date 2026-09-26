/**
 * The standard presentation's content page for a document that is not NPC's.
 *
 * NPC's template page (`public/templates/npc_template.pdf`, page 2) carries a
 * corner device in each of two corners: charcoal bands striped in NPC's gold.
 * There is no name in it, which is why #2775 still copied it onto every
 * issuer's pages — but it is NPC's device, drawn in NPC's colours, and once an
 * issuer's own colours are on the page it is the one thing left that belongs
 * to somebody else. So an issuer's page is drawn instead of copied:
 *
 *  - **The same sheet, to the point.** The template page's MediaBox is
 *    [0 7.83 595.5 850.08], not [0 0 595.5 842.25], and every coordinate the
 *    body draws at was measured against it. A fresh page takes the same box,
 *    so every line of the body lands exactly where it lands on NPC's page.
 *  - **A running head in the issuer's words** — its name at the left margin,
 *    the document's title at the right — in small tracked capitals, in the
 *    palette's muted ink at 7:1. That is the design system's rule for a
 *    running head: the wordmark as text, never a repeated image
 *    (`REPORT_RULES.md` §5).
 *  - **One rule under it in the brand**, with a short, heavier lead-in at the
 *    left margin: the brand's colour at the top of every page, drawn in the
 *    band the corner device occupied, where the body never prints.
 *
 * The body is drawn over this exactly as it is drawn over NPC's page; the
 * footer pass adds its rule and folio afterwards, in the issuer's colours.
 */
import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { hexToRgb01 } from '@/lib/reportDesign/color.pure';
import type { BrandFamily } from '@/lib/reportDesign/brandFamily.pure';
import { drawTracked, winAnsiTypographic } from './investmentPdfPictures';

/** The template content page's own box — see the module comment. */
export const TEMPLATE_CONTENT_BOX = Object.freeze({ x: 0, y: 7.8299813, width: 595.5, height: 842.2499787 });

/** The top of the visible sheet, in the page's own coordinates. */
const SHEET_TOP = TEMPLATE_CONTENT_BOX.y + TEMPLATE_CONTENT_BOX.height;

/** The running head's baseline and rule, measured down from the sheet's top. */
export const RUNNING_HEAD = Object.freeze({
  baselineFromTop: 38,
  ruleFromTop: 46,
  size: 6.5,
  tracking: 1.3,
  leadIn: Object.freeze({ width: 34, thickness: 2 }),
  hairline: 0.5,
});

const hex = (value: string): RGB => {
  const [r, g, b] = hexToRgb01(value);
  return rgb(r, g, b);
};

export interface IssuerRunningHead {
  /** The issuer's name, set at the left margin. */
  issuerName: string;
  /** The document's title, set at the right margin. */
  documentTitle: string;
}

export interface IssuerContentPageInput extends IssuerRunningHead {
  family: BrandFamily;
  font: PDFFont;
  /** The body's left and right margin, so the head aligns with the text under it. */
  margin: number;
}

/** Where the running head goes on a page of this sheet. */
export function issuerRunningHeadLayout(margin: number): {
  baseline: number;
  rule: { y: number; x1: number; x2: number };
  leadIn: { x: number; y: number; width: number; height: number };
} {
  const ruleY = SHEET_TOP - RUNNING_HEAD.ruleFromTop;
  return {
    baseline: SHEET_TOP - RUNNING_HEAD.baselineFromTop,
    rule: { y: ruleY, x1: margin, x2: TEMPLATE_CONTENT_BOX.width - margin },
    leadIn: {
      x: margin,
      y: ruleY - RUNNING_HEAD.leadIn.thickness / 2,
      width: RUNNING_HEAD.leadIn.width,
      height: RUNNING_HEAD.leadIn.thickness,
    },
  };
}

/** The widest a running-head string may run: half the measure, less a gap. */
function fitHead(text: string, font: PDFFont, room: number): string {
  let value = winAnsiTypographic(text).toUpperCase().trim();
  const width = (s: string) => font.widthOfTextAtSize(s, RUNNING_HEAD.size) + RUNNING_HEAD.tracking * Math.max(0, s.length - 1);
  if (width(value) <= room) return value;
  while (value.length > 1 && width(`${value}…`) > room) value = value.slice(0, -1).trimEnd();
  return `${value}…`;
}

/**
 * Add one issuer content page at the end of `pdfDoc` and draw its furniture.
 */
export function addIssuerContentPage(pdfDoc: PDFDocument, input: IssuerContentPageInput): PDFPage {
  const box = TEMPLATE_CONTENT_BOX;
  const page = pdfDoc.addPage([box.width, box.height]);
  page.setMediaBox(box.x, box.y, box.width, box.height);
  drawIssuerRunningHead(page, input);
  return page;
}

/** The running head and its rule, in the issuer's colours. */
export function drawIssuerRunningHead(page: PDFPage, input: IssuerContentPageInput): void {
  const { family, font, margin } = input;
  const layout = issuerRunningHeadLayout(margin);
  const room = (layout.rule.x2 - layout.rule.x1) / 2 - 12;
  const ink = hex(family.mutedInk);

  const left = fitHead(input.issuerName, font, room);
  if (left) {
    drawTracked(page, left, {
      x: layout.rule.x1, y: layout.baseline, size: RUNNING_HEAD.size, tracking: RUNNING_HEAD.tracking, font, color: ink,
    });
  }
  const right = fitHead(input.documentTitle, font, room);
  if (right) {
    const width = font.widthOfTextAtSize(right, RUNNING_HEAD.size) + RUNNING_HEAD.tracking * Math.max(0, right.length - 1);
    drawTracked(page, right, {
      x: layout.rule.x2 - width, y: layout.baseline, size: RUNNING_HEAD.size, tracking: RUNNING_HEAD.tracking, font, color: ink,
    });
  }

  page.drawLine({
    start: { x: layout.rule.x1, y: layout.rule.y },
    end: { x: layout.rule.x2, y: layout.rule.y },
    thickness: RUNNING_HEAD.hairline,
    color: hex(family.hairline),
  });
  page.drawRectangle({ ...layout.leadIn, color: hex(family.accent) });
}
