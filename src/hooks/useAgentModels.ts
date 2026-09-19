/**
 * React Query hook that returns the live agent_model_assignments rows the
 * UI needs to render "which model is powering this feature" chips.
 *
 * Data source: `agent-models-read` edge function (service-role read),
 * cached with @tanstack/react-query and kept fresh by a single Postgres
 * realtime subscription on `agent_model_assignments`. When the Model Hub
 * updates an assignment, every consumer re-renders within a heartbeat.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { AGENT_SURFACES, type AgentSurfaceId, findSurfaceByKey } from '@/lib/agentModels/agentKeys';
import { formatModelDisplay, type ModelDisplay } from '@/lib/agentModels/modelDisplay';


export type AgentAssignment = {
  agent_key: string;
  agent_label: string;
  agent_category: string;
  agent_description: string | null;
  route: string;
  model_id: string;
  fallback_chain: Array<{ route: string; model_id: string }>;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
  is_locked: boolean;
  last_used_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type ResolvedSlot = {
  agentKey: string;
  slotLabel: string;
  slotDescription?: string;
  surfaceLabel?: string;
  assignment: AgentAssignment | null;
  display: ModelDisplay;
};


const QUERY_KEY = ['agent-model-assignments'] as const;

// ---- Pulse registry (Phase 5 write-path sync) ---------------------------
// Records the last time each agent_key received a realtime model_id change,
// so consumer components (LiveModelBadge) can briefly flash to signal that
// the Model Hub just repointed them.
const pulseMap = new Map<string, number>();
const pulseListeners = new Set<() => void>();
function pulse(agentKey: string) {
  pulseMap.set(agentKey, Date.now());
  pulseListeners.forEach((fn) => fn());
}
export function subscribeAgentPulse(listener: () => void) {
  pulseListeners.add(listener);
  return () => pulseListeners.delete(listener);
}
export function getAgentPulse(agentKey: string): number | undefined {
  return pulseMap.get(agentKey);
}

let sharedChannel: ReturnType<typeof supabase.channel> | null = null;
let subscribers = 0;

async function fetchAssignments(): Promise<AgentAssignment[]> {
  const { data, error } = await invokeSecureFunction<any>('agent-models-read', { action: 'list' });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to load model assignments');
  return (data.assignments ?? []) as AgentAssignment[];
}


/**
 * Root hook — fetches every assignment once, keeps them in sync via
 * realtime, and exposes selector helpers. Cheap to call from many
 * components because @tanstack/react-query dedupes the request.
 */
export function useAgentModels() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAssignments,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Track previous assignments so we can diff realtime payloads once and
  // toast only when a model_id actually changes.
  const prevByKey = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    (query.data ?? []).forEach((row) => next.set(row.agent_key, row.model_id));
    prevByKey.current = next;
  }, [query.data]);

  useEffect(() => {
    if (subscribers === 0) {
      sharedChannel = supabase
        .channel('agent-model-assignments-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'agent_model_assignments' },
          (payload: any) => {
            const newRow = payload?.new as AgentAssignment | undefined;
            const oldRow = payload?.old as AgentAssignment | undefined;
            if (newRow?.agent_key && oldRow?.model_id && newRow.model_id !== oldRow.model_id) {
              pulse(newRow.agent_key);
              const surface = findSurfaceByKey(newRow.agent_key);
              const label = surface
                ? `${surface.surface.label} · ${surface.slot.slotLabel}`
                : newRow.agent_label || newRow.agent_key;
              const nice = formatModelDisplay(newRow.model_id).shortLabel;
              toast.success(`Model updated: ${label}`, {
                description: `Now routing through ${nice}.`,
                duration: 4000,
              });
            } else if (newRow?.agent_key) {
              pulse(newRow.agent_key);
            }
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          },
        )
        .subscribe();
    }
    subscribers += 1;
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && sharedChannel) {
        supabase.removeChannel(sharedChannel);
        sharedChannel = null;
      }
    };
  }, [queryClient]);

  const byKey = useMemo(() => {
    const map = new Map<string, AgentAssignment>();
    (query.data ?? []).forEach((row) => map.set(row.agent_key, row));
    return map;
  }, [query.data]);

  return {
    ...query,
    assignments: query.data ?? [],
    byKey,
    /** Force a refetch — called by the Model Hub after a successful update. */
    invalidate: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  };

}

/** Resolve a single agent_key into a display-ready slot record. */
export function useAgentModel(agentKey: string): ResolvedSlot {
  const { byKey } = useAgentModels();
  const assignment = byKey.get(agentKey) ?? null;
  const meta = findSurfaceByKey(agentKey);
  return {
    agentKey,
    slotLabel: meta?.slot.slotLabel ?? 'Primary',
    slotDescription: meta?.slot.slotDescription,
    surfaceLabel: meta?.surface.label,
    assignment,
    display: formatModelDisplay(assignment?.model_id),
  };
}


/** Resolve every slot on a surface (e.g. Report Q&A → 4 slots). */
export function useAgentSurface(surfaceId: AgentSurfaceId): {
  surface: (typeof AGENT_SURFACES)[AgentSurfaceId];
  slots: ResolvedSlot[];
  isLoading: boolean;
} {
  const { byKey, isLoading } = useAgentModels();
  const surface = AGENT_SURFACES[surfaceId];
  const slots = useMemo(
    () =>
      surface.slots.map((slot) => {
        const assignment = byKey.get(slot.key) ?? null;
        return {
          agentKey: slot.key,
          slotLabel: slot.slotLabel,
          slotDescription: slot.slotDescription,
          surfaceLabel: surface.label,
          assignment,
          display: formatModelDisplay(assignment?.model_id),
        };

      }),
    [byKey, surface],
  );
  return { surface, slots, isLoading };
}
