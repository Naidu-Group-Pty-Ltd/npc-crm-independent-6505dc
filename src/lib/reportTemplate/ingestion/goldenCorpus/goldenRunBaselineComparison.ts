/**
 * goldenRunBaselineComparison — Phase 9C.
 *
 * Pure comparison of a current golden run against the previous baseline run for
 * the same corpus. Detects quality-gate / operator-decision regressions (via
 * ordinal ranks) and per-metric score regressions within a score-drop tolerance,
 * then resolves an overall outcome. No I/O.
 */
import {
  GOLDEN_RUN_HISTORY_VERSION,
  type GoldenRunBaselineComparison,
  type GoldenRunBaselineComparisonOptions,
  type GoldenRunBaselineComparisonOutcome,
  type GoldenRunHistoryRecord,
  type GoldenRunMetricComparison,
  type GoldenRunMetricComparisonDirection,
  type GoldenRunStatusComparison,
} from './goldenRunHistoryTypes';

export const DEFAULT_GOLDEN_RUN_SCORE_DROP_TOLERANCE = 0.02;

/** Quality-gate rank — higher is better. */
export function rankQualityGateStatus(status: string | null): number | null {
  switch (status) {
    case 'blocked': return 0;
    case 'fail': return 1;
    case 'not_evaluated': return 2;
    case 'warning': return 3;
    case 'pass': return 4;
    default: return null;
  }
}

/** Operator-decision rank — higher is better. */
export function rankOperatorDecision(decision: string | null): number | null {
  switch (decision) {
    case 'rejected': return 0;
    case 'needs_rerun': return 1;
    case 'not_reviewed': return 2;
    case 'accepted_with_warnings': return 3;
    case 'accepted': return 4;
    default: return null;
  }
}

function toNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Compare a single metric (higher is better) within a score-drop tolerance.
 * `direction` reflects raw movement; `outcome` is the tolerance-adjusted verdict.
 */
export function compareGoldenRunMetric(options: {
  metric: string;
  previous: number | null;
  current: number | null;
  tolerance?: number;
}): GoldenRunMetricComparison {
  const metric = options.metric;
  const previous = toNumberOrNull(options.previous);
  const current = toNumberOrNull(options.current);
  const tolerance = typeof options.tolerance === 'number' && Number.isFinite(options.tolerance)
    ? Math.abs(options.tolerance)
    : DEFAULT_GOLDEN_RUN_SCORE_DROP_TOLERANCE;

  let direction: GoldenRunMetricComparisonDirection = 'unknown';
  let outcome: GoldenRunBaselineComparisonOutcome = 'unknown';
  let delta: number | null = null;
  let message: string;

  if (previous === null && current !== null) {
    outcome = 'no_baseline';
    message = `No baseline for ${metric}.`;
  } else if (previous === null || current === null) {
    outcome = 'unknown';
    message = `${metric} not comparable.`;
  } else {
    delta = current - previous;
    direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    if (delta > tolerance) {
      outcome = 'improved';
      message = `${metric} improved by ${delta.toFixed(4)}.`;
    } else if (delta < -tolerance) {
      outcome = 'degraded';
      message = `${metric} degraded by ${Math.abs(delta).toFixed(4)}.`;
    } else {
      outcome = 'stable';
      message = `${metric} stable (delta ${delta.toFixed(4)}).`;
    }
  }

  return { metric, previous, current, delta, direction, tolerance, outcome, message };
}

/** Compare two ranked statuses (higher rank is better). */
export function compareGoldenRunStatus(options: {
  previous: string | null;
  current: string | null;
  ranker?: (status: string | null) => number | null;
}): GoldenRunStatusComparison {
  const { previous, current } = options;
  const ranker = options.ranker ?? (() => null);

  const base = (outcome: GoldenRunBaselineComparisonOutcome, message: string): GoldenRunStatusComparison =>
    ({ previous: previous ?? null, current: current ?? null, outcome, message });

  if (!previous && !current) return base('unknown', 'No status to compare.');
  if (!previous && current) return base('no_baseline', 'No previous status to compare against.');
  if (previous && !current) return base('unknown', 'Current status missing.');

  const prevRank = ranker(previous);
  const currRank = ranker(current);

  if (prevRank === null || currRank === null) {
    return previous === current
      ? base('stable', `Status unchanged: ${current}.`)
      : base('unknown', `Status changed but not rankable: ${previous} -> ${current}.`);
  }

  if (currRank > prevRank) return base('improved', `Status improved: ${previous} -> ${current}.`);
  if (currRank < prevRank) return base('degraded', `Status degraded: ${previous} -> ${current}.`);
  return base('stable', `Status unchanged: ${current}.`);
}

/** Resolve the overall outcome from the individual comparison signals. */
export function resolveGoldenRunComparisonOutcome(inputs: {
  qualityGateOutcome: GoldenRunBaselineComparisonOutcome;
  operatorDecisionOutcome: GoldenRunBaselineComparisonOutcome;
  metricOutcomes: GoldenRunBaselineComparisonOutcome[];
  warningCountDelta: number | null;
  failureCountDelta: number | null;
}): GoldenRunBaselineComparisonOutcome {
  const { qualityGateOutcome, operatorDecisionOutcome, metricOutcomes } = inputs;
  const warningCountDelta = inputs.warningCountDelta ?? 0;
  const failureCountDelta = inputs.failureCountDelta ?? 0;

  const degraded =
    qualityGateOutcome === 'degraded' ||
    operatorDecisionOutcome === 'degraded' ||
    metricOutcomes.some((o) => o === 'degraded') ||
    failureCountDelta > 0 ||
    warningCountDelta > 2;
  if (degraded) return 'degraded';

  const improved =
    qualityGateOutcome === 'improved' ||
    operatorDecisionOutcome === 'improved' ||
    metricOutcomes.some((o) => o === 'improved') ||
    failureCountDelta < 0 ||
    warningCountDelta < 0;
  if (improved) return 'improved';

  const comparable = [qualityGateOutcome, operatorDecisionOutcome, ...metricOutcomes]
    .some((o) => o === 'stable' || o === 'improved' || o === 'degraded');
  if (comparable) return 'stable';

  return 'unknown';
}

const METRICS: Array<{ metric: string; key: keyof GoldenRunHistoryRecord }> = [
  { metric: 'visualQaScore', key: 'visualQaScore' },
  { metric: 'repairFinalScore', key: 'repairFinalScore' },
  { metric: 'exportVsSourceScore', key: 'exportVsSourceScore' },
  { metric: 'editorVsSourceScore', key: 'editorVsSourceScore' },
  { metric: 'exportVsEditorScore', key: 'exportVsEditorScore' },
];

/**
 * Compare a current run to its previous baseline. When `previous` is null the
 * outcome is `no_baseline`.
 */
export function compareGoldenRunToBaseline(
  options: GoldenRunBaselineComparisonOptions,
): GoldenRunBaselineComparison {
  const { previous, current } = options;
  const now = options.now ?? (() => new Date());
  const comparedAt = now().toISOString();
  const tolerance = typeof options.scoreDropTolerance === 'number' && Number.isFinite(options.scoreDropTolerance)
    ? Math.abs(options.scoreDropTolerance)
    : DEFAULT_GOLDEN_RUN_SCORE_DROP_TOLERANCE;

  if (!previous) {
    const noBaselineStatus = (currentValue: string | null): GoldenRunStatusComparison => ({
      previous: null,
      current: currentValue,
      outcome: 'no_baseline',
      message: 'No previous baseline to compare against.',
    });
    return {
      version: GOLDEN_RUN_HISTORY_VERSION,
      corpusId: current.corpusId,
      previousHistoryId: null,
      previousRunId: null,
      currentRunId: current.runId,
      outcome: 'no_baseline',
      qualityGateStatus: noBaselineStatus(current.qualityGateStatus),
      operatorDecision: noBaselineStatus(current.operatorDecision),
      metrics: METRICS.map(({ metric, key }) =>
        compareGoldenRunMetric({ metric, previous: null, current: (current[key] as number | null) ?? null, tolerance })),
      warningCountDelta: null,
      failureCountDelta: null,
      messages: [`No previous baseline found for corpusId ${current.corpusId}.`],
      comparedAt,
    };
  }

  const qualityGateStatus = compareGoldenRunStatus({
    previous: previous.qualityGateStatus,
    current: current.qualityGateStatus,
    ranker: rankQualityGateStatus,
  });
  const operatorDecision = compareGoldenRunStatus({
    previous: previous.operatorDecision,
    current: current.operatorDecision,
    ranker: rankOperatorDecision,
  });
  const metrics = METRICS.map(({ metric, key }) =>
    compareGoldenRunMetric({
      metric,
      previous: (previous[key] as number | null) ?? null,
      current: (current[key] as number | null) ?? null,
      tolerance,
    }));

  const warningCountDelta = (current.warningCount ?? 0) - (previous.warningCount ?? 0);
  const failureCountDelta = (current.failureCount ?? 0) - (previous.failureCount ?? 0);

  const outcome = resolveGoldenRunComparisonOutcome({
    qualityGateOutcome: qualityGateStatus.outcome,
    operatorDecisionOutcome: operatorDecision.outcome,
    metricOutcomes: metrics.map((m) => m.outcome),
    warningCountDelta,
    failureCountDelta,
  });

  const messages: string[] = [];
  if (qualityGateStatus.outcome === 'degraded' || qualityGateStatus.outcome === 'improved') {
    messages.push(qualityGateStatus.message);
  }
  if (operatorDecision.outcome === 'degraded' || operatorDecision.outcome === 'improved') {
    messages.push(operatorDecision.message);
  }
  for (const m of metrics) {
    if (m.outcome === 'degraded' || m.outcome === 'improved') messages.push(m.message);
  }
  if (failureCountDelta > 0) messages.push(`Failure count increased by ${failureCountDelta}.`);
  else if (failureCountDelta < 0) messages.push(`Failure count decreased by ${Math.abs(failureCountDelta)}.`);
  if (warningCountDelta > 2) messages.push(`Warning count increased by ${warningCountDelta}.`);
  if (messages.length === 0) messages.push('No material change from baseline.');

  return {
    version: GOLDEN_RUN_HISTORY_VERSION,
    corpusId: current.corpusId,
    previousHistoryId: previous.id ?? null,
    previousRunId: previous.runId ?? null,
    currentRunId: current.runId,
    outcome,
    qualityGateStatus,
    operatorDecision,
    metrics,
    warningCountDelta,
    failureCountDelta,
    messages,
    comparedAt,
  };
}

/** Badge tone for a baseline outcome (matches shadcn Badge variants). */
export function getGoldenRunBaselineOutcomeTone(
  outcome: GoldenRunBaselineComparisonOutcome | string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (outcome) {
    case 'improved': return 'default';
    case 'stable': return 'secondary';
    case 'degraded': return 'destructive';
    case 'no_baseline': return 'outline';
    default: return 'outline';
  }
}

export function getGoldenRunBaselineOutcomeLabel(
  outcome: GoldenRunBaselineComparisonOutcome | string | null | undefined,
): string {
  switch (outcome) {
    case 'improved': return 'Improved';
    case 'stable': return 'Stable';
    case 'degraded': return 'Degraded';
    case 'no_baseline': return 'No baseline';
    case 'unknown': return 'Unknown';
    default: return 'Unknown';
  }
}
