/**
 * A chosen design's cover ground, painted on the first page of a jsPDF
 * document that composes its own cover.
 *
 * Most drawn documents open on the issuer's cover (`legacyIssuerCover.ts`),
 * which takes a design whole. A few compose a cover of their own — the
 * Commercial and Industrial Investment Reports and the Overview snapshot —
 * and keep it: its words, its figures and where they sit are the document's.
 * What a design changes on those covers is the ground under the words and the
 * inks the words are set in, the same three grounds the catalogue draws
 * (`drawnDesign.pure.ts`). (The quantitative market report does not paint
 * one: every page of it is dark, so it takes a design's colours through its
 * own dark palette, `darkReportPalette` in `ReportViewer.tsx`.)
 *
 *  - **field** — the whole sheet in the design's field, every word in its
 *    field inks;
 *  - **band** — the design's paper, with a band of the field across the head of
 *    the sheet down to where the document's own heading block ends; the heading
 *    keeps field inks and everything under the band takes paper inks;
 *  - **paper** — the design's paper, every word in its paper inks.
 *
 * Every ink is one the design's own audit holds to the ground it is drawn on,
 * so nothing here can set a word its ground cannot carry. A frame is drawn only
 * where the design has one.
 */
import type { jsPDF } from 'jspdf';
import type { DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import { rgbObject } from './legacyDocumentBrand';

export type Rgb = { r: number; g: number; b: number };

/** The three inks a cover sets words in. */
export interface CoverInks {
  /** Titles and figures. */
  ink: Rgb;
  /** Eyebrows, rules and the words the document sets in its accent. */
  accent: Rgb;
  /** Dates, names and the lines a document sets quietly. */
  muted: Rgb;
}

/** The design's inks for its field. */
export function fieldInks(design: DrawnDocumentDesign): CoverInks {
  const f = design.family;
  return { ink: rgbObject(f.onField), accent: rgbObject(f.accentOnField), muted: rgbObject(f.onField) };
}

/** The design's inks for its paper. */
export function paperInks(design: DrawnDocumentDesign): CoverInks {
  const p = design.family.palette;
  return { ink: rgbObject(p.bodyInk), accent: rgbObject(p.accentOnPaper), muted: rgbObject(p.mutedInk) };
}

export interface PaintedCover {
  /** Inks for the head of the sheet — inside the band on a band cover. */
  head: CoverInks;
  /** Inks for everything under the band. The head's inks on a field or paper cover. */
  foot: CoverInks;
}

/**
 * Paint the design's cover ground on the current page and answer the inks the
 * cover's words take.
 *
 * `bandBottom` is where a band cover's band ends, in the page's own unit — the
 * foot of the document's heading block — so the heading sits in the band and
 * nothing under it does.
 */
export function paintDesignCover(
  doc: jsPDF,
  design: DrawnDocumentDesign,
  opts: { bandBottom: number },
): PaintedCover {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const field = rgbObject(design.family.field);
  const paper = rgbObject(design.family.palette.paper);
  const { ground, frame } = design.cover;

  if (ground === 'field') {
    doc.setFillColor(field.r, field.g, field.b);
    doc.rect(0, 0, pageW, pageH, 'F');
  } else {
    doc.setFillColor(paper.r, paper.g, paper.b);
    doc.rect(0, 0, pageW, pageH, 'F');
    if (ground === 'band') {
      doc.setFillColor(field.r, field.g, field.b);
      doc.rect(0, 0, pageW, Math.min(Math.max(opts.bandBottom, 0), pageH), 'F');
    }
  }

  const head = ground === 'paper' ? paperInks(design) : fieldInks(design);
  const foot = ground === 'field' ? fieldInks(design) : paperInks(design);

  if (frame) {
    // Inside the trim by a margin the eye reads as deliberate, never as bleed.
    const inset = Math.min(pageW, pageH) * 0.04;
    doc.setDrawColor(head.accent.r, head.accent.g, head.accent.b);
    doc.setLineWidth(Math.min(pageW, pageH) * 0.0012);
    doc.rect(inset, inset, pageW - inset * 2, pageH - inset * 2, 'S');
  }
  return { head, foot };
}
