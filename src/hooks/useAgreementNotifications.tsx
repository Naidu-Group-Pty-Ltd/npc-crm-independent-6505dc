import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for agency_agreements table.
 * Notifies when new agreements are generated.
 */
export function useAgreementNotifications() {
  const { addNotification } = useNotifications();
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[AgreementNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('agreement-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agency_agreements'
        },
        async (payload) => {
          const agreement = payload.new as any;

          if (processedIds.current.has(agreement.id)) return;
          processedIds.current.add(agreement.id);

          const buyerName = agreement.buyer_names || 'Unknown buyer';

          console.log('[AgreementNotifications] New agreement:', agreement.id);
          await addNotification({
            type: 'agreement_generated',
            title: 'Agreement Generated',
            message: `New agency agreement created for ${buyerName}`,
            entityId: agreement.id
          });
        }
      )
      .subscribe((status) => {
        console.log('[AgreementNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
