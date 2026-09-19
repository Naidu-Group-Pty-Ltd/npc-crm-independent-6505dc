/**
 * PDF Extraction V3 · E11 — pure diagnostics-summary builder (admin list rows).
 *
 * A bounded, privacy-safe list projection derived from the SAME authoritative
 * document model. The list never hydrates images and never contains source text,
 * endpoint URLs, credentials or private paths — only safe aggregate state.
 */
import {
  PDF_DIAGNOSTICS_VIEW_MODEL_VERSION,
  type PdfDiagnosticsSummaryV1,
  type PdfDocumentReviewModelV1,
} from './contracts';

export function buildDiagnosticsSummary(doc: PdfDocumentReviewModelV1): PdfDiagnosticsSummaryV1 {
  const cacheState = doc.cache.lookupState
    ?? (doc.cache.hit === true ? (doc.cache.complete === true ? 'hit-complete' : 'hit-incomplete') : doc.cache.hit === false ? 'miss' : null);
  return {
    version: PDF_DIAGNOSTICS_VIEW_MODEL_VERSION,
    importId: doc.importId,
    jobId: doc.jobId,
    displayName: doc.source.displayName,
    status: doc.lifecycle.status,
    createdAt: doc.lifecycle.createdAt,
    completedAt: doc.lifecycle.completedAt,
    pageCount: doc.source.pageCount,
    documentComplexity: doc.plan.documentComplexity,
    finalDecision: doc.output.finalDecision,
    hardDefectCount: doc.quality.hardDefectCount,
    manualReviewRequired: doc.review.manualReviewRequired,
    serviceClassSummary: doc.routing.serviceClasses,
    providerAttemptCount: doc.extraction.providerAttemptCount,
    cacheState,
    artifactCompleteness: doc.extraction.artifactCompleteness,
    recoveryActive: doc.problems.includes('recovery-active'),
    durationMs: doc.lifecycle.durationMs,
    estimatedCostState: doc.costPerformance.estimateState,
    legacyState: doc.legacyState,
    remoteAttempted: doc.routing.remotePageCount > 0,
  };
}
