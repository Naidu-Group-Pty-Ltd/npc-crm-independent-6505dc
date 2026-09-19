import { useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';

/**
 * Creates Outlook calendar blocks when follow-up dates are set on clients.
 * Checks user's outlook settings to see if follow-up blocking is enabled.
 */
export function useFollowUpBlocking() {
  const { toast } = useToast();

  const createFollowUpBlock = useCallback(async (opts: {
    clientName: string;
    followUpDate: string;
    notes?: string;
  }) => {
    try {
      // First check if user has follow-up blocking enabled
      const { data: settingsData } = await invokeSecureFunction('outlook-calendar', {
        action: 'getOutlookSettings',
      });

      if (!settingsData?.success || !settingsData.settings?.followUpBlocking) {
        return null; // Follow-up blocking not enabled
      }

      const duration = settingsData.settings.followUpDefaultDuration || 30;
      
      // Create a block at 9 AM on the follow-up date
      const startTime = new Date(`${opts.followUpDate}T09:00:00`);
      const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

      const { data, error } = await invokeSecureFunction('outlook-calendar', {
        action: 'createEvent',
        subject: `📞 Follow-up: ${opts.clientName}`,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        body: [
          `Follow-up block for client: ${opts.clientName}`,
          opts.notes ? `Notes: ${opts.notes}` : '',
          '',
          '— Auto-generated',
        ].filter(Boolean).join('\n'),
        showAs: 'tentative',
        categories: ['Follow-Up'],
        reminderMinutes: 15,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create follow-up block');

      toast({
        title: 'Follow-up block created',
        description: `Outlook calendar blocked for ${opts.clientName} on ${opts.followUpDate}`,
      });

      return data.event;
    } catch (err: any) {
      // Don't show error toasts for "not configured" — it's expected for users without Outlook
      if (!err.message?.includes('No Microsoft email') && !err.message?.includes('not configured')) {
        console.error('[useFollowUpBlocking] Error:', err);
      }
      return null;
    }
  }, [toast]);

  return { createFollowUpBlock };
}
