import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { VisualImportQualityReport } from '../schema';
import type { VisualQaReviewSummary } from '../importReviewVisualQuality';
import type { GeneratedRenderArtifactManifest } from '../generatedRenderCapture';
import type { ClassifiedRepairIssues } from './issueClassifier';
import type { VisualRepairEligibility } from './repairEligibility';
import type { DeterministicRepairSummary } from './deterministicRepairRunner';
import type { RepairPassReport } from './repairTypes';
import type { VisualRepairOrchestrationPipelineResult, VisualRepairOrchestrationSummary } from './repairOrchestrationPipeline';

export const VISUAL_REPAIR_AUDIT_PERSISTENCE_VERSION = 'visual-repair-audit-persistence-v1';

export interface VisualRepairAuditArtifactPaths {
  summary: string;
  repairFolder: string;
}

export interface VisualRepairAuditPayload {
  version: typeof VISUAL_REPAIR_AUDIT_PERSISTENCE_VERSION;
  importId: string;
  templateId: string | null;
  summary: VisualRepairOrchestrationSummary;
  visualQa: {
    report: VisualImportQualityReport;
    summary: VisualQaReviewSummary;
    generatedRenderManifest: GeneratedRenderArtifactManifest;
  };
  bridge: {
    canRunRepairLoop: boolean;
    eligiblePageNumbers: number[];
    problems: string[];
    classifiedSummary: ClassifiedRepairIssues['summary'];
    eligibility: VisualRepairEligibility;
  };
  repair: {
    status: string;
    skippedReason?: string | null;
    errorMessage?: string | null;
    summary: DeterministicRepairSummary;
    passes: RepairPassReport[];
    totalApplied: number;
    initialReport: VisualImportQualityReport;
    finalReport: VisualImportQualityReport;
  };
  generatedAt: string;
}

export interface PersistedVisualRepairAudit {
  importId: string;
  payload: VisualRepairAuditPayload;
  artifactPaths: VisualRepairAuditArtifactPaths;
}

export type SaveVisualRepairAuditResult =
  | { kind: 'ok'; auditPath: string }
  | { kind: 'error'; message: string };

export type LoadVisualRepairAuditResult =
  | { kind: 'ok'; payload: PersistedVisualRepairAudit }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export const visualRepairAuditPaths = {
  bucket: 'template-import-artifacts' as const,
  summary: (importId: string) => `${importId}/repair/repair-loop.json`,
  repairFolder: (importId: string) => `${importId}/repair`,
};

export function buildVisualRepairAuditPayload(
  result: VisualRepairOrchestrationPipelineResult,
  opts: { now?: () => Date } = {},
): VisualRepairAuditPayload {
  return {
    version: VISUAL_REPAIR_AUDIT_PERSISTENCE_VERSION,
    importId: result.importId,
    templateId: result.templateId,
    summary: result.summary,
    visualQa: {
      report: result.visualQa.visualQa.report,
      summary: result.visualQa.visualQa.summary,
      generatedRenderManifest: result.visualQa.generatedRenderManifest,
    },
    bridge: {
      canRunRepairLoop: result.bridge.canRunRepairLoop,
      eligiblePageNumbers: result.bridge.eligiblePageNumbers,
      problems: result.bridge.problems,
      classifiedSummary: result.bridge.classified.summary,
      eligibility: result.bridge.eligibility,
    },
    repair: {
      status: result.repair.status,
      skippedReason: result.repair.skippedReason ?? null,
      errorMessage: result.repair.errorMessage ?? null,
      summary: result.repair.summary,
      passes: result.repair.passes,
      totalApplied: result.repair.totalApplied,
      initialReport: result.repair.initialReport,
      finalReport: result.repair.finalReport,
    },
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
  };
}

export async function saveVisualRepairAudit(
  importId: string,
  payload: VisualRepairAuditPayload,
): Promise<SaveVisualRepairAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!payload) return { kind: 'error', message: 'payload is required' };

  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      audit_path?: string;
      error?: string;
    }>(
      'template-import-pdf',
      {
        body: {
          operation: 'save_visual_repair_audit',
          import_id: importId,
          payload,
        },
      } as any,
    );

    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };

    return {
      kind: 'ok',
      auditPath: data.audit_path ?? visualRepairAuditPaths.summary(importId),
    };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

export async function loadVisualRepairAudit(importId: string): Promise<LoadVisualRepairAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<PersistedVisualRepairAudit | null>(
      'template-import-pdf',
      {
        body: {
          operation: 'get_visual_repair_audit',
          import_id: importId,
        },
      } as any,
    );

    if (error) {
      const message = String(error?.message ?? error);
      if (/unknown operation|not implemented|not found/i.test(message)) return { kind: 'missing' };
      return { kind: 'error', message };
    }

    if (!data) return { kind: 'missing' };
    return { kind: 'ok', payload: data };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
