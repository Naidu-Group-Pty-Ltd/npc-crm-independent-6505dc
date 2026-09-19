/**
 * E8 — the verified candidate repair cascade (orchestrator).
 *
 * Per failing page, ≤ 2 passes: classify E7 defects → generate bounded
 * candidates → apply each atomically to the STAGED TEMPLATE → render+evaluate
 * through the injected adapter (E6 plan + E7) → reject unsafe candidates →
 * select the safest deterministically → apply + re-verify (trial/final identical)
 * → continue or fall back to mixed/raster → finalize or block. Score improvement
 * is never sufficient; safety tier outranks score; hard defects veto acceptance.
 */
import type { VisualPageQualityReportV2 } from '../../v2/contracts';
import {
  hashTemplateProjection, toDefectReference, defectFingerprint,
  REPAIR_CASCADE_V2_VERSION, REPAIR_ATTEMPT_AUDIT_VERSION,
  type RepairCascadeResultV2, type RepairPageResultV2, type RepairAttemptAuditV1, type RepairDefectReferenceV1,
} from './contracts';
import { classifyDefects, type ClassifyContext } from './classifyDefects';
import { generateCandidates, type RepairInputs } from './candidateGeneration';
import { applyCandidateOperations, templateProjection, type ApplyResult } from './operationApply';
import type { SourceContext } from './operationPolicy';
import { evaluateCandidate } from './candidateEvaluation';
import { selectCandidate, type EvaluatedCandidate } from './candidateSelection';
import { createRepairMemory, recordAttempt, recordRejected, recordSelected, alreadyAttempted, isOscillating } from './repairMemory';
import type { RenderAndEvaluateRepairCandidate, RepairRuntimeContextV1 } from './runtimeAdapter';

export interface CascadePageInput {
  pageId: string; pageNumber: number;
  initialReport: VisualPageQualityReportV2;
  sourceContext: SourceContext;
  pass1Inputs: RepairInputs;
  pass2Inputs: RepairInputs;
  pageRasterAvailable: boolean;
}

export interface RunCascadeInput {
  importId: string; templateId: string | null;
  template: unknown;
  baseRenderPlanHash?: string | null;
  pages: CascadePageInput[];
  adapter: RenderAndEvaluateRepairCandidate;
  runtimeContextFor: (page: CascadePageInput) => RepairRuntimeContextV1;
  now?: () => number;
}

const MAX_PASSES = 2;

function targetFingerprints(report: VisualPageQualityReportV2): string[] {
  return report.criticalDefects.filter((d) => d.hardVeto).map((d) => defectFingerprint(d));
}
function targetRefs(report: VisualPageQualityReportV2): RepairDefectReferenceV1[] {
  return report.criticalDefects.filter((d) => d.hardVeto).map(toDefectReference);
}

export async function runRepairCascadeV2(input: RunCascadeInput): Promise<RepairCascadeResultV2> {
  const now = input.now ?? (() => 0);
  const pageResults: RepairPageResultV2[] = [];
  let templateChanged = false;

  for (const page of input.pages) {
    let workingTemplate = input.template;
    let currentReport = page.initialReport;
    const mem = createRepairMemory();
    const audits: RepairAttemptAuditV1[] = [];
    const ctxBase = input.runtimeContextFor(page);
    let proposed = 0, evaluated = 0, rejected = 0;
    let selectedId: string | null = null;
    let passesAttempted = 0;

    // Already accepted → no repair.
    if (currentReport.hardDefectCount === 0 && currentReport.qualityCoverage === 'complete') {
      pageResults.push(finalizePage(page, currentReport, 'unchanged', 'native', [], [], audits, 0, 0, 0, null, page.initialReport, []));
      continue;
    }

    for (let pass = 0 as 0 | 1; pass < MAX_PASSES; pass = (pass + 1) as 0 | 1) {
      passesAttempted = pass + 1;
      const allowFallback = pass === 1;
      const classifyCtx: ClassifyContext = { pageRasterAvailable: page.pageRasterAvailable };
      classifyDefects(currentReport.criticalDefects.map((d) => d.code), classifyCtx); // classification drives which inputs are relevant
      const baseTemplateHash = hashTemplateProjection(templateProjection(workingTemplate as Parameters<typeof templateProjection>[0]));
      const baseReportHash = `qr-${defectFingerprint({ code: 'agg', scope: 'page', pageId: page.pageId, regionId: null, overlayId: null, sourceRunId: null } as never)}-${currentReport.criticalDefects.length}`;

      const generated = generateCandidates({
        importId: input.importId, templateId: input.templateId,
        pageId: page.pageId, pageNumber: page.pageNumber, passIndex: pass,
        baseTemplateHash, baseRenderPlanHash: input.baseRenderPlanHash ?? null, baseQualityReportHash: baseReportHash,
        targetDefects: targetRefs(currentReport),
        repairInputs: allowFallback ? page.pass2Inputs : page.pass1Inputs,
        allowFallback,
      });
      proposed += generated.length;

      const targetFps = targetFingerprints(currentReport);
      const evaluatedCandidates: Array<EvaluatedCandidate & { applied: ApplyResult; runtimeReport: VisualPageQualityReportV2 | null }> = [];

      for (const gen of generated) {
        if (alreadyAttempted(mem, gen.candidate.id)) continue;
        recordAttempt(mem, gen.candidate.id, gen.candidate.operationIds);
        const applied = applyCandidateOperations(workingTemplate as Parameters<typeof applyCandidateOperations>[0], gen.operations, page.sourceContext, { enforceTargetHash: false });
        if (!applied.ok || !applied.template) { rejected += 1; recordRejected(mem, gen.candidate.id); continue; }
        gen.candidate.templateHash = applied.templateHash ?? '';
        const runtime = await input.adapter.renderAndEvaluate(gen.candidate, applied.template, { ...ctxBase, evaluateExport: shouldExport(gen.candidate.candidateClass) });
        gen.candidate.renderPlanHash = runtime.renderPlanHash;
        const fallbackSafer = gen.candidate.candidateClass === 'mixed-region' || gen.candidate.candidateClass === 'page-raster';
        const evaluation = evaluateCandidate({
          candidate: gen.candidate, beforeReport: currentReport, afterReport: runtime.pageReport,
          targetDefectFingerprints: targetFps, renderPlanHashMatched: runtime.renderPlanHashMatched,
          exportParityPassed: runtime.exportParityPassed, fallbackSafer,
        });
        evaluated += 1;
        if (!evaluation.accepted) { rejected += 1; recordRejected(mem, gen.candidate.id); }
        evaluatedCandidates.push({ candidate: gen.candidate, evaluation, applied, runtimeReport: runtime.pageReport });
      }

      const selection = selectCandidate(evaluatedCandidates.map((e) => ({ candidate: e.candidate, evaluation: e.evaluation })));
      if (!selection.selected) {
        audits.push(...evaluatedCandidates.map((e) => auditFor(e, pass, baseTemplateHash, input.baseRenderPlanHash ?? null, 'rejected', now())));
        continue; // try next pass (fallback) or exit
      }

      const winner = evaluatedCandidates.find((e) => e.candidate.id === selection.selected!.candidate.id)!;
      // Re-verify: re-render the APPLIED state and confirm trial === final.
      const finalRuntime = await input.adapter.renderAndEvaluate(winner.candidate, winner.applied.template, { ...ctxBase, evaluateExport: true });
      const trialReport = winner.runtimeReport;
      const finalReport = finalRuntime.pageReport;
      const identical = trialReport != null && finalReport != null
        && trialReport.renderPlanHash === finalReport.renderPlanHash
        && trialReport.recommendedAction === finalReport.recommendedAction
        && trialReport.hardDefectCount === finalReport.hardDefectCount;
      if (!identical || !finalReport) {
        rejected += 1; recordRejected(mem, winner.candidate.id);
        audits.push(auditFor(winner, pass, baseTemplateHash, input.baseRenderPlanHash ?? null, 'rolled-back', now(), ['applied_state_mismatch']));
        continue;
      }
      if (isOscillating(mem, winner.candidate.templateHash)) {
        audits.push(auditFor(winner, pass, baseTemplateHash, input.baseRenderPlanHash ?? null, 'rolled-back', now(), ['oscillation_detected']));
        break;
      }

      // Accept the selected candidate.
      workingTemplate = winner.applied.template;
      currentReport = finalReport;
      selectedId = winner.candidate.id;
      templateChanged = true;
      recordSelected(mem, winner.candidate.id, winner.candidate.templateHash);
      audits.push(auditFor(winner, pass, baseTemplateHash, input.baseRenderPlanHash ?? null, 'selected', now()));

      if (currentReport.hardDefectCount === 0 && currentReport.qualityCoverage === 'complete') break; // accepted → stop
    }

    const resolved = page.initialReport.criticalDefects
      .filter((d) => d.hardVeto).map(defectFingerprint)
      .filter((f) => !currentReport.criticalDefects.some((d) => defectFingerprint(d) === f));
    const remaining = currentReport.criticalDefects.filter((d) => d.hardVeto).map(defectFingerprint);
    const status = deriveStatus(currentReport, selectedId);
    pageResults.push(finalizePage(page, currentReport, status.finalStatus, status.finalStrategy, resolved, remaining, audits, passesAttempted, proposed, evaluated, selectedId, page.initialReport, rejected != null ? [] : []));
    void rejected;
  }

  const anyBlocked = pageResults.some((p) => p.finalStatus === 'blocked');
  const anyRemaining = pageResults.some((p) => p.remainingDefectFingerprints.length > 0);
  const manualReview = pageResults.some((p) => p.finalStatus !== 'unchanged' && p.finalStatus !== 'accepted-native');
  return {
    version: REPAIR_CASCADE_V2_VERSION, importId: input.importId, templateId: input.templateId,
    templateChanged, pages: pageResults,
    finalizationAllowed: !anyBlocked && !anyRemaining,
    exportAllowed: !anyBlocked && !anyRemaining,
    manualReviewRequired: manualReview,
    problems: anyBlocked ? ['blocked_page_present'] : (anyRemaining ? ['unresolved_defects_present'] : []),
  };
}

function shouldExport(cls: string): boolean {
  return cls === 'page-raster' || cls === 'alternative-table' || cls === 'alternative-typography' || cls === 'mixed-region';
}

function deriveStatus(report: VisualPageQualityReportV2, selectedId: string | null): { finalStatus: RepairPageResultV2['finalStatus']; finalStrategy: string } {
  if (report.hardDefectCount > 0 || report.qualityCoverage !== 'complete') {
    return { finalStatus: 'blocked', finalStrategy: 'blocked' };
  }
  if (!selectedId) return { finalStatus: 'unchanged', finalStrategy: report.outputStrategy };
  switch (report.outputStrategy) {
    case 'raster-only': return { finalStatus: 'accepted-raster', finalStrategy: 'raster-only' };
    case 'mixed': return { finalStatus: 'accepted-mixed', finalStrategy: 'mixed' };
    default: return { finalStatus: 'accepted-native', finalStrategy: 'native' };
  }
}

function finalizePage(
  page: CascadePageInput, report: VisualPageQualityReportV2, finalStatus: RepairPageResultV2['finalStatus'], finalStrategy: string,
  resolved: string[], remaining: string[], audits: RepairAttemptAuditV1[], passesAttempted: number,
  proposed: number, evaluated: number, selectedId: string | null, initial: VisualPageQualityReportV2, problems: string[],
): RepairPageResultV2 {
  return {
    pageId: page.pageId, pageNumber: page.pageNumber, passesAttempted,
    candidatesProposed: proposed, candidatesEvaluated: evaluated, candidatesRejected: audits.filter((a) => a.status !== 'selected').length,
    selectedCandidateId: selectedId, finalStatus, finalStrategy,
    targetDefectFingerprints: initial.criticalDefects.filter((d) => d.hardVeto).map(defectFingerprint),
    resolvedDefectFingerprints: resolved, remainingDefectFingerprints: remaining,
    initialScore: initial.overallScore, finalScore: report.overallScore, audits, problems,
  };
}

function auditFor(
  e: EvaluatedCandidate, pass: 0 | 1, baselineTemplateHash: string, baselineRenderPlanHash: string | null,
  status: RepairAttemptAuditV1['status'], elapsedMs: number, extraRejections: string[] = [],
): RepairAttemptAuditV1 {
  const ev = e.evaluation;
  return {
    version: REPAIR_ATTEMPT_AUDIT_VERSION,
    planId: e.candidate.planId, candidateId: e.candidate.id, passIndex: pass,
    operationIds: e.candidate.operationIds, targetDefectFingerprints: [], sourceEvidenceHashes: [e.candidate.sourceEvidenceHash],
    baselineTemplateHash, candidateTemplateHash: e.candidate.templateHash,
    baselineRenderPlanHash, candidateRenderPlanHash: e.candidate.renderPlanHash,
    beforeScore: ev.beforeScore, afterScore: ev.afterScore,
    beforeStrategy: ev.beforeOutputStrategy, afterStrategy: ev.afterOutputStrategy,
    resolvedDefectFingerprints: ev.resolvedDefectFingerprints, retainedDefectFingerprints: ev.retainedDefectFingerprints, introducedDefectFingerprints: ev.introducedDefectFingerprints,
    coverage: ev.criticalCoverageComplete ? 'complete' : 'partial', e7Decision: ev.afterReport?.recommendedAction ?? 'none',
    status, rejectionCodes: [...ev.rejectionCodes, ...extraRejections], elapsedMs, deterministicCost: e.candidate.deterministicCost,
  };
}
