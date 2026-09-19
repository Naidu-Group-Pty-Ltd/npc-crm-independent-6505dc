/**
 * importIntelligencePersistence — Phase 10B.
 *
 * Save/load the Import Intelligence Profile via the existing secure
 * `template-import-pdf` operations:
 *   - save: `append_meta` (ownership-checked meta merge)
 *   - load: `get_status` (returns the row incl. `meta`)
 * No new edge operation or table. Profiles are metadata only — never raw PDF text.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  IMPORT_INTELLIGENCE_PROFILE_VERSION,
  type ImportIntelligenceProfile,
  type LoadImportIntelligenceProfileResult,
  type SaveImportIntelligenceProfileResult,
} from './importIntelligenceTypes';

export const IMPORT_INTELLIGENCE_META_KEY = 'import_intelligence_profile';

export async function saveImportIntelligenceProfile(
  importId: string,
  profile: ImportIntelligenceProfile,
): Promise<SaveImportIntelligenceProfileResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!profile) return { kind: 'error', message: 'profile is required' };

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [IMPORT_INTELLIGENCE_META_KEY]: profile,
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

export async function loadImportIntelligenceProfile(
  importId: string,
): Promise<LoadImportIntelligenceProfileResult> {
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
    const profile = meta?.[IMPORT_INTELLIGENCE_META_KEY] as ImportIntelligenceProfile | undefined;

    if (!profile) return { kind: 'missing' };
    if (profile.version !== IMPORT_INTELLIGENCE_PROFILE_VERSION) {
      return { kind: 'error', message: 'Invalid import intelligence profile version' };
    }
    return { kind: 'ok', profile };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
