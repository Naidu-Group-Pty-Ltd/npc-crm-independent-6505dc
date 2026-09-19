import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for client_portal_report_requests table.
 * Notifies the internal team when a client submits a new report request.
 */
export function usePortalReportRequestNotifications() {
  const { addNotification } = useNotifications();
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[PortalReportRequestNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('portal-report-request-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'client_portal_report_requests'
        },
        async (payload) => {
          const request = payload.new as any;

          if (processedIds.current.has(request.id)) return;
          processedIds.current.add(request.id);

          const requestType = (request.request_type || 'report')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());

          // Try to resolve client name for a more informative notification
          let clientLabel = 'A client';
          if (request.client_id) {
            try {
              const { data: clientData } = await supabase
                .from('clients')
                .select('primary_first_name, primary_surname')
                .eq('id', request.client_id)
                .maybeSingle();
              if (clientData) {
                const name = `${clientData.primary_first_name || ''} ${clientData.primary_surname || ''}`.trim();
                if (name) clientLabel = name;
              }
            } catch (e) {
              console.warn('[PortalReportRequestNotifications] Could not resolve client name:', e);
            }
          }

          console.log('[PortalReportRequestNotifications] New request:', request.id);
          await addNotification({
            type: 'portal_report_requested',
            title: 'New Report Request',
            message: `${clientLabel} has requested a ${requestType}`,
            entityId: request.id
          });
        }
      )
      .subscribe((status) => {
        console.log('[PortalReportRequestNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
