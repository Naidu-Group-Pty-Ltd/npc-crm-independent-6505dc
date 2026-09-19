/**
 * Which integrations actually have credentials saved.
 *
 * The Workflow Playground uses this to tell you a step cannot run *before* you
 * run it. It reads the same `integration_configs` rows the Integrations page
 * writes, and applies the same rule that page uses for its status badge: an
 * integration counts as configured when every field marked required has a
 * non-empty value.
 *
 * Optional fields are deliberately ignored. A workflow that only needs
 * `SLACK_BOT_TOKEN` should not be blocked because nobody set a default channel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { INTEGRATIONS } from '@/lib/integrations/registry';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface IntegrationConfigRow {
  key_name?: string;
  key_value?: string | null;
}

export interface IntegrationCredentialState {
  /** Integration ids whose required fields are all filled in. */
  configured: Set<string>;
  /** Field keys with a saved non-empty value. */
  savedKeys: Set<string>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useIntegrationCredentials(): IntegrationCredentialState {
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: invokeError } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'integration_configs',
      });

      if (invokeError) {
        setError(invokeError.message ?? 'Could not read integration credentials.');
        return;
      }

      const keys = new Set<string>();
      for (const row of (data?.records ?? []) as IntegrationConfigRow[]) {
        if (row.key_name && typeof row.key_value === 'string' && row.key_value.trim() !== '') {
          keys.add(row.key_name);
        }
      }
      setSavedKeys(keys);
      setError(null);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read integration credentials.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configured = useMemo(() => {
    const ready = new Set<string>();
    for (const integration of INTEGRATIONS) {
      const required = integration.fields.filter((field) => field.required !== false);
      // An integration with no required fields cannot be proven unconfigured.
      if (required.length === 0 || required.every((field) => savedKeys.has(field.key))) {
        ready.add(integration.id);
      }
    }
    return ready;
  }, [savedKeys]);

  return { configured, savedKeys, loaded, loading, error, refresh };
}
