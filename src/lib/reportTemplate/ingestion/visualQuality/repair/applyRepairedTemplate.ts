import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  parseTemplate,
  type ReportTemplate,
} from '@/lib/reportTemplate/templateSchema';
import type { VisualRepairOrchestrationSummary } from './repairOrchestrationPipeline';

export const REPAIRED_TEMPLATE_APPLICATION_VERSION = 'repaired-template-application-v1';

export interface ApplyRepairedTemplateOptions {
  templateId: string;
  repairedTemplate: ReportTemplate | unknown;
  repairSummary?: VisualRepairOrchestrationSummary | null;
  repairAuditPath?: string | null;
  note?: string | null;
  expectedVersion?: number | null;
}

export interface ApplyRepairedTemplateResult {
  version: typeof REPAIRED_TEMPLATE_APPLICATION_VERSION;
  templateId: string;
  previousVersion: number;
  nextVersion: number;
  snapshotCreated: boolean;
  repairAuditPath: string | null;
  record: unknown;
}

function defaultRepairNote(options: ApplyRepairedTemplateOptions): string {
  const summary = options.repairSummary;
  const parts = [
    'Pre-repair snapshot before applying PDF visual repair.',
  ];

  if (summary) {
    parts.push(
      `Score ${Math.round(summary.visualQaScore * 100)}% → ${Math.round(summary.finalScore * 100)}%.`,
      `Patches accepted: ${summary.patchesAccepted}.`,
      `Passes attempted: ${summary.passesAttempted}.`,
    );
  }

  if (options.repairAuditPath) {
    parts.push(`Repair audit: ${options.repairAuditPath}.`);
  }

  return parts.join(' ');
}

function versionConflictError(expected: number, actual: number) {
  const err = new Error('Template changed on the server. Review the latest version before applying repair.') as Error & {
    code?: string;
    expectedVersion?: number;
    currentVersion?: number;
  };
  err.code = 'version_conflict';
  err.expectedVersion = expected;
  err.currentVersion = actual;
  return err;
}

export async function applyRepairedTemplateToRecord(
  options: ApplyRepairedTemplateOptions,
): Promise<ApplyRepairedTemplateResult> {
  if (!options.templateId) throw new Error('templateId is required.');
  const repairedTemplate = parseTemplate(options.repairedTemplate);

  const current = await invokeSecureFunction('manage-templates', {
    operation: 'get',
    table: 'report_templates',
    recordId: options.templateId,
  });

  if (current.error) throw new Error(current.error.message);
  const currentRecord = current.data?.record;
  if (!currentRecord) throw new Error('Template not found.');

  if (currentRecord.locked_for_review) {
    const err = new Error('Template is locked for review. Unlock it before applying repair.') as Error & { code?: string };
    err.code = 'template_locked_for_review';
    throw err;
  }

  const previousVersion = Number(currentRecord.version || 1);
  const expectedVersion = Number(options.expectedVersion);

  if (Number.isFinite(expectedVersion) && expectedVersion !== previousVersion) {
    throw versionConflictError(expectedVersion, previousVersion);
  }

  const snapshot = await invokeSecureFunction('manage-templates', {
    operation: 'insert',
    table: 'report_template_versions',
    data: {
      template_id: options.templateId,
      version: previousVersion,
      schema: currentRecord.schema,
      note: options.note ?? defaultRepairNote(options),
      label: 'Before visual repair',
    },
  });

  if (snapshot.error) throw new Error(snapshot.error.message);

  const nextVersion = previousVersion + 1;
  const update = await invokeSecureFunction('manage-templates', {
    operation: 'update',
    table: 'report_templates',
    recordId: options.templateId,
    expectedVersion: previousVersion,
    data: {
      schema: repairedTemplate,
      version: nextVersion,
    },
  });

  if (update.error) {
    const err = new Error(update.error.message) as Error & {
      code?: string;
      current?: unknown;
      currentVersion?: number | null;
    };
    const rawError = (update.data as any)?.error;
    if (rawError?.code) err.code = rawError.code;
    if (rawError?.current) err.current = rawError.current;
    if (rawError?.currentVersion !== undefined) err.currentVersion = rawError.currentVersion;
    throw err;
  }

  return {
    version: REPAIRED_TEMPLATE_APPLICATION_VERSION,
    templateId: options.templateId,
    previousVersion,
    nextVersion,
    snapshotCreated: true,
    repairAuditPath: options.repairAuditPath ?? null,
    record: update.data?.record ?? null,
  };
}
