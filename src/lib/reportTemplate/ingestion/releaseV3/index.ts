/**
 * PDF Extraction V3 · E12 — Golden Corpus & Release Gate barrel.
 *
 * The single import surface for the release-certification layer: versioned
 * contracts, strict gate policy + thresholds, the hard-defect-first evaluator,
 * generated corpus registry + fixture families + independent expected truth +
 * deterministic source-PDF builders, assertion engines, determinism/performance/
 * baseline/artifact-manifest/readiness reports, validators and redaction.
 */
export * from './contracts';
export * from './redaction';
export * from './gatePolicy';
export * from './gateEvaluator';
export * from './validators';
export * from './determinism';
export * from './performance';
export * from './baseline';
export * from './artifactManifest';
export * from './readiness';
export * from './expectedTruth';
export * from './fixtureFamilies';
export * from './registryV2';
export * from './privateRegistry';
export * from './assertions';
export * from './contractMatrix';
