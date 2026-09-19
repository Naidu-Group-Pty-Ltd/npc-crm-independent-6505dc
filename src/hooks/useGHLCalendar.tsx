import { useState, useCallback, useRef } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/contexts/NotificationsContext';
import { formatInSydney, formatDateInSydney } from '@/lib/timezoneUtils';
import { FALLBACK_CALENDAR_COLOR, buildCalendarColorMap, resolveCalendarColor } from '@/lib/calendarColors';


export interface GHLTeamMember {
  userId: string;
  name?: string;
  email?: string;
}

export interface GHLCalendar {
  id: string;
  name: string;
  description?: string;
  calendarType: string;
  isActive: boolean;
  teamMembers?: GHLTeamMember[];
  slug?: string;
  eventColor?: string;
}

export interface GHLEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  calendarName?: string;
  calendarColor?: string;
  status: string;
  appointmentStatus?: string;
  contactId?: string;
  notes?: string;
  address?: string;
}

export interface GHLContact {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface GHLCalendarGroup {
  id: string;
  name: string;
  description?: string;
  calendarIds?: string[];
}

export interface GHLFreeSlot {
  startTime: string;
  endTime: string;
}

interface CalendarData {
  success?: boolean;
  error?: string;
  details?: unknown;
  calendars?: GHLCalendar[];
  events?: unknown[];
  dateRange?: {
    start: string;
    end: string;
  };
  /**
   * Calendars the fan-out could not read this request.
   *
   * Added to `ghl-calendar`'s two responses when the fan-outs stopped
   * swallowing a failed calendar, and read by `setFailedCalendars` below —
   * but never declared here, so the read was a TS2339 the whole time. It did
   * not break the page, because Vite strips types rather than checking them,
   * and CI's typecheck does not see `src/`.
   */
  failedCalendars?: string[];
}

const normalizeTimestampToISO = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Handle numeric timestamps that arrive as strings
    if (/^\d+$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      return Number.isNaN(asNumber) ? null : normalizeTimestampToISO(asNumber);
    }

    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }

  // Some GHL responses may return timestamps as objects (docs label startTime/endTime as "object")
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const candidates = [
      obj.dateTime,
      obj.date,
      obj.value,
      obj.time,
      obj.timestamp,
      obj.iso,
      obj.startTime,
      obj.endTime,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeTimestampToISO(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
};

const normalizeEvent = (raw: any): GHLEvent | null => {
  const start = normalizeTimestampToISO(raw?.startTime);
  const end = normalizeTimestampToISO(raw?.endTime);
  if (!start || !end) return null;

  return {
    id: String(raw?.id ?? ''),
    title: typeof raw?.title === 'string' ? raw.title : String(raw?.title ?? ''),
    startTime: start,
    endTime: end,
    calendarId: String(raw?.calendarId ?? ''),
    calendarName: typeof raw?.calendarName === 'string' ? raw.calendarName : undefined,
    calendarColor: typeof raw?.calendarColor === 'string' ? raw.calendarColor : undefined,
    status: typeof raw?.status === 'string' ? raw.status : String(raw?.status ?? ''),
    appointmentStatus:
      typeof raw?.appointmentStatus === 'string' ? raw.appointmentStatus : undefined,
    contactId: typeof raw?.contactId === 'string' ? raw.contactId : undefined,
    notes: typeof raw?.notes === 'string' ? raw.notes : undefined,
    address: typeof raw?.address === 'string' ? raw.address : undefined,
  };
};

export function useGHLCalendar() {
  const [calendars, setCalendars] = useState<GHLCalendar[]>([]);
  const [events, setEvents] = useState<GHLEvent[]>([]);
  const [calendarGroups, setCalendarGroups] = useState<GHLCalendarGroup[]>([]);
  /**
   * Calendars GoHighLevel refused to answer for on the last load.
   *
   * One calendar failing must not blank the page, so the edge function returns
   * the ones that worked — but a failed calendar and a calendar with nothing
   * booked drew exactly the same empty column, under a response that still
   * said `success: true`. Naming them is the only way a reader can tell those
   * two apart.
   */
  const [failedCalendars, setFailedCalendars] = useState<string[]>([]);
  const [contactCache, setContactCache] = useState<Map<string, GHLContact>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Colour is assigned per calendar (see lib/calendarColors) and held here so events
  // fetched without their calendar list still resolve to the same swatch.
  const calendarColorMapRef = useRef<Map<string, string>>(new Map());

  const { toast } = useToast();
  const { addNotification } = useNotifications();

  const lastRangeRef = useRef<{ startTime?: string; endTime?: string; calendarId?: string }>({});

  const fetchCalendarData = useCallback(async (
    startTime?: string,
    endTime?: string,
    calendarId?: string
  ) => {
    // Remember what the view is showing. A newly created appointment has to
    // be re-read over the SAME window, or it lands outside the range that is
    // on screen and looks like it was never created.
    lastRangeRef.current = { startTime, endTime, calendarId };
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await invokeSecureFunction<CalendarData>('ghl-calendar', {
        action: 'all', startTime, endTime, calendarId,
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (data?.success === false) {
        throw new Error(data.error || 'Failed to fetch calendar data');
      }

      if (data?.calendars) {
        // Normalize calendars to ensure all fields are primitive values (no nested objects)
        const normalizedCalendars: GHLCalendar[] = data.calendars.map((cal: any) => ({
          id: String(cal.id || ''),
          name: String(cal.name || ''),
          description: cal.description ? String(cal.description) : undefined,
          calendarType: String(cal.calendarType || ''),
          isActive: Boolean(cal.isActive),
          teamMembers: Array.isArray(cal.teamMembers) ? cal.teamMembers.map((tm: any) => ({ userId: String(tm.userId || tm.id || ''), name: tm.name || tm.firstName || undefined, email: tm.email || undefined })) : undefined,
          slug: cal.widgetSlug ? String(cal.widgetSlug) : (cal.slug ? String(cal.slug) : undefined),
          eventColor: cal.eventColor ? String(cal.eventColor) : undefined,
        }));
        // GHL repeats a handful of hexes across calendars, so the swatch is assigned
        // here — one colour per calendar, never shared — and used everywhere.
        const colorMap = buildCalendarColorMap(normalizedCalendars);
        calendarColorMapRef.current = colorMap;
        const colouredCalendars = normalizedCalendars.map((cal) => ({
          ...cal,
          eventColor: resolveCalendarColor(colorMap, cal.id, cal.eventColor ?? FALLBACK_CALENDAR_COLOR),
        }));
        setCalendars(colouredCalendars);
        const rawEvents = data.events || [];
        const normalized = (rawEvents.map(normalizeEvent).filter(Boolean) as GHLEvent[]).map((event) => ({
          ...event,
          calendarColor: resolveCalendarColor(colorMap, event.calendarId, event.calendarColor ?? FALLBACK_CALENDAR_COLOR),
        }));


        // Debug visibility when API returns events but we drop them during normalization
        if (rawEvents.length > 0 && normalized.length === 0) {
          const sample = rawEvents[0] as any;
          console.warn('[GHL Calendar] Received events but none normalized. Sample keys:', Object.keys(sample || {}));
          console.warn('[GHL Calendar] Sample startTime/endTime types:', typeof sample?.startTime, typeof sample?.endTime);
        }

        console.info('[GHL Calendar] calendars:', data.calendars.length, 'events(raw):', rawEvents.length, 'events(normalized):', normalized.length);
        setEvents(normalized);
        setFailedCalendars(Array.isArray(data.failedCalendars) ? data.failedCalendars : []);
      }
    } catch (err: any) {
      console.error('Error fetching calendar data:', err);
      setError(err.message);
      setFailedCalendars([]);
      toast({
        title: 'Failed to load calendar',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchEvents = useCallback(async (
    startTime?: string,
    endTime?: string,
    calendarId?: string
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await invokeSecureFunction('ghl-calendar', {
        action: 'events', startTime, endTime, calendarId,
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (data && data.events) {
        const normalized = ((data.events || [])
          .map(normalizeEvent)
          .filter(Boolean) as GHLEvent[]).map((event) => ({
            ...event,
            calendarColor: resolveCalendarColor(
              calendarColorMapRef.current,
              event.calendarId,
              event.calendarColor ?? FALLBACK_CALENDAR_COLOR,
            ),
          }));
        setEvents(normalized);
      }

    } catch (err: any) {
      console.error('Error fetching events:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchCalendarGroups = useCallback(async () => {
    try {
      const { data, error: fetchError } = await invokeSecureFunction('ghl-calendar', {
        action: 'groups',
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (data?.success && data.groups) {
        setCalendarGroups(data.groups);
      }
      return data?.groups || [];
    } catch (err: any) {
      console.error('Error fetching calendar groups:', err);
      return [];
    }
  }, []);

  const rescheduleEvent = useCallback(async (
    eventId: string,
    newStartTime: string,
    newEndTime: string,
    originalStartTime?: string,
    originalEndTime?: string,
    options?: { overrideAvailability?: boolean; assignedUserId?: string; notes?: string }
  ): Promise<{ success: boolean; undo?: () => Promise<boolean> }> => {
    setIsUpdating(true);

    try {
      const payload: Record<string, unknown> = {
        action: 'update',
        eventId,
        newStartTime,
        newEndTime,
      };
      if (options?.overrideAvailability) payload.overrideAvailability = true;
      if (options?.assignedUserId) payload.assignedUserId = options.assignedUserId;
      // The reschedule form carries notes now (audit item 29): a moved
      // appointment usually moves for a reason, and the form had nowhere to say
      // it. `update` has always accepted the field.
      if (options?.notes !== undefined) payload.notes = options.notes;

      const { data, error: updateError } = await invokeSecureFunction('ghl-calendar', payload);

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (data?.success) {
        // Get the event for notification details
        const event = events.find(e => e.id === eventId);
        
        // Update local state.
        //
        // The notes were part of this too and were left out: the server stored
        // the edited text and the event in memory kept the old one, so
        // reopening the appointment showed the note the operator had just
        // replaced — reported as "I changed the notes… it remained with the
        // original note". Patch what was actually sent.
        setEvents(prev => prev.map(event =>
          event.id === eventId
            ? {
                ...event,
                startTime: newStartTime,
                endTime: newEndTime,
                ...(options?.notes !== undefined ? { notes: options.notes } : {}),
              }
            : event
        ));
        
        // Add notification for rescheduled appointment
        addNotification({
          type: 'appointment_rescheduled',
          title: 'Appointment Rescheduled',
          message: `"${event?.title || 'Appointment'}" has been moved to ${formatDateInSydney(newStartTime, { weekday: undefined })} at ${formatInSydney(newStartTime)}`
        });
        
        // Return undo function if original times were provided
        const undoFn = originalStartTime && originalEndTime
          ? async () => {
              const { data: undoData, error: undoError } = await invokeSecureFunction('ghl-calendar', {
                action: 'update',
                eventId,
                newStartTime: originalStartTime,
                newEndTime: originalEndTime,
              });
              
              if (undoError || !undoData?.success) {
                toast({
                  title: 'Undo failed',
                  description: 'Could not revert the event to its original time.',
                  variant: 'destructive',
                });
                return false;
              }
              
              // Revert local state
              setEvents(prev => prev.map(event => 
                event.id === eventId 
                  ? { ...event, startTime: originalStartTime, endTime: originalEndTime }
                  : event
              ));
              
              toast({
                title: 'Event restored',
                description: 'The event has been moved back to its original time.',
              });
              return true;
            }
          : undefined;

        return { success: true, undo: undoFn };
      } else {
        throw new Error(data?.error || 'Failed to reschedule event');
      }
    } catch (err: any) {
      console.error('Error rescheduling event:', err);
      toast({
        title: 'Failed to reschedule',
        description: err.message,
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsUpdating(false);
    }
  }, [toast]);

  const updateEvent = useCallback(async (
    eventId: string,
    updates: { title?: string; notes?: string; appointmentStatus?: string }
  ): Promise<{ success: boolean }> => {
    setIsUpdating(true);

    try {
      const { data, error: updateError } = await invokeSecureFunction('ghl-calendar', {
        action: 'update', eventId, ...updates,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (data?.success) {
        // Update local state
        setEvents(prev => prev.map(event => 
          event.id === eventId 
            ? { ...event, ...updates }
            : event
        ));
        toast({
          title: 'Event updated',
          description: 'The event has been updated successfully.',
        });
        return { success: true };
      } else {
        throw new Error(data?.error || 'Failed to update event');
      }
    } catch (err: any) {
      console.error('Error updating event:', err);
      toast({
        title: 'Failed to update event',
        description: err.message,
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsUpdating(false);
    }
  }, [toast]);

  const deleteEvent = useCallback(async (eventId: string): Promise<{ success: boolean }> => {
    setIsUpdating(true);

    try {
      const { data, error: deleteError } = await invokeSecureFunction('ghl-calendar', {
        action: 'delete', eventId,
      });

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      if (data?.success) {
        // Get the event for notification details before removing
        const deletedEvent = events.find(e => e.id === eventId);
        
        // Remove from local state
        setEvents(prev => prev.filter(event => event.id !== eventId));
        
        // Add notification for cancelled appointment
        addNotification({
          type: 'appointment_cancelled',
          title: 'Appointment Cancelled',
          message: `"${deletedEvent?.title || 'Appointment'}" has been cancelled`
        });
        
        toast({
          title: 'Event deleted',
          description: 'The event has been removed.',
        });
        return { success: true };
      } else {
        throw new Error(data?.error || 'Failed to delete event');
      }
    } catch (err: any) {
      console.error('Error deleting event:', err);
      toast({
        title: 'Failed to delete event',
        description: err.message,
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsUpdating(false);
    }
  }, [toast]);

  const fetchContact = useCallback(async (contactId: string): Promise<GHLContact | null> => {
    // Return from cache if available
    if (contactCache.has(contactId)) {
      return contactCache.get(contactId)!;
    }

    try {
      const { data, error: fetchError } = await invokeSecureFunction('ghl-calendar', {
        action: 'contact', contactId,
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const rawContact = data?.contact;
      if (!rawContact) return null;

      const contact: GHLContact = {
        id: rawContact.id || contactId,
        name: rawContact.name || rawContact.contactName || undefined,
        firstName: rawContact.firstName || undefined,
        lastName: rawContact.lastName || undefined,
        email: rawContact.email || undefined,
        phone: rawContact.phone || undefined,
      };

      // Store in cache
      setContactCache((prev) => new Map(prev).set(contactId, contact));
      return contact;
    } catch (err: any) {
      console.error('Error fetching contact:', err);
      return null;
    }
  }, [contactCache]);

  const searchContacts = useCallback(async (query: string, limit = 10): Promise<GHLContact[]> => {
    try {
      const { data, error: searchError } = await invokeSecureFunction('ghl-calendar', {
        action: 'searchContacts', query, limit,
      });

      if (searchError) {
        throw new Error(searchError.message);
      }

      if (data?.success && data.contacts) {
        return data.contacts.map((c: any) => ({
          id: c.id,
          name: c.name || c.contactName,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
        }));
      }
      return [];
    } catch (err: any) {
      console.error('Error searching contacts:', err);
      return [];
    }
  }, []);

  const blockSlot = useCallback(async (payload: {
    calendarId: string;
    startTime: string;
    endTime: string;
    title?: string;
  }): Promise<{ success: boolean }> => {
    setIsUpdating(true);

    try {
      const { data, error: blockError } = await invokeSecureFunction('ghl-calendar', {
        action: 'blockSlot', ...payload,
      });

      if (blockError) {
        throw new Error(blockError.message);
      }

      if (data?.success) {
        toast({
          title: 'Time blocked',
          description: 'The time slot has been blocked.',
        });
        return { success: true };
      } else {
        throw new Error(data?.error || 'Failed to block slot');
      }
    } catch (err: any) {
      console.error('Error blocking slot:', err);
      toast({
        title: 'Failed to block slot',
        description: err.message,
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsUpdating(false);
    }
  }, [toast]);

  const fetchFreeSlots = useCallback(async (
    calendarId: string,
    startDate: string,
    endDate: string,
    timezone = 'Australia/Sydney'
  ): Promise<GHLFreeSlot[]> => {
    try {
      const { data, error: fetchError } = await invokeSecureFunction('ghl-calendar', {
        action: 'freeSlots', calendarId, startDate, endDate, timezone,
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (data?.success && data.slots) {
        return data.slots;
      }
      return [];
    } catch (err: any) {
      console.error('Error fetching free slots:', err);
      return [];
    }
  }, []);

  const createAppointment = useCallback(async (payload: {
    calendarId: string;
    title: string;
    startTime: string;
    endTime: string;
    contactId?: string;
    notes?: string;
    address?: string;
    assignedUserId?: string;
    overrideAvailability?: boolean;
    /**
     * Where the meeting happens, as GoHighLevel finally recorded it.
     *
     * Reported separately from `event` because `normalizeEvent` answers null
     * whenever GHL's create response omits a timestamp — and the join link for
     * a Zoom booking would then be discarded along with it. The people who are
     * emailed the invitation need the link, not a normalised event.
     */
  }): Promise<{ success: boolean; event?: GHLEvent; location?: string }> => {
    setIsUpdating(true);

    try {
      const { data, error: createError } = await invokeSecureFunction('ghl-calendar', {
        action: 'create', ...payload,
      });

      if (createError) {
        throw new Error(createError.message);
      }

      if (data?.success) {
        const newEvent = normalizeEvent(data.event);
        if (newEvent) {
          // Shown immediately, so the board reacts to the click.
          setEvents((prev) => [...prev, newEvent]);
        }

        // …and then re-read the window from the server. The optimistic add
        // above is conditional on GoHighLevel returning a complete event, and
        // its create response frequently does not — `normalizeEvent` answers
        // null, the branch is skipped silently, and the booking is invisible
        // until the operator reloads the page. That was the reported defect:
        // "it doesn't display on the calendar… it displays only after I
        // refresh". A refetch cannot be skipped by a missing field.
        const { startTime, endTime, calendarId } = lastRangeRef.current;
        void fetchCalendarData(startTime, endTime, calendarId);
        
        // Add notification for created appointment
        addNotification({
          type: 'appointment_created',
          title: 'Appointment Created',
          message: `"${payload.title}" scheduled for ${formatDateInSydney(payload.startTime, { weekday: undefined })} at ${formatInSydney(payload.startTime)}`
        });
        
        toast({
          title: 'Appointment created',
          description: `"${payload.title}" has been scheduled.`,
        });
        const location = typeof data.event?.address === 'string' && data.event.address.trim()
          ? data.event.address.trim()
          : undefined;
        return { success: true, event: newEvent ?? undefined, location };
      } else {
        // Surface the actual GHL error message to the user
        const errorMsg = data?.error || 'Failed to create appointment';
        console.error('[createAppointment] GHL error details:', data?.details);
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      console.error('Error creating appointment:', err);
      toast({
        title: 'Failed to create appointment',
        description: err.message,
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsUpdating(false);
    }
  }, [toast, fetchCalendarData]);

  const getCalendarColor = useCallback((calendarId: string): string => {
    const calendar = calendars.find(c => c.id === calendarId);
    return calendar?.eventColor || resolveCalendarColor(calendarColorMapRef.current, calendarId);
  }, [calendars]);


  return {
    calendars,
    failedCalendars,
    events,
    calendarGroups,
    contactCache,
    isLoading,
    isUpdating,
    error,
    fetchCalendarData,
    fetchEvents,
    fetchCalendarGroups,
    rescheduleEvent,
    updateEvent,
    deleteEvent,
    createAppointment,
    fetchContact,
    searchContacts,
    blockSlot,
    fetchFreeSlots,
    getCalendarColor,
  };
}
