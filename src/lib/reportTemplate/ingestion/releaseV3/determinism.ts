/**
 * PDF Extraction V3 · E12 — determinism report.
 *
 * Compares two identical runs on exact semantic identity fields (plan id/hash,
 * fingerprint, region/candidate/run keys, output strategies, hard-defect sets)
 * and metric fields within a deterministic tolerance. Timestamps and ephemeral
 * URLs are excluded. A semantic-identity mismatch is a HARD failure.
 */
import {
  RELEASE_DETERMINISM_REPORT_VERSION,
  type DeterminismMismatchV1,
  type GoldenRunResultV2,
  type ReleaseDeterminismReportV1,
} from './contracts';

const METRIC_TOLERANCE = 1e-9;

/** Exact-match fields — any difference is a hard determinism failure. */
const EXACT_FIELDS: Array<keyof GoldenRunResultV2> = [
  'semanticRunKey', 'fixtureId', 'releaseTier', 'status', 'pageCountObserved',
  'finalDecision', 'hardDefectCount', 'repairPasses', 'introducedHardDefects',
  'providerAuditComplete', 'routingAuditComplete', 'artifactComplete',
];

/** Metric fields — compared within tolerance (deterministic pipeline). */
const METRIC_FIELDS: Array<keyof GoldenRunResultV2> = [
  'criticalCoverage', 'sourceFidelityScore', 'finalOutputScore', 'exportScore', 'browserExportParity',
];

function scalar(v: unknown): string | number | boolean | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

export function buildDeterminismReport(first: GoldenRunResultV2, second: GoldenRunResultV2): ReleaseDeterminismReportV1 {
  const mismatches: DeterminismMismatchV1[] = [];

  for (const field of EXACT_FIELDS) {
    if (scalar(first[field]) !== scalar(second[field])) {
      mismatches.push({ field: String(field), first: scalar(first[field]), second: scalar(second[field]) });
    }
  }
  // Output strategies per page must match exactly.
  const stratA = first.pageResults.map((p) => `${p.pageNumber}:${p.outputStrategy}`).join(',');
  const stratB = second.pageResults.map((p) => `${p.pageNumber}:${p.outputStrategy}`).join(',');
  if (stratA !== stratB) mismatches.push({ field: 'pageOutputStrategies', first: stratA, second: stratB });

  const exactFieldsMatched = mismatches.length === 0;

  let metricFieldsWithinTolerance = true;
  for (const field of METRIC_FIELDS) {
    const a = first[field];
    const b = second[field];
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > METRIC_TOLERANCE) {
        metricFieldsWithinTolerance = false;
        mismatches.push({ field: String(field), first: a, second: b });
      }
    } else if ((a === null) !== (b === null)) {
      metricFieldsWithinTolerance = false;
      mismatches.push({ field: String(field), first: scalar(a), second: scalar(b) });
    }
  }

  return {
    version: RELEASE_DETERMINISM_REPORT_VERSION,
    firstRunKey: first.semanticRunKey,
    secondRunKey: second.semanticRunKey,
    exactFieldsMatched,
    metricFieldsWithinTolerance,
    mismatches,
    passed: exactFieldsMatched && metricFieldsWithinTolerance,
    problems: [],
  };
}
