/**
 * Disclaimer block — first reference block.
 *
 * Ports the existing `drawJsPDFDisclaimerPage` (src/utils/pdfDisclaimerPage.ts)
 * onto a fresh page using the template's resolved tokens & data.
 *
 * Block props (resolved via bindings before reaching here):
 *   {
 *     companyName: string,
 *     website?, email?, phone?, address?, abn?: string,
 *     disclaimerText?: string,
 *     fontSize?: 'small' | 'medium' | 'large',
 *     showOnNewPage?: boolean   // default true
 *   }
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';

const GOLD = { r: 191, g: 155, b: 80 };
const GRAY = { r: 153, g: 153, b: 153 };
const BG = { r: 20, g: 20, b: 20 };

function sanitise(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
      '',
    )
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '');
}

export function drawDisclaimerBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const props = block.props as Record<string, unknown>;

  const margin = 20;
  const pageWidth = page.width;
  const pageHeight = page.height;

  doc.setFillColor(BG.r, BG.g, BG.b);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Company name
  const companyName = resolveBindable(props.companyName ?? 'Property Consulting', ctx).toUpperCase();
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  const parts = companyName.split(' ');
  if (parts.length >= 2) {
    doc.text(parts.slice(0, -1).join(' '), margin, 40);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text(parts[parts.length - 1], margin, 52);
  } else {
    doc.text(parts[0], margin, 40);
  }

  // CONTACT US heading
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
  doc.text('CONTACT US', margin, 80);

  // Contact rows
  const labelX = margin;
  const valueX = margin + 35;
  let y = 100;
  const lineH = 12;

  const drawLine = (label: string, raw: unknown) => {
    const value = resolveBindable(raw, ctx);
    if (!value) return;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
    doc.text(`${label.toUpperCase()}:`, labelX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, valueX, y);
    y += lineH;
  };

  drawLine('Website', props.website);
  drawLine('Email', props.email);
  drawLine('Phone', props.phone);
  drawLine('Address', props.address);
  drawLine('ABN', props.abn);

  // Disclaimer text — the deployment's own, falling back to the template's.
  // Kept in step with `disclaimer.html.ts`, which is what production prints;
  // this one draws the editor's canvas preview and must not disagree with it.
  const text = resolveBindable(props.disclaimerText, ctx)
    || resolveBindable(props.disclaimerFallback ?? '', ctx);
  if (text) {
    const sizeToken = resolveBindable(props.fontSize ?? '', ctx)
      || resolveBindable(props.fontSizeFallback ?? '', ctx);
    const fontSize = sizeToken === 'medium' ? 10 : sizeToken === 'large' ? 12 : 8.5;
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
    const cleaned = sanitise(text);
    const maxW = pageWidth - margin * 1.5;
    const wrapped: string[] = doc.splitTextToSize(cleaned, maxW);
    const lh = fontSize * 0.5;
    const startY = pageHeight - 20 - wrapped.length * lh;
    doc.text(wrapped, margin * 0.75, Math.max(startY, y + 20), { lineHeightFactor: 1.4 });
  }
}
