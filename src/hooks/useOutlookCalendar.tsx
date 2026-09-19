import { useState, useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/contexts/NotificationsContext';

export interface OutlookEvent {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  bodyPreview: string | null;
  showAs: string;
  organizer: string | null;
  attendees: { email: string; name?: string; status?: string }[];
  categories: string[];
  ownerEmail: string;
  source: 'outlook';
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  status: string;
}

/**
 * What `teamAvailability` sends — availability, never the appointments.
 *
 * This used to declare `events: OutlookEvent[]` and `email: string`, and the
 * function used to send both. Nothing ever rendered either: every consumer
 * reads `username`, `outlookConnected`, `error` and `busySlots`. The events
 * array carried each colleague's `bodyPreview`, `organizer`, `attendees`,
 * `location` and `categories` to any authenticated browser, through an action
 * that had no authorization check at all, so it is no longer sent and no
 * longer declared. `outlookConnected` was always sent and never declared.
 *
 * (`email` on a team member is unrelated to `useTeamUsers()`, which is a
 * different hook and still carries addresses for the attendee picker.)
 */
export interface OutlookTeamMember {
  userId: string;
  username: string;
  outlookConnected: boolean;
  busySlots: { start: string; end: string; title: string; showAs?: string }[];
  error?: string;
}

export interface CreateOutlookEventPayload {
  subject: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  body?: string;
  location?: string;
  attendees?: string[];
  isAllDay?: boolean;
  reminderMinutes?: number;
  showAs?: string;
  categories?: string[];
}

export function useOutlookCalendar() {
  const [outlookEvents, setOutlookEvents] = useState<OutlookEvent[]>([]);
  /**
   * True when Graph still had pages for the requested window and the walk
   * stopped. A calendar cut short reads exactly like a quiet one, so the
   * difference has to be a fact the page can render rather than an absence.
   */
  const [outlookTruncated, setOutlookTruncated] = useState(false);
  const [teamAvailability, setTeamAvailability] = useState<OutlookTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [microsoftEmail, setMicrosoftEmailState] = useState<string | null>(null);
  const [outlookEnabled, setOutlookEnabled] = useState(false);
  const { toast } = useToast();
  const { addNotification } = useNotifications();

  const fetchOutlookEvents = useCallback(async (startTime: string, endTime: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'listEvents',
        startTime,
        endTime,
      });

      if (fetchErr) throw new Error(fetchErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch Outlook events');

      const events = (data.events || []).filter(
        (e: OutlookEvent) => e.startTime && e.endTime,
      );
      setOutlookEvents(events);
      setOutlookTruncated(data.truncated === true);
      setOutlookEnabled(true);
      return events;
    } catch (err: any) {
      console.error('[useOutlookCalendar] fetchOutlookEvents error:', err);
      setError(err.message);
      setOutlookTruncated(false);
      if (!err.message?.includes('No Microsoft email')) {
        toast({
          title: 'Outlook sync failed',
          description: err.message,
          variant: 'destructive',
        });
      }
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const createOutlookEvent = useCallback(async (payload: CreateOutlookEventPayload) => {
    setIsCreating(true);
    try {
      const { data, error: createErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'createEvent',
        ...payload,
      });

      if (createErr) throw new Error(createErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create event');

      if (data.event) {
        setOutlookEvents(prev => [...prev, data.event]);
      }

      toast({
        title: 'Outlook event created',
        description: `"${payload.subject}" added to your Outlook calendar`,
      });

      addNotification({
        type: 'appointment_created',
        title: 'Outlook Event Created',
        message: `"${payload.subject}" added to Outlook calendar`
      });

      return data.event;
    } catch (err: any) {
      console.error('[useOutlookCalendar] createOutlookEvent error:', err);
      toast({
        title: 'Failed to create Outlook event',
        description: err.message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [toast]);

  const updateOutlookEvent = useCallback(async (eventId: string, updates: {
    subject?: string;
    startTime?: string;
    endTime?: string;
    body?: string;
    location?: string;
    showAs?: string;
    categories?: string[];
  }) => {
    try {
      const { data, error: updateErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'updateEvent',
        eventId,
        ...updates,
      });

      if (updateErr) throw new Error(updateErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to update event');

      if (data.event) {
        setOutlookEvents(prev => prev.map(e => e.id === eventId ? data.event : e));
      }

      toast({ title: 'Outlook event updated' });
      return data.event;
    } catch (err: any) {
      toast({
        title: 'Failed to update Outlook event',
        description: err.message,
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  const deleteOutlookEvent = useCallback(async (eventId: string) => {
    try {
      const { data, error: deleteErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'deleteEvent',
        eventId,
      });

      if (deleteErr) throw new Error(deleteErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete event');

      setOutlookEvents(prev => prev.filter(e => e.id !== eventId));
      toast({ title: 'Outlook event deleted' });
      return true;
    } catch (err: any) {
      toast({
        title: 'Failed to delete Outlook event',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    }
  }, [toast]);

  const fetchTeamAvailability = useCallback(async (startTime: string, endTime: string) => {
    try {
      const { data, error: fetchErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'teamAvailability',
        startTime,
        endTime,
      });

      if (fetchErr) throw new Error(fetchErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch team availability');

      setTeamAvailability(data.team || []);
      return data.team || [];
    } catch (err: any) {
      console.error('[useOutlookCalendar] fetchTeamAvailability error:', err);
      return [];
    }
  }, []);

  const getMicrosoftEmail = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction('outlook-calendar', {
        action: 'getMicrosoftEmail',
      });
      const email = data?.microsoftEmail || null;
      setMicrosoftEmailState(email);
      return email;
    } catch {
      return null;
    }
  }, []);

  const setMicrosoftEmail = useCallback(async (email: string | null) => {
    try {
      const { data, error: setErr } = await invokeSecureFunction('outlook-calendar', {
        action: 'setMicrosoftEmail',
        microsoftEmail: email,
      });

      if (setErr) throw new Error(setErr.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to update email');

      setMicrosoftEmailState(email);
      toast({
        title: 'Microsoft email updated',
        description: email ? `Linked to ${email}` : 'Outlook calendar disconnected',
      });
      return true;
    } catch (err: any) {
      toast({
        title: 'Failed to update Microsoft email',
        description: err.message,
        variant: 'destructive',
      });
      return false;
    }
  }, [toast]);

  /**
   * Create a prep block on the user's Outlook calendar before a GHL appointment.
   */
  const createPrepBlock = useCallback(async (opts: {
    appointmentTitle: string;
    appointmentStartTime: string;
    clientName?: string;
    prepMinutes?: number;
    notes?: string;
  }) => {
    const prepMinutes = opts.prepMinutes || 15;
    const prepEnd = new Date(opts.appointmentStartTime);
    const prepStart = new Date(prepEnd.getTime() - prepMinutes * 60 * 1000);

    const subject = `📋 Prep: ${opts.clientName || opts.appointmentTitle}`;
    const body = [
      `Preparation block for upcoming appointment: ${opts.appointmentTitle}`,
      opts.clientName ? `Client: ${opts.clientName}` : '',
      opts.notes ? `Notes: ${opts.notes}` : '',
      '',
      '— Auto-generated',
    ].filter(Boolean).join('\n');

    return createOutlookEvent({
      subject,
      startTime: prepStart.toISOString(),
      endTime: prepEnd.toISOString(),
      body,
      showAs: 'tentative',
      categories: ['Prep Block'],
      reminderMinutes: 5,
    });
  }, [createOutlookEvent]);

  return {
    outlookEvents,
    outlookTruncated,
    teamAvailability,
    isLoading,
    isCreating,
    error,
    outlookEnabled,
    microsoftEmail,
    fetchOutlookEvents,
    createOutlookEvent,
    updateOutlookEvent,
    deleteOutlookEvent,
    fetchTeamAvailability,
    getMicrosoftEmail,
    setMicrosoftEmail,
    createPrepBlock,
  };
}
