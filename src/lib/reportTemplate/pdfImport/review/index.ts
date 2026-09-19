/**
 * PDF Extraction V3 · E11 — Review Workspace & Diagnostics pure module barrel.
 *
 * The single import surface for the review view-model layer: versioned contracts,
 * the authority-consuming builders (document/page/region/diagnostics), the action
 * contracts, bounded artifact selection, client-side capability derivation, and
 * persisted-model validators. Everything here is pure and privacy-safe — no
 * signed URL, private path or raw buffer ever enters a model.
 */
export * from './contracts';
export * from './authority';
export * from './buildRegionReviewModel';
export * from './buildPageReviewModel';
export * from './buildDocumentReviewModel';
export * from './buildDiagnosticsSummary';
export * from './reviewActions';
export * from './artifactSelection';
export * from './permissions';
export * from './validators';
