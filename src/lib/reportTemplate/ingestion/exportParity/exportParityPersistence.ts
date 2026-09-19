/**
 * exportParityPersistence — persist/load the export-parity summary via the secure
 * `template-import-pdf` edge function (`save_export_parity` / `get_export_parity`).
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { ExportParitySummary } from './exportParityTypes';

export const EXPORT_PARITY_PERSISTENCE_VERSION = 'export-parity-persistence-v1';

export const exportParityPaths = {
  bucket: 'template-import-artifacts' as const,
  summary: (importId: string) => `${importId}/export-parity/export-parity.json`,
  folder: (importId: string) => `${importId}/export-parity`,
};

export type SaveExportParityResult =
  | { kind: 'ok'; summaryPath: string }
  | { kind: 'error'; message: string };

export type LoadExportParityResult =
  | { kind: 'ok'; payload: ExportParitySummary; summaryPath: string }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export async function saveExportParitySummary(
  importId: string,
  summary: ExportParitySummary,
): Promise<SaveExportParityResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!summary) return { kind: 'error', message: 'summary is required' };

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; summary_path?: string; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'save_export_parity',
          import_id: importId,
          summary,
        },
      } as any,
    );

    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };

    return { kind: 'ok', summaryPath: data.summary_path ?? exportParityPaths.summary(importId) };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

export async function loadExportParitySummary(importId: string): Promise<LoadExportParityResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<
      { importId: string; summary: ExportParitySummary; artifactPaths?: { summary?: string } } | null
    >(
      'template-import-pdf',
      {
        body: {
          operation: 'get_export_parity',
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
    if (!data.summary) return { kind: 'error', message: 'export parity response did not contain a summary' };

    return {
      kind: 'ok',
      payload: data.summary,
      summaryPath: data.artifactPaths?.summary ?? exportParityPaths.summary(importId),
    };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
