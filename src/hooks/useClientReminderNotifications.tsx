import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Hook that monitors client reminders and triggers notifications
 * for reminders that are due today or overdue
 */
export function useClientReminderNotifications() {
  const { addNotification } = useNotifications();
  const processedReminderIds = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string | null>(null);

  useEffect(() => {
    const checkReminders = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      // Only run once per day per session
      if (lastCheckRef.current === todayStr) {
        return;
      }

      try {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Fetch pending reminders that are due today, overdue, OR coming up tomorrow
        const { data: reminders, error } = await supabase
          .from('client_reminders')
          .select(`
            id,
            title,
            due_date,
            priority,
            client_id,
            clients (
              primary_first_name,
              primary_surname
            )
          `)
          .eq('status', 'pending')
          .lte('due_date', tomorrowStr)
          .order('due_date', { ascending: true });

        if (error) {
          console.error('[ReminderNotifications] Error fetching reminders:', error);
          return;
        }

        if (!reminders || reminders.length === 0) {
          lastCheckRef.current = todayStr;
          return;
        }

        for (const reminder of reminders) {
          if (processedReminderIds.current.has(reminder.id)) {
            continue;
          }

          const dueDate = new Date(reminder.due_date);
          dueDate.setHours(0, 0, 0, 0);
          
          const isOverdue = dueDate < today;
          const isDueToday = dueDate.getTime() === today.getTime();
          const isUpcoming = dueDate.getTime() === tomorrow.getTime();
          const client = reminder.clients as any;
          const clientName = client 
            ? `${client.primary_first_name} ${client.primary_surname}`
            : 'Unknown Client';

          processedReminderIds.current.add(reminder.id);

          if (isOverdue) {
            await addNotification({
              type: 'client_reminder_overdue',
              title: `Overdue: ${reminder.title}`,
              message: `Reminder for ${clientName} was due on ${dueDate.toLocaleDateString('en-AU')}`,
              entityId: reminder.client_id
            });
          } else if (isDueToday) {
            await addNotification({
              type: 'client_reminder_due',
              title: `Due Today: ${reminder.title}`,
              message: `Reminder for ${clientName} is due today`,
              entityId: reminder.client_id
            });
          } else if (isUpcoming) {
            await addNotification({
              type: 'client_reminder_upcoming',
              title: `Tomorrow: ${reminder.title}`,
              message: `Reminder for ${clientName} is due tomorrow`,
              entityId: reminder.client_id
            });
          }
        }

        lastCheckRef.current = todayStr;
      } catch (error) {
        console.error('[ReminderNotifications] Error checking reminders:', error);
      }
    };

    // Check on mount
    checkReminders();

    // Also check periodically (every 30 minutes)
    const interval = setInterval(checkReminders, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, [addNotification]);
}
