import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for investment_reports table.
 * Fires notifications when reports complete or fail generation.
 */
export function useReportNotifications() {
  const { addNotification } = useNotifications();
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[ReportNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('report-status-notifications')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'investment_reports'
        },
        async (payload) => {
          const report = payload.new as any;
          const oldReport = payload.old as any;

          // Only fire when status actually changed
          if (report.status === oldReport.status) return;

          const key = `${report.id}-${report.status}`;
          if (processedIds.current.has(key)) return;
          processedIds.current.add(key);

          const address = report.property_address || 'Unknown property';

          if (report.status === 'completed' && oldReport.status === 'pending') {
            console.log('[ReportNotifications] Report completed:', report.id);
            await addNotification({
              type: 'report_generation_completed',
              title: 'Report Ready',
              message: `Investment report for ${address} is ready to view`,
              entityId: report.id
            });
          } else if (report.status === 'failed') {
            console.log('[ReportNotifications] Report failed:', report.id);
            await addNotification({
              type: 'report_generation_failed',
              title: 'Report Generation Failed',
              message: `Failed to generate report for ${address}`,
              entityId: report.id
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('[ReportNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
