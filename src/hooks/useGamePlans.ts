import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

// ─── Types ───
export interface GamePlan {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  status: 'planning' | 'active' | 'completed' | 'archived';
  color: string;
  created_by: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GamePlanPhase {
  id: string;
  plan_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  display_order: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface GamePlanMilestone {
  id: string;
  phase_id: string;
  title: string;
  description: string | null;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  owner: string | null;
  due_date: string | null;
  completed_at: string | null;
  display_order: number;
  created_at: string;
}

export interface GamePlanKPI {
  id: string;
  phase_id: string;
  metric_name: string;
  target_value: number;
  current_value: number;
  unit: string;
  icon: string;
  display_order: number;
  created_at: string;
}

export interface GamePlanNote {
  id: string;
  phase_id: string;
  content: string;
  is_pinned: boolean;
  note_type: 'general' | 'decision' | 'risk' | 'idea';
  created_by: string | null;
  created_at: string;
}

export interface GamePlanAction {
  id: string;
  milestone_id: string | null;
  phase_id: string;
  label: string;
  is_done: boolean;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  display_order: number;
  created_at: string;
}

// ─── Helper ───
async function invoke(body: Record<string, any>) {
  const { data, error } = await invokeSecureFunction('manage-templates', body);
  if (error) throw new Error(error.message);
  return data;
}

// ─── Queries ───
export function useGamePlans() {
  return useQuery({
    queryKey: ['game-plans'],
    queryFn: async () => {
      const data = await invoke({ operation: 'list', table: 'game_plans', listOptions: { orderBy: 'created_at', orderAsc: false } });
      return (data?.records || []) as GamePlan[];
    },
  });
}

export function useGamePlanPhases(planId: string | null) {
  return useQuery({
    queryKey: ['game-plan-phases', planId],
    queryFn: async () => {
      const data = await invoke({ operation: 'list', table: 'game_plan_phases', listOptions: { filters: { plan_id: planId }, orderBy: 'display_order', orderAsc: true } });
      return (data?.records || []) as GamePlanPhase[];
    },
    enabled: !!planId,
  });
}

export function useGamePlanMilestones(phaseIds: string[]) {
  return useQuery({
    queryKey: ['game-plan-milestones', phaseIds],
    queryFn: async () => {
      if (!phaseIds.length) return [];
      const data = await invoke({ operation: 'list', table: 'game_plan_milestones', listOptions: { orderBy: 'display_order', orderAsc: true, limit: 500 } });
      const all = (data?.records || []) as GamePlanMilestone[];
      return all.filter(m => phaseIds.includes(m.phase_id));
    },
    enabled: phaseIds.length > 0,
  });
}

export function useGamePlanKPIs(phaseIds: string[]) {
  return useQuery({
    queryKey: ['game-plan-kpis', phaseIds],
    queryFn: async () => {
      if (!phaseIds.length) return [];
      const data = await invoke({ operation: 'list', table: 'game_plan_kpis', listOptions: { orderBy: 'display_order', orderAsc: true, limit: 500 } });
      const all = (data?.records || []) as GamePlanKPI[];
      return all.filter(k => phaseIds.includes(k.phase_id));
    },
    enabled: phaseIds.length > 0,
  });
}

export function useGamePlanNotes(phaseIds: string[]) {
  return useQuery({
    queryKey: ['game-plan-notes', phaseIds],
    queryFn: async () => {
      if (!phaseIds.length) return [];
      const data = await invoke({ operation: 'list', table: 'game_plan_notes', listOptions: { orderBy: 'created_at', orderAsc: false, limit: 500 } });
      const all = (data?.records || []) as GamePlanNote[];
      return all.filter(n => phaseIds.includes(n.phase_id));
    },
    enabled: phaseIds.length > 0,
  });
}

export function useGamePlanActions(phaseIds: string[]) {
  return useQuery({
    queryKey: ['game-plan-actions', phaseIds],
    queryFn: async () => {
      if (!phaseIds.length) return [];
      const data = await invoke({ operation: 'list', table: 'game_plan_actions', listOptions: { orderBy: 'display_order', orderAsc: true, limit: 500 } });
      const all = (data?.records || []) as GamePlanAction[];
      return all.filter(a => phaseIds.includes(a.phase_id));
    },
    enabled: phaseIds.length > 0,
  });
}

// ─── Mutations ───
export function useGamePlanMutations() {
  const qc = useQueryClient();

  const mut = <T>(table: string, queryKeys: string[]) => ({
    create: useMutation({
      mutationFn: async (data: Partial<T>) => invoke({ operation: 'insert', table, data }),
      onSuccess: () => { queryKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] })); },
      onError: (e: Error) => toast.error(e.message),
    }),
    update: useMutation({
      mutationFn: async ({ id, ...data }: { id: string } & Partial<T>) => invoke({ operation: 'update', table, recordId: id, data }),
      onSuccess: () => { queryKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] })); },
      onError: (e: Error) => toast.error(e.message),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => invoke({ operation: 'delete', table, recordId: id }),
      onSuccess: () => { queryKeys.forEach(k => qc.invalidateQueries({ queryKey: [k] })); },
      onError: (e: Error) => toast.error(e.message),
    }),
  });

  return {
    plans: mut<GamePlan>('game_plans', ['game-plans']),
    phases: mut<GamePlanPhase>('game_plan_phases', ['game-plan-phases']),
    milestones: mut<GamePlanMilestone>('game_plan_milestones', ['game-plan-milestones']),
    kpis: mut<GamePlanKPI>('game_plan_kpis', ['game-plan-kpis']),
    notes: mut<GamePlanNote>('game_plan_notes', ['game-plan-notes']),
    actions: mut<GamePlanAction>('game_plan_actions', ['game-plan-actions']),
  };
}
