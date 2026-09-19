import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useAuth } from '@/hooks/useAuth';

export type ReportScope = 'address' | 'suburb' | 'zipcode' | 'state';
export type ReportTier = 'compass' | 'strategic' | 'briefing' | 'snapshot' | 'financial';

export interface ReportPreferences {
  default_scope: ReportScope;
  default_tier: ReportTier;
  last_used_scope: ReportScope | null;
  last_used_tier: ReportTier | null;
  last_used_at: string | null;
}

const DEFAULTS: ReportPreferences = {
  default_scope: 'address',
  default_tier: 'compass',
  last_used_scope: null,
  last_used_tier: null,
  last_used_at: null,
};

/**
 * Per-user report generation preferences. Phase B addition.
 *
 * - `defaults` are the user's preferred scope/tier (sticky across sessions).
 * - `lastUsed` is the most recent pick (used to prefill when no default is set).
 * - `effectiveScope` / `effectiveTier` resolve in this order:
 *     last_used_* -> default_* -> hardcoded fallback ('address' / 'compass')
 */
export function useReportPreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<ReportPreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await invokeSecureFunction('manage-report-preferences', {
          operation: 'get',
        });
        if (cancelled) return;
        if (!error && data?.success && data.preferences) {
          setPrefs({ ...DEFAULTS, ...data.preferences });
        }
      } catch (e) {
        console.warn('[useReportPreferences] failed to load:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const update = useCallback(
    async (patch: Partial<ReportPreferences>) => {
      // Optimistic
      setPrefs((p) => ({ ...p, ...patch }));
      try {
        const { data, error } = await invokeSecureFunction('manage-report-preferences', {
          operation: 'upsert',
          data: patch,
        });
        if (!error && data?.success && data.preferences) {
          setPrefs({ ...DEFAULTS, ...data.preferences });
        }
      } catch (e) {
        console.warn('[useReportPreferences] failed to upsert:', e);
      }
    },
    []
  );

  const recordLastUsed = useCallback(
    (scope: ReportScope, tier: ReportTier) =>
      update({ last_used_scope: scope, last_used_tier: tier }),
    [update]
  );

  return {
    prefs,
    loading,
    update,
    recordLastUsed,
    effectiveScope: prefs.last_used_scope ?? prefs.default_scope,
    effectiveTier: prefs.last_used_tier ?? prefs.default_tier,
  };
}
