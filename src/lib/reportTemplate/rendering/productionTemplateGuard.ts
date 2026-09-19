/**
 * Can this template safely render *somebody else's* report?
 *
 * ## The failure this exists to stop
 *
 * A template called "Investment Compass — WeasyPrint Pilot" was imported from
 * one client's finished PDF. The importer reconstructed all 61 pages as
 * absolutely positioned text overlays — 3,452 of them — and **not one carried
 * a binding**. Every string was a literal lifted from that client's document:
 *
 *     { "content": "Lot 60941 Cloverton,", "x": 51.02, "y": 605.96 }
 *
 * It was then marked `is_active`, `is_default`, `scope: global`,
 * `tier: compass`, and `engine: weasyprint`, which made it the template
 * `resolveReportTemplate` handed to every Compass investment report. For two
 * months, each of those reports rendered Lot 60941 Cloverton's analysis with
 * the requesting client's address substituted into the PDF title and filename
 * and nowhere else. A client who asked about a house in Muswellbrook received
 * 61 pages about a lot in Kalkallo.
 *
 * Nothing detected it, because nothing was wrong in the sense the system knew
 * how to check: the template parsed, resolved, rendered and uploaded cleanly.
 * A document that is *entirely* static is indistinguishable from a correct one
 * unless you ask the question this module asks.
 *
 * ## The rule
 *
 * A template that carries a PDF-import source raster and contains no binding
 * anywhere is a reconstruction of one document, not a template. It may be
 * edited, previewed and proofed in the builder — that is what it is for — but
 * it must never be selected to render a report about a different subject.
 *
 * Deliberately narrow. A template with even one binding is somebody's work in
 * progress and is left alone; a hand-built template with no import raster is
 * not touched either, because a genuinely static page (a fixed terms-and-
 * conditions sheet, say) is a legitimate thing to have. Only the intersection
 * is refused, because only the intersection is certainly a copy.
 */
import { isPdfImportSourceRaster } from './pdfImportPagePolicy';

/** Why a template may not serve a production render, or `null` if it may. */
export type ProductionTemplateRefusal = {
  code: 'unbound-pdf-import-reconstruction';
  reason: string;
};

/** `resolveBindable` treats `{{…}}` as the binding syntax and nothing else. */
const BINDING_TOKEN = '{{';

function hasAnyBinding(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === 'string') return value.includes(BINDING_TOKEN);
  if (Array.isArray(value)) return value.some((v) => hasAnyBinding(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .some((v) => hasAnyBinding(v, depth + 1));
  }
  return false;
}

/**
 * Refuse a template that is a static copy of one report.
 *
 * Returns `null` when the template may render production output. Pure; takes
 * the parsed template (or the raw schema — it only walks values).
 */
export function refuseUnboundReconstruction(
  template: unknown,
): ProductionTemplateRefusal | null {
  const pages = (template as { pages?: unknown[] } | null)?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;

  const importPages = pages.filter((p) => isPdfImportSourceRaster(p as never));
  if (importPages.length === 0) return null;

  // The whole template, not just the raster pages: one bound field anywhere is
  // enough to say a person is building something rather than storing a copy.
  if (hasAnyBinding(template)) return null;

  return {
    code: 'unbound-pdf-import-reconstruction',
    reason:
      `template is a PDF-import reconstruction of a single document `
      + `(${importPages.length} of ${pages.length} pages carry a source raster) `
      + `and contains no data bindings, so every report rendered from it would `
      + `print the original document's content`,
  };
}
