import { cdirToReportTemplate } from '../../cdir/mapper';
import { buildImportReviewDraft, type ImportReviewDraft } from '../../review';
import type { CdirDocument } from '../../cdir/schema';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import type { LoadedImportReviewForVisualQuality } from '../importReviewPipeline';
import type { VisualImportQualityReport } from '../schema';
import { runRepairLoop } from './runRepairLoop';
import type { RepairLoopBridgeInput } from './repairBridge';
import type { RepairLoopResult, RepairPassReport } from './repairTypes';
import type { RunRepairLoopOptions } from './runRepairLoop';

export const DETERMINISTIC_REPAIR_RUNNER_VERSION = 'deterministic-repair-runner-v1';

export type DeterministicRepairStatus = 'skipped' | 'completed' | 'failed';

export type DeterministicRepairSkipReason =
  | 'bridge_not_eligible'
  | 'missing_rendered_rasters'
  | 'missing_source_rasters'
  | 'missing_expectations'
  | 'unknown';

export interface DeterministicRepairSummary {
  version: typeof DETERMINISTIC_REPAIR_RUNNER_VERSION;
  status: DeterministicRepairStatus;
  importId: string;
  templateId: string | null;
  initialScore: number;
  finalScore: number;
  scoreDelta: number;
  initialManualReviewRequired: boolean;
  finalManualReviewRequired: boolean;
  eligiblePageCount: number;
  passesAttempted: number;
  passesAccepted: number;
  patchesProposed: number;
  patchesAccepted: number;
  patchesRejected: number;
  totalApplied: number;
  skippedReason?: DeterministicRepairSkipReason;
  errorMessage?: string;
}

export interface RunDeterministicVisualRepairOptions {
  loaded: LoadedImportReviewForVisualQuality;
  bridge: RepairLoopBridgeInput;
  /**
   * Injectable for unit tests and future server-side repair execution.
   */
  runRepairLoopImpl?: (options: RunRepairLoopOptions) => Promise<RepairLoopResult>;
  now?: () => Date;
}

export interface DeterministicVisualRepairResult {
  version: typeof DETERMINISTIC_REPAIR_RUNNER_VERSION;
  importId: string;
  templateId: string | null;
  status: DeterministicRepairStatus;
  skippedReason?: DeterministicRepairSkipReason;
  errorMessage?: string;
  initialReport: VisualImportQualityReport;
  finalReport: VisualImportQualityReport;
  repairedCdir: CdirDocument;
  repairedTemplate: ReportTemplate;
  draft: ImportReviewDraft;
  passes: RepairPassReport[];
  totalApplied: number;
  summary: DeterministicRepairSummary;
}

function classifySkipReason(bridge: RepairLoopBridgeInput): DeterministicRepairSkipReason | null {
  if (!bridge.canRunRepairLoop) return 'bridge_not_eligible';
  if (!bridge.renderedRasters.length) return 'missing_rendered_rasters';
  if (!bridge.sourceRasters.length) return 'missing_source_rasters';
  if (!bridge.expectations.expectedBounds.length && !bridge.expectations.expectedText.length) return 'missing_expectations';
  return null;
}

function countAcceptedPasses(passes: RepairPassReport[]): number {
  return passes.filter((pass) => pass.patchesAccepted > 0).length;
}

function summarizeRepair(options: {
  status: DeterministicRepairStatus;
  importId: string;
  templateId: string | null;
  initialReport: VisualImportQualityReport;
  finalReport: VisualImportQualityReport;
  eligiblePageCount: number;
  passes: RepairPassReport[];
  totalApplied: number;
  skippedReason?: DeterministicRepairSkipReason;
  errorMessage?: string;
}): DeterministicRepairSummary {
  const patchesProposed = options.passes.reduce((sum, pass) => sum + pass.patchesProposed, 0);
  const patchesAccepted = options.passes.reduce((sum, pass) => sum + pass.patchesAccepted, 0);
  const patchesRejected = options.passes.reduce((sum, pass) => sum + pass.patchesRejected, 0);

  return {
    version: DETERMINISTIC_REPAIR_RUNNER_VERSION,
    status: options.status,
    importId: options.importId,
    templateId: options.templateId,
    initialScore: options.initialReport.overallScore,
    finalScore: options.finalReport.overallScore,
    scoreDelta: options.finalReport.overallScore - options.initialReport.overallScore,
    initialManualReviewRequired: options.initialReport.manualReviewRequired,
    finalManualReviewRequired: options.finalReport.manualReviewRequired,
    eligiblePageCount: options.eligiblePageCount,
    passesAttempted: options.passes.length,
    passesAccepted: countAcceptedPasses(options.passes),
    patchesProposed,
    patchesAccepted,
    patchesRejected,
    totalApplied: options.totalApplied,
    ...(options.skippedReason ? { skippedReason: options.skippedReason } : {}),
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
  };
}

function rebuildDraft(options: {
  loaded: LoadedImportReviewForVisualQuality;
  cdir: CdirDocument;
  template: ReportTemplate;
  now?: () => Date;
}): ImportReviewDraft {
  return buildImportReviewDraft({
    id: options.loaded.draft.id,
    cdir: options.cdir,
    template: options.template,
    artifacts: options.loaded.draft.artifacts,
    now: options.now,
  });
}

function skippedResult(options: {
  loaded: LoadedImportReviewForVisualQuality;
  bridge: RepairLoopBridgeInput;
  reason: DeterministicRepairSkipReason;
  errorMessage?: string;
  now?: () => Date;
}): DeterministicVisualRepairResult {
  const cdir = options.loaded.draft.cdir;
  const template = options.loaded.draft.template;
  const draft = rebuildDraft({
    loaded: options.loaded,
    cdir,
    template,
    now: options.now,
  });

  const summary = summarizeRepair({
    status: options.errorMessage ? 'failed' : 'skipped',
    importId: options.bridge.importId,
    templateId: options.bridge.templateId,
    initialReport: options.bridge.classified.report,
    finalReport: options.bridge.classified.report,
    eligiblePageCount: options.bridge.eligiblePageNumbers.length,
    passes: [],
    totalApplied: 0,
    skippedReason: options.reason,
    errorMessage: options.errorMessage,
  });

  return {
    version: DETERMINISTIC_REPAIR_RUNNER_VERSION,
    importId: options.bridge.importId,
    templateId: options.bridge.templateId,
    status: summary.status,
    skippedReason: options.reason,
    errorMessage: options.errorMessage,
    initialReport: options.bridge.classified.report,
    finalReport: options.bridge.classified.report,
    repairedCdir: cdir,
    repairedTemplate: template,
    draft,
    passes: [],
    totalApplied: 0,
    summary,
  };
}

export async function runDeterministicVisualRepair(
  options: RunDeterministicVisualRepairOptions,
): Promise<DeterministicVisualRepairResult> {
  const bridge = options.bridge;
  const skipReason = classifySkipReason(bridge);

  if (skipReason) {
    return skippedResult({
      loaded: options.loaded,
      bridge,
      reason: skipReason,
      now: options.now,
    });
  }

  try {
    const run = options.runRepairLoopImpl ?? runRepairLoop;
    const repaired = await run(bridge.runOptions);
    const repairedTemplate = cdirToReportTemplate(repaired.cdir);
    const draft = rebuildDraft({
      loaded: options.loaded,
      cdir: repaired.cdir,
      template: repairedTemplate,
      now: options.now,
    });

    const summary = summarizeRepair({
      status: 'completed',
      importId: bridge.importId,
      templateId: bridge.templateId,
      initialReport: bridge.classified.report,
      finalReport: repaired.finalReport,
      eligiblePageCount: bridge.eligiblePageNumbers.length,
      passes: repaired.passes,
      totalApplied: repaired.totalApplied,
    });

    return {
      version: DETERMINISTIC_REPAIR_RUNNER_VERSION,
      importId: bridge.importId,
      templateId: bridge.templateId,
      status: 'completed',
      initialReport: bridge.classified.report,
      finalReport: repaired.finalReport,
      repairedCdir: repaired.cdir,
      repairedTemplate,
      draft,
      passes: repaired.passes,
      totalApplied: repaired.totalApplied,
      summary,
    };
  } catch (error) {
    return skippedResult({
      loaded: options.loaded,
      bridge,
      reason: 'unknown',
      errorMessage: (error as Error).message,
      now: options.now,
    });
  }
}
