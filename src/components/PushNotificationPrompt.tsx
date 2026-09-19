import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getPushSupportStatus,
  getCurrentPushSubscription,
  subscribeToPush,
} from '@/lib/pushNotifications';
import { useToast } from '@/hooks/use-toast';

const PROMPTED_KEY = 'npc:push-prompted-v1';

/**
 * Quietly prompts an authenticated staff user to enable push notifications
 * once per browser. Skipped in preview/iframe contexts.
 */
export function PushNotificationPrompt() {
  const { user } = useAuth();
  const { toast } = useToast();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    if (!user) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(PROMPTED_KEY) === '1') return;

    const status = getPushSupportStatus();
    if (status !== 'default') return; // only nudge first-time users with no decision yet

    hasRun.current = true;
    localStorage.setItem(PROMPTED_KEY, '1');

    // Defer slightly so the toast doesn't fire on first paint
    const timer = window.setTimeout(async () => {
      // Double-check no existing subscription
      const existing = await getCurrentPushSubscription();
      if (existing) return;

      toast({
        title: 'Enable push notifications?',
        description:
          'Get instant alerts for missed calls, new reports and reminders. You can change this anytime in Settings.',
        action: undefined,
        duration: 8000,
      });

      // Trigger the native browser permission prompt right after
      const result = await subscribeToPush();
      if (result.success) {
        toast({ title: 'Push notifications enabled' });
      }
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [user, toast]);

  return null;
}
