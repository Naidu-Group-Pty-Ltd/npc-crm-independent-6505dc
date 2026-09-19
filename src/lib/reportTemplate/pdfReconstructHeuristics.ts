/**
 * Heuristics for choosing the PDF reconstruction strategy (plan §7a).
 *
 * Deterministic `extractPdfViaDocling` is ideal for digital PDFs, but a *scanned*
 * (image-only) PDF extracts almost no live text. These pure helpers detect that
 * "thin" case so the UI can recommend routing the PDF straight to Claude (which
 * reads PDFs natively) instead of producing an empty template.
 */
import type { ReportTemplate } from './templateSchema';

/** Count non-empty text overlays across the whole template. */
export function countTextOverlays(template: ReportTemplate): number {
  let n = 0;
  for (const page of template.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const o of block.overlays ?? []) {
        if ((o as any)?.type === 'text' && String((o as any).content ?? '').trim()) n++;
      }
    }
  }
  return n;
}

/**
 * A reconstruction is "thin" when it has fewer than `minPerPage` text overlays
 * per page — a strong signal of a scanned/image-only PDF that would reconstruct
 * better by sending the document to Claude.
 */
export function isThinExtraction(template: ReportTemplate, opts: { minPerPage?: number } = {}): boolean {
  const pages = Math.max(1, template.pages?.length ?? 1);
  const min = opts.minPerPage ?? 3;
  return countTextOverlays(template) < pages * min;
}
