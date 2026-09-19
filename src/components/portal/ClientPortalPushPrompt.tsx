import { useEffect } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import {
  getPushSupportStatus,
  getCurrentPushSubscription,
  subscribeClientPortalToPush,
} from '@/lib/clientPortalPushNotifications';
import { useToast } from '@/hooks/use-toast';

const PROMPTED_KEY = 'npc:portal-push-prompted-v1';

/**
 * Quietly prompts an authenticated client portal user to enable push notifications
 * once per browser. Skipped in preview/iframe contexts.
 */
export function ClientPortalPushPrompt() {
  const { user } = usePortalAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(PROMPTED_KEY) === '1') return;

    const status = getPushSupportStatus();
    if (status !== 'default') return;

    const timer = window.setTimeout(async () => {
      const existing = await getCurrentPushSubscription();
      if (existing) return;

      toast({
        title: 'Enable push notifications?',
        description:
          'Get instant alerts for new messages, deal updates and document requests. You can change this later.',
      });
      try { localStorage.setItem(PROMPTED_KEY, '1'); } catch { /* noop */ }

      const result = await subscribeClientPortalToPush();
      if (result.success) {
        toast({ title: 'Push notifications enabled' });
      }
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [user, toast]);

  return null;
}
