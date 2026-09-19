import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for lead_source_attributions table.
 * Notifies when new marketing leads come in (UTM/Meta attributed).
 */
export function useMarketingLeadNotifications() {
  const { addNotification } = useNotifications();
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[MarketingLeadNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('marketing-lead-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_source_attributions'
        },
        async (payload) => {
          const attribution = payload.new as any;

          if (processedIds.current.has(attribution.id)) return;
          processedIds.current.add(attribution.id);

          const source = attribution.utm_source || attribution.ghl_attribution_source || 'Unknown';
          const campaign = attribution.utm_campaign || attribution.meta_campaign_name || '';
          const message = campaign
            ? `New lead from ${source} — ${campaign}`
            : `New lead attributed to ${source}`;

          console.log('[MarketingLeadNotifications] New lead:', attribution.id);
          await addNotification({
            type: 'new_marketing_lead',
            title: 'New Marketing Lead',
            message,
            entityId: attribution.client_id
          });
        }
      )
      .subscribe((status) => {
        console.log('[MarketingLeadNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
