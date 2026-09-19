/**
 * The shared disclaimer & contact page — the dark closing page every report
 * ends on.
 *
 * Two renderers remain because two PDF libraries remain: jsPDF and pdf-lib are
 * both still in the shipping client paths. What is no longer duplicated is the
 * *design*. Both now take their colour from `resolveReportPalette()` and their
 * text shaping from `companyBlock.pure.ts`, which is the same pair the
 * WeasyPrint page uses (`renderCompanyPage` in `primitives.pure.ts`). Three
 * renderers, one page.
 *
 * What changed in the port:
 *  - `#BF9B50` — one of eight brand golds in this repo, and 2.6:1 on the
 *    near-black it was painted on — is gone. The accent is the palette's
 *    on-field brand colour, which is contrast-audited against that exact ground
 *    by `printContrast.spec.ts`.
 *  - `#141414` becomes the design system's obsidian, so the closing page
 *    matches the cover instead of being a different black.
 *  - Contact *values* are set in ink rather than gold. Gold-on-black at 9pt for
 *    a phone number was the least legible type in the product.
 *  - The disclaimer's `font_size` setting is honoured here. The jsPDF
 *    implementation hardcoded 8.5pt and silently ignored it.
 */
import type { jsPDF } from 'jspdf';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { rgb } from 'pdf-lib';
import type { ContactDetails, ProfessionalDisclaimer } from '@/hooks/useGlobalReportSettings';
import { hexToRgb01, mixHex } from '@/lib/reportDesign/color.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import type { ResolvedReportPalette } from '@/lib/reportDesign/roles.pure';
import { disclaimerFontPt, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

/**
 * The house palette.
 *
 * A parameter rather than a constant so Phase 3 can thread a tenant's brand
 * snapshot through without touching eleven call sites.
 */
const DEFAULT_PALETTE = resolveReportPalette();

/** Muted ink on the dark field. No alpha channel on either path — pre-mix it. */
function mutedOnField(palette: ResolvedReportPalette): string {
  return mixHex(palette.onFieldInk, palette.field, 0.32);
}

const to255 = (hex: string): { r: number; g: number; b: number } => {
  const [r, g, b] = hexToRgb01(hex);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

// ═══════════════════════════════════════════════════════════════════════════
//  jsPDF
// ═══════════════════════════════════════════════════════════════════════════

export function drawJsPDFDisclaimerPage(
  doc: jsPDF,
  contact: ContactDetails,
  disclaimer: ProfessionalDisclaimer,
  palette: ResolvedReportPalette = DEFAULT_PALETTE,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;

  const block = resolveCompanyBlock(contact, disclaimer);
  const accent = to255(palette.accentOnField);
  const ink = to255(palette.onFieldInk);
  const muted = to255(mutedOnField(palette));
  const field = to255(palette.field);

  doc.addPage();

  doc.setFillColor(field.r, field.g, field.b);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Company lockup — lead line large, tail line smaller beneath.
  doc.setTextColor(accent.r, accent.g, accent.b);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(block.name.lead, margin, 40);
  if (block.name.tail) {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text(block.name.tail, margin, 52);
  }

  let contactY = 100;

  if (block.rows.length) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(accent.r, accent.g, accent.b);
    doc.text('CONTACT US', margin, 80);

    const labelX = margin;
    const valueX = margin + 35;
    const lineH = 12;

    for (const row of block.rows) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(accent.r, accent.g, accent.b);
      doc.text(`${row.label.toUpperCase()}:`, labelX, contactY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(ink.r, ink.g, ink.b);
      doc.text(row.value, valueX, contactY);
      contactY += lineH;
    }
  }

  if (block.disclaimer.paragraphs.length) {
    const fontPt = block.disclaimer.fontPt;
    doc.setFontSize(fontPt);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(muted.r, muted.g, muted.b);

    const maxW = pageWidth - margin * 1.5;
    const wrapped = block.disclaimer.paragraphs
      .flatMap((para) => doc.splitTextToSize(para, maxW) as string[]);
    // jsPDF measures in mm here; 0.353 converts a point to a millimetre and 1.4
    // is the leading the page has always used.
    const lh = fontPt * 0.353 * 1.4;
    const startY = pageHeight - 20 - wrapped.length * lh;
    doc.text(wrapped, margin * 0.75, Math.max(startY, contactY + 20), {
      lineHeightFactor: 1.4,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  pdf-lib
// ═══════════════════════════════════════════════════════════════════════════

export function drawPdfLibDisclaimerPage(
  pdfDoc: PDFDocument,
  pageWidth: number,
  pageHeight: number,
  helveticaFont: PDFFont,
  helveticaBold: PDFFont,
  contact: ContactDetails,
  disclaimer: ProfessionalDisclaimer,
  palette: ResolvedReportPalette = DEFAULT_PALETTE,
) {
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const marginLeft = 60;

  const block = resolveCompanyBlock(contact, disclaimer);
  const hex = (value: string) => {
    const [r, g, b] = hexToRgb01(value);
    return rgb(r, g, b);
  };
  const accentColor = hex(palette.accentOnField);
  const inkColor = hex(palette.onFieldInk);
  const mutedColor = hex(mutedOnField(palette));

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    color: hex(palette.field),
  });

  let yPos = pageHeight - 80;

  page.drawText(block.name.lead, {
    x: marginLeft, y: yPos, size: 28, font: helveticaBold, color: accentColor,
  });
  if (block.name.tail) {
    yPos -= 20;
    page.drawText(block.name.tail, {
      x: marginLeft, y: yPos, size: 16, font: helveticaFont, color: accentColor,
    });
  }

  yPos -= 40;

  if (block.rows.length) {
    page.drawText('CONTACT US', {
      x: marginLeft, y: yPos, size: 14, font: helveticaBold, color: accentColor,
    });
    yPos -= 30;

    const valueX = marginLeft + 80;
    const lineH = 22;
    for (const row of block.rows) {
      page.drawText(`${row.label.toUpperCase()}:`, {
        x: marginLeft, y: yPos, size: 9, font: helveticaBold, color: accentColor,
      });
      page.drawText(row.value, {
        x: valueX, y: yPos, size: 9, font: helveticaFont, color: inkColor,
      });
      yPos -= lineH;
    }
  }

  if (block.disclaimer.paragraphs.length) {
    const maxWidth = pageWidth - marginLeft * 2;
    const fontSize = disclaimerFontPt(disclaimer.font_size);
    const lh = fontSize * 1.5;
    const paragraphGap = fontSize * 0.8;

    const allWrapped: string[][] = [];
    let totalHeight = 0;

    for (const para of block.disclaimer.paragraphs) {
      const words = para.split(' ');
      let cur = '';
      const lines: string[] = [];
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (helveticaFont.widthOfTextAtSize(test, fontSize) > maxWidth && cur) {
          lines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      allWrapped.push(lines);
      totalHeight += lines.length * lh + paragraphGap;
    }

    const bottomMargin = 40;
    let dY = bottomMargin + totalHeight + 20;
    dY = Math.max(dY, Math.min(yPos - 40, 350));

    for (const lines of allWrapped) {
      for (const line of lines) {
        if (dY < bottomMargin) break;
        page.drawText(line, {
          x: marginLeft, y: dY, size: fontSize, font: helveticaFont, color: mutedColor,
        });
        dY -= lh;
      }
      dY -= paragraphGap;
    }
  }

  return page;
}
