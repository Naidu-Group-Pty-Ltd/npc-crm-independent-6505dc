import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface TeamReminder {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  priority: string;
  status: string;
  reminder_type: string;
  assigned_to: string[] | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  reminder_scope: string;
  client_id: string | null;
}

export function useTeamReminders() {
  return useQuery({
    queryKey: ['team-reminders'],
    queryFn: async (): Promise<TeamReminder[]> => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_reminders',
          select: '*',
          orderBy: 'due_date',
          orderAsc: true,
          filters: { reminder_scope: 'team' },
        },
      });

      if (error) throw error;
      const records = data?.records || [];
      // Filter out completed
      return records.filter((r: any) => r.status !== 'completed');
    },
    staleTime: 30000,
  });
}

export function useCreateTeamReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminder: {
      title: string;
      description?: string;
      due_date: string;
      priority: string;
      reminder_type: string;
      assigned_to: string[];
      created_by?: string;
    }) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_reminders',
        data: {
          ...reminder,
          reminder_scope: 'team',
          status: 'pending',
          client_id: null,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create team reminder');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
    },
  });
}

export function useCompleteTeamReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminderId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_reminders',
        recordId: reminderId,
        data: {
          status: 'completed',
          completed_at: new Date().toISOString(),
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to complete reminder');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
    },
  });
}

export function useDeleteTeamReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminderId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_reminders',
        recordId: reminderId,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to delete reminder');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
    },
  });
}
