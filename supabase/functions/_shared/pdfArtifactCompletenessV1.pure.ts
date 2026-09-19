/**
 * PDF Extraction V3 · E10 — artifact completeness (pdf-artifact-completeness-v1).
 *
 * A V3 cache hit — and a finalized V3 run — must be ARTIFACT-COMPLETE: every page
 * the plan promised must have its required artifact set present as DURABLE object
 * references (never signed URLs). An incomplete report is a hard MISS /
 * not-finalizable, never a partial success. A signed URL where a durable ref
 * belongs is a completeness FAILURE and a leak, not a pass.
 *
 * Byte-identical with the Python `planner_v3.completeness` producer for ASCII.
 */
import {
  PDF_ARTIFACT_COMPLETENESS_VERSION,
  SERVICE_CLASS_RASTER_ONLY,
  type PdfPageComplexityV1,
  type ServiceClass,
  type ServiceRouteDecisionV1,
  isDurableRef,
  stableHash,
} from './pdfServiceRoutingV1.pure.ts';

/** The artifact keys a given page must have present to be complete. */
export function requiredArtifactsForPage(page: PdfPageComplexityV1, resolvedClass: ServiceClass): string[] {
  if (resolvedClass === SERVICE_CLASS_RASTER_ONLY || page.tier === 'unreadable') return ['raster'];
  const required = new Set<string>(['raster', 'docling', 'blocks']);
  if (page.requires_ocr) required.add('ocr');
  if (page.requires_tables) required.add('tables');
  return Array.from(required).sort();
}

function resolvedClassByPage(decisions: ServiceRouteDecisionV1[]): Map<number, ServiceClass> {
  const map = new Map<number, ServiceClass>();
  for (const r of decisions) for (const p of r.page_numbers) map.set(p, r.resolved_class);
  return map;
}

export interface ArtifactCompletenessReport {
  version: typeof PDF_ARTIFACT_COMPLETENESS_VERSION;
  complete: boolean;
  checked_pages: number;
  expected_pages: number;
  missing: Array<{ page_number: number; missing: string[] }>;
  signed_url_leak_pages: number[];
  report_id: string;
}

/** Compute the deterministic completeness report the cache + finalizer consult. */
export function evaluateArtifactCompleteness(
  pageClassifications: PdfPageComplexityV1[],
  routeDecisions: ServiceRouteDecisionV1[],
  presentArtifactsByPage: Record<number, Record<string, unknown>>,
): ArtifactCompletenessReport {
  const classByPage = resolvedClassByPage(routeDecisions);
  const missing: Array<{ page_number: number; missing: string[] }> = [];
  const signedUrlLeaks: number[] = [];
  let checkedPages = 0;

  const ordered = [...pageClassifications].sort((a, b) => a.page_number - b.page_number);
  for (const page of ordered) {
    checkedPages += 1;
    const resolvedClass = classByPage.get(page.page_number) ?? SERVICE_CLASS_RASTER_ONLY;
    const required = requiredArtifactsForPage(page, resolvedClass);
    const present = presentArtifactsByPage[page.page_number] ?? {};
    const missingKeys: string[] = [];
    for (const key of required) {
      const ref = present[key];
      if (ref === undefined || ref === null || ref === '') {
        missingKeys.push(key);
      } else if (!isDurableRef(ref)) {
        missingKeys.push(key);
        if (!signedUrlLeaks.includes(page.page_number)) signedUrlLeaks.push(page.page_number);
      }
    }
    if (missingKeys.length > 0) missing.push({ page_number: page.page_number, missing: missingKeys.sort() });
  }

  const complete = missing.length === 0 && checkedPages === pageClassifications.length && checkedPages > 0;
  const base = {
    version: PDF_ARTIFACT_COMPLETENESS_VERSION,
    complete,
    checked_pages: checkedPages,
    expected_pages: pageClassifications.length,
    missing,
    signed_url_leak_pages: [...signedUrlLeaks].sort((a, b) => a - b),
  };
  return { ...base, report_id: stableHash('acmp', base) };
}
