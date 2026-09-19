/**
 * goldenRunHistoryPersistence — Phase 9C.
 *
 * Client-side invokers for the four secure `template-import-pdf` history
 * operations backed by `public.pdf_import_golden_runs`. All ownership /
 * authorization is enforced server-side by the edge function; the browser
 * client never queries the table directly.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { normalizeGoldenRunHistoryRecord } from './goldenRunHistorySummary';
import type {
  GetGoldenRunBaselinesResult,
  GetGoldenRunHistoryResult,
  GoldenRunHistoryInput,
  GoldenRunHistoryListOptions,
  GoldenRunHistoryRecord,
  ListGoldenRunHistoryResult,
  SaveGoldenRunHistoryResult,
} from './goldenRunHistoryTypes';

export const GOLDEN_RUN_HISTORY_FUNCTION = 'template-import-pdf';

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

function errorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const maybe = error as { message?: unknown };
  return String(maybe?.message ?? error);
}

function looksMissing(message: string): boolean {
  return /not found|not_found|missing|no rows/i.test(message);
}

function safeNormalize(raw: unknown) {
  try {
    return normalizeGoldenRunHistoryRecord(raw);
  } catch {
    return null;
  }
}

export async function saveGoldenRunHistory(
  historyInput: GoldenRunHistoryInput,
): Promise<SaveGoldenRunHistoryResult> {
  if (!historyInput) return { kind: 'error', message: 'history is required' };
  if (!historyInput.importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      history_id?: string;
      history?: unknown;
      error?: string;
    }>(GOLDEN_RUN_HISTORY_FUNCTION, {
      body: {
        operation: 'save_golden_run_history',
        import_id: historyInput.importId,
        history: historyInput,
      },
    } as any);

    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true || !data.history_id) {
      return { kind: 'error', message: String(data?.error ?? 'save_golden_run_history did not return ok') };
    }
    return {
      kind: 'ok',
      historyId: data.history_id,
      history: data.history ? safeNormalize(data.history) : null,
    };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function listGoldenRunHistory(
  options?: GoldenRunHistoryListOptions,
): Promise<ListGoldenRunHistoryResult> {
  const limit = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number(options?.limit) || DEFAULT_HISTORY_LIMIT));

  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      history?: unknown[];
      error?: string;
    }>(GOLDEN_RUN_HISTORY_FUNCTION, {
      body: {
        operation: 'list_golden_run_history',
        corpus_id: options?.corpusId || undefined,
        import_id: options?.importId || undefined,
        limit,
      },
    } as any);

    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'list_golden_run_history did not return ok') };
    }
    const history = Array.isArray(data.history)
      ? (data.history.map(safeNormalize).filter((r): r is GoldenRunHistoryRecord => r !== null))
      : [];
    return { kind: 'ok', history };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function getGoldenRunHistory(
  historyId: string,
): Promise<GetGoldenRunHistoryResult> {
  if (!historyId) return { kind: 'error', message: 'historyId is required' };

  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      history?: unknown;
      error?: string;
    }>(GOLDEN_RUN_HISTORY_FUNCTION, {
      body: {
        operation: 'get_golden_run_history',
        history_id: historyId,
      },
    } as any);

    if (error) {
      const message = errorMessage(error);
      return looksMissing(message) ? { kind: 'missing' } : { kind: 'error', message };
    }
    if (!data || data.error) {
      const message = String(data?.error ?? 'unknown error');
      return looksMissing(message) ? { kind: 'missing' } : { kind: 'error', message };
    }
    if (!data.history) return { kind: 'missing' };
    const record = safeNormalize(data.history);
    if (!record) return { kind: 'error', message: 'invalid history record' };
    return { kind: 'ok', history: record };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function getLatestGoldenRunBaselines(
  corpusId?: string | null,
): Promise<GetGoldenRunBaselinesResult> {
  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      baselines?: unknown[];
      error?: string;
    }>(GOLDEN_RUN_HISTORY_FUNCTION, {
      body: {
        operation: 'get_latest_golden_run_baselines',
        corpus_id: corpusId || undefined,
      },
    } as any);

    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'get_latest_golden_run_baselines did not return ok') };
    }
    const baselines = Array.isArray(data.baselines)
      ? (data.baselines.map(safeNormalize).filter((r): r is GoldenRunHistoryRecord => r !== null))
      : [];
    return { kind: 'ok', baselines };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}
