import { useState, useEffect, useMemo } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';
import { cn } from '@/lib/utils';
import {
  CalendarDays, Clock, CheckCircle2, Loader2, ArrowRight,
  ArrowLeft, CalendarCheck, Sparkles, List
} from 'lucide-react';
import { format, addDays, isBefore, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


function getSessionToken(): string | null {
  // In-memory only: `client-portal-verify` repopulates it from the HttpOnly
  // cookie on load. It used to come from localStorage. See src/lib/portalSession.ts.
  return getPortalSessionToken();
}

async function invokePortalBooking(body: Record<string, any>) {
  const sessionToken = getSessionToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/portal-book-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      ...(sessionToken ? { 'x-portal-session-token': sessionToken } : {}),
    },
    credentials: 'omit',
    body: JSON.stringify({ ...body, portal_session_token: sessionToken, session_token: sessionToken }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

interface TimeSlot {
  start: string;
  end: string;
}

interface BookingCalendarOption {
  id: string;
  name: string;
  description?: string;
}

type BookingStep = 'calendar' | 'date' | 'time' | 'confirm' | 'success';

export default function PortalBooking() {
  const { user } = usePortalAuth();
  const [step, setStep] = useState<BookingStep>('calendar');
  const [selectedCalendar, setSelectedCalendar] = useState<BookingCalendarOption | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [notes, setNotes] = useState('');

  // Fetch portal config
  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['portal-booking-config'],
    queryFn: () => invokePortalBooking({ action: 'getConfig' }),
    staleTime: 60000,
  });

  const config = configData?.config;
  const bookingCalendars: BookingCalendarOption[] = useMemo(() => {
    // Support new multi-calendar array, fallback to legacy single calendar
    if (config?.booking_calendars && Array.isArray(config.booking_calendars) && config.booking_calendars.length > 0) {
      return config.booking_calendars;
    }
    if (config?.booking_calendar_id) {
      return [{ id: config.booking_calendar_id, name: config.booking_calendar_name || 'Default Calendar' }];
    }
    return [];
  }, [config]);

  const calendarId = selectedCalendar?.id || null;
  const leadTimeHours = config?.booking_lead_time_hours || 24;
  const maxAdvanceDays = config?.booking_max_advance_days || 30;
  const slotDuration = config?.booking_slot_duration || 30; // minutes
  const introText = config?.booking_intro_text || 'Schedule a consultation with our team.';

  // Auto-select if only one calendar
  useEffect(() => {
    if (bookingCalendars.length === 1 && !selectedCalendar) {
      setSelectedCalendar(bookingCalendars[0]);
      setStep('date');
    }
  }, [bookingCalendars, selectedCalendar]);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() + leadTimeHours);
    return startOfDay(d);
  }, [leadTimeHours]);

  const maxDate = useMemo(() => addDays(new Date(), maxAdvanceDays), [maxAdvanceDays]);

  // Fetch free slots for selected date
  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ['portal-free-slots', calendarId, selectedDate?.toISOString()],
    queryFn: () => {
      if (!calendarId || !selectedDate) return null;
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      return invokePortalBooking({
        action: 'freeSlots',
        calendarId,
        startDate: dateStr,
        endDate: dateStr,
        timezone: 'Australia/Sydney',
      });
    },
    enabled: !!calendarId && !!selectedDate,
    staleTime: 30000,
  });

  // Parse free slots from GHL response
  const freeSlots: TimeSlot[] = useMemo(() => {
    if (!slotsData?.slots) return [];
    const slotsObj = slotsData.slots;
    const allSlots: TimeSlot[] = [];
    if (typeof slotsObj === 'object') {
      for (const dateKey of Object.keys(slotsObj)) {
        const dayData = slotsObj[dateKey];
        // GHL returns { "YYYY-MM-DD": { slots: ["ISO_STRING", ...] } }
        const slotsArray = Array.isArray(dayData) ? dayData : (dayData?.slots || []);
        if (Array.isArray(slotsArray)) {
          for (const slot of slotsArray) {
            if (typeof slot === 'string') {
              // Each slot is just a start time string; estimate end as start + slotDuration
              const startDate = new Date(slot);
              const endDate = new Date(startDate.getTime() + (slotDuration || 30) * 60000);
              allSlots.push({ start: startDate.toISOString(), end: endDate.toISOString() });
            } else if (typeof slot === 'object' && slot) {
              allSlots.push({ start: slot.startTime || slot.start, end: slot.endTime || slot.end });
            }
          }
        }
      }
    }
    const now = new Date();
    now.setHours(now.getHours() + Math.max(1, leadTimeHours));
    return allSlots.filter(s => new Date(s.start) >= now);
  }, [slotsData, leadTimeHours, slotDuration]);

  // Book mutation
  const bookMutation = useMutation({
    mutationFn: () => {
      if (!calendarId || !selectedSlot) throw new Error('No slot selected');
      return invokePortalBooking({
        action: 'book',
        calendarId,
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        notes,
      });
    },
    onSuccess: () => {
      setStep('success');
      toast.success('Appointment booked successfully!');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to book appointment');
    },
  });

  const handleCalendarSelect = (cal: BookingCalendarOption) => {
    setSelectedCalendar(cal);
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setStep('date');
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    if (date) setStep('time');
  };

  const handleSlotSelect = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setStep('confirm');
  };

  const handleConfirm = () => {
    bookMutation.mutate();
  };

  const handleReset = () => {
    setStep(bookingCalendars.length > 1 ? 'calendar' : 'date');
    setSelectedCalendar(bookingCalendars.length === 1 ? bookingCalendars[0] : null);
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setNotes('');
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (bookingCalendars.length === 0) {
    return (
      <div className="space-y-6">
        <div className="client-portal-page-header">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Book Appointment</h1>
          <p className="mt-1 text-muted-foreground">Schedule a consultation with our team</p>
        </div>
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<CalendarDays className="h-8 w-8" />}
          title="Appointment booking is not currently available"
          description="Please contact your advisor directly to schedule a meeting."
        />
      </div>
    );
  }

  const stepLabels = bookingCalendars.length > 1
    ? ['Select Type', 'Select Date', 'Choose Time', 'Confirm'] as const
    : ['Select Date', 'Choose Time', 'Confirm'] as const;

  const stepsOrder = bookingCalendars.length > 1
    ? ['calendar', 'date', 'time', 'confirm'] as const
    : ['date', 'time', 'confirm'] as const;

  const currentStepIdx = stepsOrder.indexOf(step as any);

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Book Appointment</h1>
        <p className="mt-1 text-muted-foreground">{introText}</p>
      </div>

      {/* Progress Steps */}
      {step !== 'success' && (
        <div className="flex items-center gap-2">
          {stepsOrder.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors',
                step === s ? 'bg-primary text-primary-foreground' :
                currentStepIdx > i ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                {i + 1}
              </div>
              <span className={cn('text-sm hidden sm:inline', step === s ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {stepLabels[i]}
              </span>
              {i < stepsOrder.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>
      )}

      {/* Success State */}
      {step === 'success' && selectedSlot && (
        <Card className="client-portal-soft-panel border-success/30 bg-success/5">
          <CardContent className="py-10 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground">Booking Confirmed!</h3>
              <p className="text-muted-foreground mt-1">Your appointment has been scheduled successfully.</p>
            </div>
            <div className="inline-flex items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-6 py-4 shadow-sm shadow-primary/5">
              <CalendarCheck className="h-5 w-5 text-primary" />
              <div className="text-left">
                <p className="font-semibold text-foreground">
                  {format(new Date(selectedSlot.start), 'EEEE, d MMMM yyyy')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(selectedSlot.start), 'h:mm a')} – {format(new Date(selectedSlot.end), 'h:mm a')} (AEST)
                </p>
                {selectedCalendar && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedCalendar.description || selectedCalendar.name}
                  </p>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">A confirmation email has been sent to your registered email address.</p>
            <Button onClick={handleReset} variant="outline" className="mt-4">
              Book Another Appointment
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Calendar Selection (only when multiple calendars) */}
      {step === 'calendar' && bookingCalendars.length > 1 && (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <List className="h-5 w-5 text-primary" />
              What type of appointment?
            </CardTitle>
            <CardDescription>Choose the type of consultation you'd like to book</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {bookingCalendars.map((cal) => (
                <Button
                  key={cal.id}
                  variant="outline"
                  className={cn(
                    'h-auto py-4 px-5 flex items-start gap-4 text-left transition-all justify-start',
                    'hover:border-primary/50 hover:bg-primary/5'
                  )}
                  onClick={() => handleCalendarSelect(cal)}
                >
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                    <CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{cal.description || cal.name}</p>
                    {cal.description && <p className="text-xs text-muted-foreground mt-0.5">{cal.name}</p>}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto self-center" />
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Selection */}
      {step === 'date' && (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  Select a Date
                </CardTitle>
                <CardDescription>
                  {selectedCalendar?.description || selectedCalendar?.name || 'Choose your preferred date'}
                </CardDescription>
              </div>
              {bookingCalendars.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => { setStep('calendar'); setSelectedCalendar(null); }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Change Type
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={(date) => isBefore(date, minDate) || date > maxDate || date.getDay() === 0 || date.getDay() === 6}
              className="rounded-xl border"
            />
          </CardContent>
        </Card>
      )}

      {/* Time Selection */}
      {step === 'time' && selectedDate && (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5 text-primary" />
                  Available Times
                </CardTitle>
                <CardDescription>
                  {format(selectedDate, 'EEEE, d MMMM yyyy')}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep('date')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Change Date
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {slotsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading available slots...</span>
              </div>
            ) : freeSlots.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No available time slots for this date.</p>
                <Button variant="outline" className="mt-4" onClick={() => setStep('date')}>
                  Choose Another Date
                </Button>
              </div>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {freeSlots.map((slot, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      className={cn(
                        'h-auto py-3 px-4 flex flex-col items-center gap-1 transition-all',
                        selectedSlot?.start === slot.start
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'hover:border-primary/50 hover:bg-primary/5'
                      )}
                      onClick={() => handleSlotSelect(slot)}
                    >
                      <span className="font-semibold text-sm">
                        {format(new Date(slot.start), 'h:mm a')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(slot.end), 'h:mm a')}
                      </span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmation */}
      {step === 'confirm' && selectedSlot && selectedDate && (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                Confirm Booking
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setStep('time')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Change Time
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
              <div className="flex items-center gap-3">
                <CalendarCheck className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">
                    {format(selectedDate, 'EEEE, d MMMM yyyy')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedSlot.start), 'h:mm a')} – {format(new Date(selectedSlot.end), 'h:mm a')} (AEST)
                  </p>
                  {selectedCalendar && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedCalendar.description || selectedCalendar.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Notes (optional)</label>
              <Textarea
                placeholder="Any topics you'd like to discuss or questions you have..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            <Button
              onClick={handleConfirm}
              disabled={bookMutation.isPending}
              className="w-full h-12 text-base font-semibold"
              size="lg"
            >
              {bookMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <CalendarCheck className="h-4 w-4 mr-2" />
                  Confirm Booking
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
