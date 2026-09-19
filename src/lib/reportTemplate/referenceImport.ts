/**
 * Helpers for the unified "Start from a reference" import flow (rehaul Phase 3).
 *
 * Pure + unit-tested so the file-type routing and the pre-apply schema
 * validation (the Phase 3 acceptance item) are verifiable without the network.
 */
import { parseTemplate, type ReportTemplate } from './templateSchema';

export type ReferenceKind = 'pdf' | 'image' | 'unsupported';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;

/** Route a dropped/selected file to the PDF pipeline or the AI vision pipeline. */
export function detectReferenceKind(file: { name?: string; type?: string } | null | undefined): ReferenceKind {
  if (!file) return 'unsupported';
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  return 'unsupported';
}

export interface SchemaValidation {
  ok: boolean;
  pageCount: number;
  errors: string[];
}

/**
 * Validate a reconstructed schema BEFORE applying it to the editor, so a broken
 * AI/PDF result can't corrupt the working template. Uses the tolerant
 * `parseTemplate` (which salvages older/AI-authored shapes) and then asserts the
 * result is actually usable (has at least one well-formed page).
 */
export function validateReconstructedSchema(raw: unknown): SchemaValidation {
  let parsed: ReportTemplate;
  try {
    parsed = parseTemplate(raw);
  } catch (e) {
    return { ok: false, pageCount: 0, errors: [`Schema could not be parsed: ${(e as Error)?.message ?? 'unknown error'}`] };
  }
  const errors: string[] = [];
  const pages = Array.isArray((parsed as any).pages) ? (parsed as any).pages : [];
  if (pages.length === 0) errors.push('Reconstruction produced no pages.');
  pages.forEach((p: any, i: number) => {
    if (!p || !Array.isArray(p.blocks)) errors.push(`Page ${i + 1} is malformed (missing blocks).`);
  });
  return { ok: errors.length === 0, pageCount: pages.length, errors };
}

/** Human label for each PDF fidelity mode (shared by the import UI). */
export function describeFidelityMode(mode: string): string {
  switch (mode) {
    case 'semantic': return 'Editable text overlays only (no raster background).';
    case 'hybrid': return 'Raster backdrop + editable text overlays (recommended).';
    case 'pixel': return 'High-DPI rasterised page as a background image.';
    case 'ocr': return 'Run OCR on a scanned PDF to recover text.';
    default: return '';
  }
}

/** Read a File as a base64 data URL (for sending images to the AI reconstructor). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
