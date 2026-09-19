import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { addHours, addDays, addWeeks } from 'date-fns';

interface UpdateReminderInput {
  id: string;
  title?: string;
  description?: string;
  due_date?: string;
  priority?: string;
  reminder_type?: string;
  assigned_to?: string[];
  status?: string;
  completed_at?: string | null;
}

export function useUpdateReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateReminderInput) => {
      const { id, ...updates } = input;
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_reminders',
        recordId: id,
        data: updates,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update reminder');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
    },
  });
}

export type SnoozeDuration = '1h' | '1d' | '3d' | '1w' | 'custom';

export function useSnoozeReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, duration, customDate }: { id: string; duration: SnoozeDuration; customDate?: Date }) => {
      let newDate: Date;

      if (duration === 'custom' && customDate) {
        newDate = customDate;
      } else {
        const now = new Date();
        switch (duration) {
          case '1h': newDate = addHours(now, 1); break;
          case '1d': newDate = addDays(now, 1); break;
          case '3d': newDate = addDays(now, 3); break;
          case '1w': newDate = addWeeks(now, 1); break;
          default: throw new Error('Invalid snooze duration');
        }
      }

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_reminders',
        recordId: id,
        data: {
          due_date: newDate.toISOString(),
          status: 'pending', // Reset from snoozed to pending
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to snooze reminder');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
    },
  });
}
