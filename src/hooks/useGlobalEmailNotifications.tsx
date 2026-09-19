import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Global realtime listener for incoming emails (email_copilot_emails).
 * 
 * Bell notifications are created SERVER-SIDE by the edge functions
 * (outlook-email-sync, email-sync-cron, outlook-email-webhook).
 * The NotificationsContext realtime subscription on the `notifications` table
 * picks them up automatically.
 * 
 * This hook only handles batched toast notifications for UX feedback
 * when new emails arrive while the app is open.
 */
export function useGlobalEmailNotifications() {
  const batchRef = useRef<any[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBatch = useCallback(() => {
    const batch = batchRef.current;
    batchRef.current = [];
    batchTimerRef.current = null;

    if (batch.length === 0) return;

    if (batch.length === 1) {
      const email = batch[0];
      const senderName = email.sender?.split('<')[0]?.trim() || email.sender?.split('@')[0] || 'Unknown';
      toast.info(`New email from ${senderName}`, {
        description: email.subject || 'No subject',
        duration: 4000
      });
    } else {
      toast.info(`${batch.length} new emails received`, {
        description: 'Check your inbox for details',
        duration: 5000
      });
    }
  }, []);

  useEffect(() => {
    console.log('[GlobalEmailNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('global-email-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'email_copilot_emails'
        },
        (payload) => {
          const email = payload.new as any;

          // Only notify for received emails, not sent ones
          if (email.folder === 'sentItems' || email.folder === 'drafts' || email.folder === 'sent') return;

          console.log('[GlobalEmailNotifications] New email:', email.id);

          // Add to batch
          batchRef.current.push(email);

          // Reset debounce timer — flush after 3 seconds of no new emails
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current);
          }
          batchTimerRef.current = setTimeout(flushBatch, 3000);
        }
      )
      .subscribe((status) => {
        console.log('[GlobalEmailNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [flushBatch]);
}
