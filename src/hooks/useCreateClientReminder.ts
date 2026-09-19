import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface CreateReminderInput {
  title: string;
  description?: string;
  due_date: string;
  priority: string;
  reminder_type: string;
  assigned_to?: string[];
  created_by?: string;
  client_id?: string | null;
  reminder_scope: 'client' | 'team';
}

/**
 * Creates a reminder from the Reminders Hub — supports both client-linked
 * and standalone team reminders via the `reminder_scope` field.
 */
export function useCreateClientReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateReminderInput) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_reminders',
        data: {
          title: input.title,
          description: input.description || null,
          due_date: input.due_date,
          priority: input.priority,
          reminder_type: input.reminder_type,
          assigned_to: input.assigned_to || [],
          created_by: input.created_by || null,
          client_id: input.client_id || null,
          reminder_scope: input.reminder_scope,
          status: 'pending',
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create reminder');

      // If assigned users, create notifications for them
      if (input.assigned_to && input.assigned_to.length > 0) {
        for (const userId of input.assigned_to) {
          if (userId === input.created_by) continue; // Don't notify creator
          try {
            await invokeSecureFunction('manage-client-data', {
              operation: 'create',
              table: 'notifications',
              data: {
                type: 'client_reminder_due',
                title: `New Reminder: ${input.title}`,
                message: `You have been assigned a reminder due ${new Date(input.due_date).toLocaleDateString('en-AU')}`,
                target_user_id: userId,
                entity_id: input.client_id || null,
                is_read: false,
              },
            });
          } catch {
            // Non-critical — don't block on notification failure
          }
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      queryClient.invalidateQueries({ queryKey: ['team-reminders'] });
    },
  });
}
