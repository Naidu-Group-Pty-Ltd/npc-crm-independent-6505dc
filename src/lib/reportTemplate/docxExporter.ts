/**
 * docxExporter — best-effort DOCX export of a ReportTemplate.
 * Each page becomes a section with its text overlays rendered as paragraphs,
 * sorted top-to-bottom then left-to-right. Shapes/images are omitted from
 * structured content; they survive in the PDF/HTML pipelines.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
} from 'docx';
import { renderTemplateToHtml } from './htmlRenderer';
import { parseTemplate, type ReportTemplate } from './templateSchema';
import { resolveBindable, resolveBindableNumber, type ResolveContext } from './bindingResolver';

interface DocxOptions {
  data?: Record<string, any>;
  title?: string;
}

function flattenPageText(page: any, ctx: ResolveContext): Array<{ y: number; x: number; text: string; size: number; bold: boolean; align: (typeof AlignmentType)[keyof typeof AlignmentType] }> {
  const items: any[] = [];
  for (const block of page.blocks ?? []) {
    for (const ov of block.overlays ?? []) {
      if (ov.type !== 'text') continue;
      const text = resolveBindable(ov.content, ctx);
      if (!text) continue;
      const size = Math.round(resolveBindableNumber(ov.fontSize, ctx, 12) * 2); // docx half-points
      const align =
        ov.align === 'center' ? AlignmentType.CENTER :
        ov.align === 'right'  ? AlignmentType.RIGHT  : AlignmentType.LEFT;
      items.push({
        y: ov.y, x: ov.x, text: String(text),
        size, bold: ov.fontWeight === 'bold', align,
      });
    }
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  return items;
}

export async function exportTemplateAsDocxBlob(
  raw: ReportTemplate | unknown,
  opts: DocxOptions = {},
): Promise<Blob> {
  const tpl = parseTemplate(raw);
  const ctx: ResolveContext = { data: opts.data ?? {}, tokens: tpl.tokens };
  const children: Paragraph[] = [];

  tpl.pages.forEach((page, idx) => {
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: page.name || `Page ${idx + 1}`, bold: true })],
    }));
    for (const item of flattenPageText(page, ctx)) {
      children.push(new Paragraph({
        alignment: item.align,
        children: [new TextRun({ text: item.text, size: item.size, bold: item.bold })],
      }));
    }
  });

  const doc = new Document({
    creator: 'Template Builder',
    title: opts.title ?? 'Report',
    sections: [{ children }],
  });
  return await Packer.toBlob(doc);
}

export async function downloadTemplateAsDocx(
  template: ReportTemplate,
  filename: string,
  opts: DocxOptions = {},
): Promise<void> {
  const blob = await exportTemplateAsDocxBlob(template, opts);
  triggerDownload(blob, filename.endsWith('.docx') ? filename : `${filename}.docx`);
}

// kept for parity with htmlExporter signature
export function previewTemplateAsHtmlString(template: ReportTemplate, opts: DocxOptions = {}): string {
  const { html } = renderTemplateToHtml(template, { data: opts.data ?? {}, title: opts.title ?? 'Report' });
  return html;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
