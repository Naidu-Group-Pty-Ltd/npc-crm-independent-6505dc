import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useAuth } from '@/hooks/useAuth';

export interface AssignedTask {
  id: string;
  title: string;
  source: 'game_plan' | 'reminder';
  sourceLabel: string;
  sourceContext?: string; // e.g. plan name, client name
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  rawRecord: any;
}

async function invoke(body: Record<string, any>) {
  const { data, error } = await invokeSecureFunction('manage-templates', body);
  if (error) throw new Error(error.message);
  return data;
}

export function useAssignedTasks() {
  const { user } = useAuth();
  const userId = user?.id;
  const username = (user as { username?: string } | null)?.username;
  const email = (user as { email?: string } | null)?.email;

  return useQuery({
    queryKey: ['assigned-tasks', userId, username, email],
    queryFn: async (): Promise<AssignedTask[]> => {
      if (!userId) return [];

      // Game plan assignment stores the USERNAME (UserSelectField's value is
      // user.username) while this hook used to demand the user id — so a
      // task assigned to "Arvin" never matched Arvin's UUID and the tab
      // stayed empty for everyone. Accept any identity the row could carry.
      const myIdentities = [userId, username, email]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map((v) => v.trim().toLowerCase());
      const isMine = (assignedTo: unknown): boolean =>
        typeof assignedTo === 'string' && myIdentities.includes(assignedTo.trim().toLowerCase());

      const now = new Date();
      const tasks: AssignedTask[] = [];

      // 1. Fetch game plan actions assigned to user
      const [actionsResult, remindersResult, plansResult, phasesResult] = await Promise.all([
        invoke({
          operation: 'list',
          table: 'game_plan_actions',
          listOptions: { orderBy: 'created_at', orderAsc: false, limit: 500 },
        }),
        invoke({
          operation: 'list',
          table: 'client_reminders',
          listOptions: { orderBy: 'due_date', orderAsc: true, limit: 500 },
        }),
        invoke({
          operation: 'list',
          table: 'game_plans',
          listOptions: { orderBy: 'created_at', orderAsc: false, limit: 200 },
        }),
        invoke({
          operation: 'list',
          table: 'game_plan_phases',
          listOptions: { orderBy: 'display_order', orderAsc: true, limit: 500 },
        }),
      ]);

      // Build lookup maps for context
      const plansMap = new Map<string, string>();
      (plansResult?.records || []).forEach((p: any) => plansMap.set(p.id, p.name));

      const phasesMap = new Map<string, { name: string; plan_id: string }>();
      (phasesResult?.records || []).forEach((p: any) =>
        phasesMap.set(p.id, { name: p.name, plan_id: p.plan_id })
      );

      // Process game plan actions
      const actions = (actionsResult?.records || []) as any[];
      actions
        .filter((a: any) => isMine(a.assigned_to))
        .forEach((a: any) => {
          const phase = phasesMap.get(a.phase_id);
          const planName = phase ? plansMap.get(phase.plan_id) : undefined;
          const isOverdue = !a.is_done && a.due_date && new Date(a.due_date) < now;

          tasks.push({
            id: `gpa_${a.id}`,
            title: a.label,
            source: 'game_plan',
            sourceLabel: 'Game Plan Action',
            sourceContext: [planName, phase?.name].filter(Boolean).join(' → '),
            status: a.is_done ? 'completed' : isOverdue ? 'overdue' : 'pending',
            priority: undefined,
            dueDate: a.due_date,
            completedAt: a.completed_at,
            createdAt: a.created_at,
            rawRecord: a,
          });
        });

      // Process reminders (assigned_to is an array)
      const reminders = (remindersResult?.records || []) as any[];
      reminders
        .filter((r: any) => Array.isArray(r.assigned_to) && r.assigned_to.some(isMine))
        .forEach((r: any) => {
          const isOverdue =
            r.status !== 'completed' && r.due_date && new Date(r.due_date) < now;

          tasks.push({
            id: `rem_${r.id}`,
            title: r.title,
            source: 'reminder',
            sourceLabel: 'Reminder',
            sourceContext: r.reminder_type ? `${r.reminder_type}` : undefined,
            status: r.status === 'completed' ? 'completed' : isOverdue ? 'overdue' : r.status === 'in_progress' ? 'in_progress' : 'pending',
            priority: r.priority as AssignedTask['priority'],
            dueDate: r.due_date,
            completedAt: r.completed_at,
            createdAt: r.created_at,
            rawRecord: r,
          });
        });

      // Sort: overdue first, then by due date, then pending, then completed
      const statusOrder = { overdue: 0, pending: 1, in_progress: 1, completed: 2 };
      tasks.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 1;
        const sb = statusOrder[b.status] ?? 1;
        if (sa !== sb) return sa - sb;
        if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return tasks;
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  });
}
