/**
 * repairPatternPersistence — Phase 10C.
 *
 * Save/load the Repair Pattern Analysis via the existing secure
 * `template-import-pdf` operations (`append_meta` / `get_status`). Metadata only;
 * no new edge operation or table. Never applies repairs.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  REPAIR_PATTERN_ANALYSIS_VERSION,
  type RepairPatternAnalysis,
  type LoadRepairPatternAnalysisResult,
  type SaveRepairPatternAnalysisResult,
} from './repairPatternTypes';

export const REPAIR_PATTERN_ANALYSIS_META_KEY = 'repair_pattern_analysis';

export async function saveRepairPatternAnalysis(
  importId: string,
  analysis: RepairPatternAnalysis,
): Promise<SaveRepairPatternAnalysisResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!analysis) return { kind: 'error', message: 'analysis is required' };

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [REPAIR_PATTERN_ANALYSIS_META_KEY]: analysis,
          },
        },
      } as any,
    );

    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'append_meta did not return ok') };
    }
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

export async function loadRepairPatternAnalysis(
  importId: string,
): Promise<LoadRepairPatternAnalysisResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<{
      record?: { meta?: Record<string, unknown> | null } | null;
      error?: string;
    }>(
      'template-import-pdf',
      {
        body: {
          operation: 'get_status',
          import_id: importId,
        },
      } as any,
    );

    if (error) {
      const message = String(error?.message ?? error);
      if (/not found|not_found|missing/i.test(message)) return { kind: 'missing' };
      return { kind: 'error', message };
    }
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };

    const meta = (data.record?.meta && typeof data.record.meta === 'object') ? data.record.meta : null;
    const analysis = meta?.[REPAIR_PATTERN_ANALYSIS_META_KEY] as RepairPatternAnalysis | undefined;

    if (!analysis) return { kind: 'missing' };
    if (analysis.version !== REPAIR_PATTERN_ANALYSIS_VERSION) {
      return { kind: 'error', message: 'Invalid repair pattern analysis version' };
    }
    return { kind: 'ok', analysis };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
