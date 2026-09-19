/**
 * PDF Extraction V3 · E12 — performance report + policy.
 *
 * Performance failure is never hidden by fidelity success. There is one absolute
 * safety ceiling (timeout / memory) AND an environment-matched relative-regression
 * limit. A REQUIRED-but-missing baseline is `unavailable` → gate failure (never
 * fabricated). Baselines are environment-profile scoped so incompatible profiles
 * are never compared.
 */
import {
  RELEASE_PERFORMANCE_REPORT_VERSION,
  type PerformanceRegressionV1,
  type ReleaseBaselineV2,
  type ReleasePerformancePolicyV1,
  type ReleasePerformanceReportV1,
} from './contracts';

export interface PerformanceObservation {
  environmentProfileId: string;
  fixtureId: string;
  timings: Record<string, number | null>;
  peakMemoryBytes: number | null;
  pageThroughput: number | null;
  artifactBytes: number | null;
}

export function buildPerformanceReport(
  obs: PerformanceObservation,
  policy: ReleasePerformancePolicyV1,
  baseline: ReleaseBaselineV2 | null,
): ReleasePerformanceReportV1 {
  const regressions: PerformanceRegressionV1[] = [];
  const problems: string[] = [];

  // Baseline must match the same environment profile; otherwise it is unusable.
  const usableBaseline = baseline && baseline.environmentProfileId === obs.environmentProfileId ? baseline : null;
  if (baseline && !usableBaseline) problems.push('baseline_environment_mismatch');

  if (usableBaseline) {
    for (const [metric, range] of Object.entries(usableBaseline.performanceRanges)) {
      const observed = obs.timings[metric];
      if (typeof observed !== 'number') continue;
      if (typeof range.maximum === 'number' && observed > range.maximum) {
        regressions.push({ metric, observed, baselineMax: range.maximum, relativeRegression: null });
        continue;
      }
      const limit = range.relativeRegressionLimit ?? policy.defaultRelativeRegressionLimit;
      if (typeof range.maximum === 'number' && range.maximum > 0) {
        const rel = (observed - range.maximum) / range.maximum;
        if (rel > limit) regressions.push({ metric, observed, baselineMax: range.maximum, relativeRegression: rel });
      }
    }
  }

  let passed: boolean | null;
  if (policy.requireBaseline && !usableBaseline) {
    passed = null; // unavailable required baseline → caller maps to gate failure
    problems.push('required_baseline_unavailable');
  } else {
    passed = regressions.length === 0;
  }

  return {
    version: RELEASE_PERFORMANCE_REPORT_VERSION,
    environmentProfileId: obs.environmentProfileId,
    fixtureId: obs.fixtureId,
    timings: obs.timings,
    peakMemoryBytes: obs.peakMemoryBytes,
    pageThroughput: obs.pageThroughput,
    artifactBytes: obs.artifactBytes,
    baselineComparison: { available: Boolean(usableBaseline), regressions },
    passed,
    problems,
  };
}

/** The absolute safety ceiling check: over-budget total or missing baseline is a fail. */
export function withinAbsoluteCeiling(totalMs: number | null, policy: ReleasePerformancePolicyV1): boolean {
  if (typeof totalMs !== 'number') return true;
  return totalMs <= policy.absoluteSuiteCeilingMs;
}
