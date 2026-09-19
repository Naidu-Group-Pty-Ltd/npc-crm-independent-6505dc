/**
 * E7 — runtime validators for the persisted V2 contracts.
 *
 * Reject anything that would let an unsafe report masquerade as verified:
 * wrong versions, non-finite/out-of-range metrics, an accepted decision that
 * still carries an unresolved hard defect, a `complete` report with unscored
 * critical pages, a mixed/raster decision without the matching evidence, a
 * signed URL or a raw image buffer in a persisted shape. V1 reports stay
 * readable as legacy — but are never treated as V2-complete.
 */
import {
  VISUAL_QUALITY_REPORT_V2_VERSION, VISUAL_METRICS_V2_VERSION,
  type VisualPageQualityReportV2, type VisualImportQualityReportV2, type VisualPageMetricsV2, type MetricKeyV2,
} from './contracts';
import { hasUnresolvedHardDefect } from './criticalDefects';

const SIGNED_URL_RE = /^(https?|blob|data):/i;

const ACCEPTED_ACTIONS = new Set(['accept-native', 'accept-native-with-review', 'accept-mixed', 'accept-mixed-with-review', 'accept-page-raster']);
const AUTO_NATIVE_MIXED = new Set(['accept-native', 'accept-native-with-review', 'accept-mixed', 'accept-mixed-with-review']);

export function validateVisualPageReportV2(report: unknown): string[] {
  const problems: string[] = [];
  if (!report || typeof report !== 'object') return ['quality_evidence_invalid'];
  const p = report as VisualPageQualityReportV2;
  if (p.version !== VISUAL_QUALITY_REPORT_V2_VERSION) problems.push('quality_evidence_invalid');
  if (p.overallScore != null && !inRange(p.overallScore)) problems.push('score_out_of_range');
  if (!Number.isFinite(p.metricCoverage) || p.metricCoverage < 0 || p.metricCoverage > 1) problems.push('coverage_out_of_range');
  problems.push(...validateMetricsV2(p.metrics));
  // accepted native/mixed decision must not carry an unresolved hard defect.
  if (AUTO_NATIVE_MIXED.has(p.recommendedAction) && hasUnresolvedHardDefect(p.criticalDefects)) problems.push('accepted_with_unresolved_hard_defect');
  // raster acceptance requires a raster strategy.
  if (p.recommendedAction === 'accept-page-raster' && p.outputStrategy !== 'raster-only') problems.push('raster_decision_without_raster_strategy');
  // mixed acceptance requires the mixed strategy + a plan hash (region evidence).
  if ((p.recommendedAction === 'accept-mixed' || p.recommendedAction === 'accept-mixed-with-review') && (p.outputStrategy !== 'mixed' || !p.renderPlanHash)) problems.push('mixed_decision_without_region_evidence');
  // signed URLs / image buffers must not appear anywhere in a persisted report.
  problems.push(...scanForbidden(p));
  return dedupe(problems);
}

export function validateMetricsV2(metrics: unknown): string[] {
  const problems: string[] = [];
  if (!metrics || typeof metrics !== 'object') return ['metrics_invalid'];
  const m = metrics as VisualPageMetricsV2;
  if (m.version !== VISUAL_METRICS_V2_VERSION) problems.push('metrics_version_invalid');
  for (const key of Object.keys(m) as Array<keyof VisualPageMetricsV2>) {
    if (key === 'version') continue;
    const v = m[key as MetricKeyV2];
    if (v == null) continue; // null = not measured (allowed)
    if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`metric_non_finite:${key}`); continue; }
    if (v < 0 || v > 1) problems.push(`metric_out_of_range:${key}`);
  }
  return problems;
}

export function validateVisualImportReportV2(report: unknown): string[] {
  const problems: string[] = [];
  if (!report || typeof report !== 'object') return ['quality_evidence_invalid'];
  const r = report as VisualImportQualityReportV2;
  if (r.version !== VISUAL_QUALITY_REPORT_V2_VERSION) problems.push('quality_evidence_invalid');
  // duplicate page numbers.
  const seen = new Set<number>();
  for (const page of r.pages ?? []) {
    if (seen.has(page.pageNumber)) problems.push('duplicate_page_number');
    seen.add(page.pageNumber);
    problems.push(...validateVisualPageReportV2(page).map((x) => `page_${page.pageNumber}:${x}`));
  }
  // a complete report cannot leave a critical page unscored.
  if (r.coverage === 'complete' && r.pagesUnscored > 0) problems.push('complete_report_with_unscored_pages');
  if (r.documentScore != null && !inRange(r.documentScore)) problems.push('document_score_out_of_range');
  problems.push(...scanForbidden(r, ['artifactPaths']));
  return dedupe(problems);
}

/** Scan a persisted shape for signed URLs / raw image buffers (bounded depth). */
function scanForbidden(value: unknown, skipKeys: string[] = [], depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  const problems: string[] = [];
  if (typeof value === 'string') {
    if (SIGNED_URL_RE.test(value)) problems.push('signed_url_persisted');
    return problems;
  }
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) {
    return ['raw_image_buffer_persisted'];
  }
  if (Array.isArray(value)) { for (const v of value) problems.push(...scanForbidden(v, skipKeys, depth + 1)); return problems; }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('data' in obj && 'width' in obj && 'height' in obj && (obj.data instanceof Uint8ClampedArray || Array.isArray(obj.data))) {
      // looks like ImageData — never persist it.
      return ['raw_image_buffer_persisted'];
    }
    for (const [k, v] of Object.entries(obj)) {
      if (skipKeys.includes(k)) continue; // durable manifest paths are allowed here
      problems.push(...scanForbidden(v, skipKeys, depth + 1));
    }
  }
  return problems;
}

function inRange(n: number): boolean { return Number.isFinite(n) && n >= 0 && n <= 1; }
function dedupe(a: string[]): string[] { return [...new Set(a)]; }
export { ACCEPTED_ACTIONS };
