import type { ReportTemplate } from '../../templateSchema';
import type { ReconciliationAiClient } from './aiClient';
import type { TemplateImportPlan, TemplateImportPatch } from './types';
import { applyTemplateImportPatches, type PatchApplyResult } from './patches';

export interface ReconciliationRepairResult extends PatchApplyResult {
  requested: number;
  patches: TemplateImportPatch[];
}

/**
 * One bounded repair pass: ask the reconciliation client for patch operations,
 * apply only schema-valid patches, and return both applied/rejected counts.
 */
export async function runReconciliationRepairPass(args: {
  template: ReportTemplate;
  plan: TemplateImportPlan;
  diffReport: unknown;
  client: ReconciliationAiClient;
  maxOperations?: number;
}): Promise<ReconciliationRepairResult> {
  const patches = await args.client.repair({
    plan: args.plan,
    diffReport: args.diffReport,
    maxOperations: args.maxOperations,
  });
  const bounded = patches.slice(0, Math.max(0, args.maxOperations ?? 20));
  const applied = applyTemplateImportPatches(args.template, bounded);
  return {
    ...applied,
    requested: patches.length,
    patches: bounded,
  };
}
