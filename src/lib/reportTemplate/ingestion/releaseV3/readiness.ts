/**
 * PDF Extraction V3 · E12 — release readiness decision.
 *
 * E12 code completion may mark codeReady / generatedCorpusReady / localContainerReady
 * ONLY when evidence exists. It must NOT claim zeroTrafficRuntimeReady / canaryReady
 * / productionPromotionReady without later operator-run evidence — those stay `null`
 * (not `false`) until evaluated.
 */
import {
  RELEASE_READINESS_DECISION_VERSION,
  type ReleaseGateReportV2,
  type ReleaseReadinessDecisionV1,
} from './contracts';

export interface ReadinessInput {
  staticReport: ReleaseGateReportV2 | null;
  generatedFastReport: ReleaseGateReportV2 | null;
  generatedFullReport: ReleaseGateReportV2 | null;
  privateReport: ReleaseGateReportV2 | null;
  localContainerPassed: boolean | null;
}

function ready(report: ReleaseGateReportV2 | null): boolean {
  return report != null && report.decision === 'pass' && report.releaseReady;
}

export function buildReadinessDecision(input: ReadinessInput): ReleaseReadinessDecisionV1 {
  const blockingReasons: string[] = [];
  const evidenceReportIds: string[] = [];
  for (const r of [input.staticReport, input.generatedFastReport, input.generatedFullReport, input.privateReport]) {
    if (r) evidenceReportIds.push(r.reportId);
  }

  const codeReady = ready(input.staticReport) && ready(input.generatedFastReport);
  const generatedCorpusReady = ready(input.generatedFullReport);
  const localContainerReady = input.localContainerPassed === true;

  if (!ready(input.staticReport)) blockingReasons.push('static_gate_not_passed');
  if (!ready(input.generatedFastReport)) blockingReasons.push('generated_fast_gate_not_passed');
  if (input.generatedFullReport && !generatedCorpusReady) blockingReasons.push('generated_full_gate_not_passed');

  // Private corpus: null until it is actually run; false only when a run failed.
  let privateCorpusReady: boolean | null;
  if (input.privateReport == null) privateCorpusReady = null;
  else privateCorpusReady = ready(input.privateReport);

  return {
    version: RELEASE_READINESS_DECISION_VERSION,
    codeReady,
    generatedCorpusReady,
    privateCorpusReady,
    localContainerReady,
    // Never asserted by code alone — operator-run evidence required later.
    zeroTrafficRuntimeReady: null,
    canaryReady: null,
    productionPromotionReady: null,
    blockingReasons,
    evidenceReportIds,
    problems: [],
  };
}
