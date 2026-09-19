/**
 * E8 — bounded repair persistence summary (pure). No signed URLs, no ImageData,
 * no source text, no financial values — counts + codes + hashes only. Designed
 * to live in existing JSON metadata (no migration).
 */
import { REPAIR_CASCADE_V2_VERSION, type RepairCascadeResultV2, type RepairPageResultV2 } from './contracts';

export const REPAIR_SUMMARY_V2_VERSION = 'repair-summary-v2';

export interface RepairSummaryV2 {
  version: typeof REPAIR_SUMMARY_V2_VERSION;
  cascadeVersion: typeof REPAIR_CASCADE_V2_VERSION;
  status: 'complete' | 'partial' | 'blocked';
  templateChanged: boolean;
  passesAttempted: number;
  candidatesProposed: number; candidatesEvaluated: number; candidatesRejected: number; candidatesSelected: number;
  targetDefectCount: number; resolvedDefectCount: number; remainingDefectCount: number;
  initialScore: number | null; finalScore: number | null;
  finalStrategyCounts: Record<string, number>;
  finalizationAllowed: boolean; exportAllowed: boolean; manualReviewRequired: boolean;
  complete: boolean; problems: string[];
}

export function buildRepairSummaryV2(result: RepairCascadeResultV2): RepairSummaryV2 {
  let proposed = 0, evaluated = 0, rejected = 0, selected = 0;
  let target = 0, resolved = 0, remaining = 0;
  const strategyCounts: Record<string, number> = {};
  let initial: number | null = null; let final: number | null = null;
  for (const page of result.pages) {
    proposed += page.candidatesProposed; evaluated += page.candidatesEvaluated; rejected += page.candidatesRejected;
    if (page.selectedCandidateId) selected += 1;
    target += page.targetDefectFingerprints.length; resolved += page.resolvedDefectFingerprints.length; remaining += page.remainingDefectFingerprints.length;
    strategyCounts[page.finalStrategy] = (strategyCounts[page.finalStrategy] ?? 0) + 1;
    if (page.initialScore != null) initial = initial == null ? page.initialScore : Math.min(initial, page.initialScore);
    if (page.finalScore != null) final = final == null ? page.finalScore : Math.min(final, page.finalScore);
  }
  const status: RepairSummaryV2['status'] = !result.finalizationAllowed ? 'blocked' : (remaining > 0 ? 'partial' : 'complete');
  return {
    version: REPAIR_SUMMARY_V2_VERSION, cascadeVersion: REPAIR_CASCADE_V2_VERSION,
    status, templateChanged: result.templateChanged,
    passesAttempted: Math.max(0, ...result.pages.map((p) => p.passesAttempted), 0),
    candidatesProposed: proposed, candidatesEvaluated: evaluated, candidatesRejected: rejected, candidatesSelected: selected,
    targetDefectCount: target, resolvedDefectCount: resolved, remainingDefectCount: remaining,
    initialScore: initial, finalScore: final, finalStrategyCounts: strategyCounts,
    finalizationAllowed: result.finalizationAllowed, exportAllowed: result.exportAllowed, manualReviewRequired: result.manualReviewRequired,
    complete: result.finalizationAllowed, problems: [...result.problems],
  };
}

export type { RepairPageResultV2 };
