/**
 * goldenRegressionPersistence — Phase 8D save/load.
 *
 * Persists the golden regression summary onto
 * `template_imports.meta.golden_regression_summary` via the existing secure
 * `template-import-pdf` edge operations:
 *   - save: `append_meta` (ownership-checked meta merge)
 *   - load: `get_status` (returns the row incl. `meta`)
 * No new edge operation or dedicated table is introduced.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  GOLDEN_REGRESSION_SUMMARY_VERSION,
  type GoldenRegressionSummary,
  type LoadGoldenRegressionSummaryResult,
  type SaveGoldenRegressionSummaryResult,
} from './goldenRegressionTypes';
import {
  summarizeGoldenRegressionForMeta,
  withGoldenRegressionPersistedAt,
} from './goldenRegressionSummary';

export const GOLDEN_REGRESSION_META_KEY = 'golden_regression_summary';

export async function saveGoldenRegressionSummary(
  importId: string,
  summary: GoldenRegressionSummary,
): Promise<SaveGoldenRegressionSummaryResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!summary) return { kind: 'error', message: 'summary is required' };

  const persisted = withGoldenRegressionPersistedAt(summary, new Date().toISOString());

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [GOLDEN_REGRESSION_META_KEY]: summarizeGoldenRegressionForMeta(persisted),
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

export async function loadGoldenRegressionSummary(
  importId: string,
): Promise<LoadGoldenRegressionSummaryResult> {
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
    const summary = meta?.[GOLDEN_REGRESSION_META_KEY] as GoldenRegressionSummary | undefined;

    if (!summary) return { kind: 'missing' };
    if (summary.version !== GOLDEN_REGRESSION_SUMMARY_VERSION) {
      return { kind: 'error', message: 'golden regression summary has an unexpected or missing version' };
    }
    return { kind: 'ok', summary };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
