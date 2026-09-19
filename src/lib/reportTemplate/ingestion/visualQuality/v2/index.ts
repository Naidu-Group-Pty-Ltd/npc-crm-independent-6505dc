/**
 * PDF Extraction V3 · E7 — Quality Gate V2 barrel.
 *
 * Hard-defect-first visual quality evaluation of the ACTUAL composed output.
 * All pure + deterministic + JSON-safe. Runtime capture/rasterize/export
 * adapters feed the pure gate; nothing here does DOM/network I/O.
 */
export * from './contracts';
export * from './criticalDefects';
export * from './domEvidence';
export * from './imageMetricsV2';
export * from './regionMetrics';
export * from './structuralValidation';
export * from './scoreV2';
export * from './decisionV2';
export * from './exportEvidence';
export * from './validators';
export * from './qualityGateV2';
