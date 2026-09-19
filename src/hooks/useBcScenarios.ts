/**
 * useBcScenarios — Phase K6
 * Persistence layer for Borrowing Capacity strategy scenarios.
 * - Loads, saves, and deletes scenarios via the secure `manage-bc-scenarios` edge function.
 * - Maps DB rows to the in-memory ScenarioPreset shape used by StrategyScenarioModeling.
 *
 * Note: Sets/Maps inside ScenarioPreset payloads are auto-serialised because
 * we save the whole preset (already produced by the UI) into the `payload` JSONB
 * column. We round-trip the payload as plain JSON, so consumers should pass it
 * straight back into setState as-is.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import type { ScenarioPreset } from '@/components/borrowing-capacity/scenarios/StrategyScenarioModeling';

interface BcScenarioRow {
  id: string;
  client_id: string;
  name: string;
  is_base: boolean;
  payload: ScenarioPreset; // we store the whole preset
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeScenarioPreset(raw: Partial<ScenarioPreset> | null | undefined): ScenarioPreset {
  const preset = (raw || {}) as Partial<ScenarioPreset>;
  const fallbackResult = {
    borrowingCapacity: 0,
    monthlySurplus: 0,
    serviceabilityBand: 'red',
    stressTestedCapacity: 0,
    capacityChange: { absolute: 0, percentage: 0 },
  } as unknown as ScenarioPreset['result'];


  return {
    ...(preset as ScenarioPreset),
    id: preset.id || `scenario-${Date.now()}`,
    name: preset.name || 'Untitled Scenario',
    isBase: !!preset.isBase,
    createdAt: preset.createdAt || new Date().toISOString(),
    adjustedInputs: (preset.adjustedInputs || {}) as ScenarioPreset['adjustedInputs'],
    result: (preset.result || fallbackResult) as ScenarioPreset['result'],
    scenarioDeltas: Array.isArray(preset.scenarioDeltas) ? preset.scenarioDeltas : [],
    validationIssues: Array.isArray(preset.validationIssues) ? preset.validationIssues : [],
    capitalAllocations: Array.isArray(preset.capitalAllocations) ? preset.capitalAllocations : [],
    acquisitionCapacity: preset.acquisitionCapacity
      ? {
          ...preset.acquisitionCapacity,
          notes: Array.isArray(preset.acquisitionCapacity.notes) ? preset.acquisitionCapacity.notes : [],
        }
      : preset.acquisitionCapacity,
  };
}

export interface UseBcScenariosOptions {
  clientId: string | undefined;
  enabled?: boolean;
}

export function useBcScenarios({ clientId, enabled = true }: UseBcScenariosOptions) {
  const [scenarios, setScenarios] = useState<ScenarioPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── LIST ──────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!clientId || !enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await invokeSecureFunction('manage-bc-scenarios', {
        operation: 'list',
        clientId,
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to list scenarios');

      const rows: BcScenarioRow[] = data.items || [];
      // Re-hydrate presets from payload, attaching DB id (in case caller wants it).
      const presets: ScenarioPreset[] = rows.map((r) => normalizeScenarioPreset({
        ...(r.payload || ({} as ScenarioPreset)),
        id: r.id, // override with DB id so deletes target the correct row
        name: r.name,
        isBase: r.is_base,
        createdAt: r.created_at,
      }));
      setScenarios(presets);
    } catch (err: any) {
      console.error('[useBcScenarios] reload failed:', err);
      setError(err?.message || 'Failed to load scenarios');
    } finally {
      setIsLoading(false);
    }
  }, [clientId, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── CREATE ─────────────────────────────────────────────
  const saveScenario = useCallback(
    async (preset: ScenarioPreset): Promise<ScenarioPreset | null> => {
      const normalizedPreset = normalizeScenarioPreset(preset);
      if (!clientId) {
        toast.error('Cannot save scenario without a client');
        return null;
      }
      setIsMutating(true);
      try {
        const { data, error: invokeError } = await invokeSecureFunction('manage-bc-scenarios', {
          operation: 'create',
          clientId,
          data: {
            name: normalizedPreset.name,
            is_base: !!normalizedPreset.isBase,
            payload: normalizedPreset, // store the whole preset
          },
        });
        if (invokeError) throw new Error(invokeError.message);
        if (!data?.success) throw new Error(data?.error || 'Failed to save scenario');

        const row: BcScenarioRow = data.item;
        const saved: ScenarioPreset = {
          ...(row.payload || normalizedPreset),
          id: row.id,
          name: row.name,
          isBase: row.is_base,
          createdAt: row.created_at,
        };
        const normalizedSaved = normalizeScenarioPreset(saved);
        setScenarios((prev) => {
          // If this is a new base, replace any existing base
          const filtered = normalizedSaved.isBase ? prev.filter((p) => !p.isBase) : prev;
          return [normalizedSaved, ...filtered.map(normalizeScenarioPreset)];
        });
        if (!normalizedSaved.isBase) toast.success(`Scenario "${normalizedSaved.name}" saved`);
        return normalizedSaved;
      } catch (err: any) {
        console.error('[useBcScenarios] save failed:', err);
        toast.error(`Save failed: ${err?.message || 'Unknown error'}`);
        return null;
      } finally {
        setIsMutating(false);
      }
    },
    [clientId]
  );

  // ── DELETE ─────────────────────────────────────────────
  const deleteScenario = useCallback(async (id: string): Promise<boolean> => {
    setIsMutating(true);
    try {
      const { data, error: invokeError } = await invokeSecureFunction('manage-bc-scenarios', {
        operation: 'delete',
        recordId: id,
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete scenario');

      setScenarios((prev) => prev.filter((p) => p.id !== id));
      toast.success('Scenario deleted');
      return true;
    } catch (err: any) {
      console.error('[useBcScenarios] delete failed:', err);
      toast.error(`Delete failed: ${err?.message || 'Unknown error'}`);
      return false;
    } finally {
      setIsMutating(false);
    }
  }, []);

  return {
    scenarios,
    setScenarios, // exposed so the UI can do optimistic in-memory updates (e.g. base preset auto-creation)
    isLoading,
    isMutating,
    error,
    reload,
    saveScenario,
    deleteScenario,
  };
}
