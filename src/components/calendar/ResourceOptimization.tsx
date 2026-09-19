import { useMemo } from 'react';
import { format, setHours } from 'date-fns';
import { CalendarDays, Clock, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fallsOutsideWeek, resolveRecommendedSlot } from '@/lib/calendar/recommendedSlot.pure';
import {
  describeSlot,
  summariseBookings,
  type SlotFacts,
} from '@/lib/calendar/bookingPatterns.pure';

interface ResourceOptimizationProps {
  events: Array<{
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
  }>;
  currentWeek: Date;
  selectedDate?: Date | null;
  onSlotSelect?: (date: Date, hour: number) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Booking patterns — what the calendar can actually say about when this
 * business books.
 *
 * This panel used to show a "Daily Availability Score" and an "Hourly
 * Performance" bar, and neither could be explained (audit item 20). Both came
 * from a 0–100 number invented here: 50 to start with, ±5 for the day of week,
 * ±10 for business hours, ±10 for how full the slot was, then averaged and
 * printed as a percentage. A time nobody had ever booked was given a
 * "historical success" of 50%, so an untested hour scored the same as one with
 * a perfect record. A card of generic advice ("mid-week slots typically have
 * the best show rates") sat underneath it, presented as a finding about this
 * business.
 *
 * Everything here is a count of appointments that exist, and a time with no
 * history says so.
 */
export function ResourceOptimization({
  events,
  currentWeek,
  selectedDate,
  onSlotSelect,
}: ResourceOptimizationProps) {
  const safeParseISO = (value: string): Date | null => {
    try {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const weekStart = useMemo(() => {
    const d = new Date(currentWeek);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentWeek]);

  const patterns = useMemo(
    () => summariseBookings(events, safeParseISO),
    [events],
  );

  const busiestDay = useMemo(
    () => patterns.byDay.reduce((max, d) => (d.booked > max.booked ? d : max), patterns.byDay[0]),
    [patterns],
  );
  const busiestHourCount = useMemo(
    () => Math.max(0, ...patterns.byHour.map((h) => h.booked)),
    [patterns],
  );

  if (patterns.total === 0) {
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-primary" />
          Booking Patterns
        </h3>
        <Card className="border-dashed p-6 text-center">
          <p className="text-sm font-medium text-foreground">No bookings in view</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Patterns appear once there are appointments in the selected range.
          </p>
        </Card>
      </div>
    );
  }

  const topSlots: SlotFacts[] = patterns.slots.slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-primary" />
          Booking Patterns
        </h3>
        <span className="text-xs text-muted-foreground">
          {patterns.total} appointment{patterns.total !== 1 ? 's' : ''} in view
        </span>
      </div>
      {/* Audit item 20, the determination: the numbers say where they come
          from. These are counts of the appointments currently drawn on the
          calendar — the Overlay's and the search's filters included — never a
          score. */}
      <p className="text-xs text-muted-foreground">
        Counted from the appointments shown on the calendar — booked, confirmed
        and no-shows. Nothing here is a score or a prediction.
      </p>

      {/* Times this business actually books. Clicking one opens the booking
          form on the next occurrence of that slot, never one already past. */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Clock className="h-3 w-3" />
          Most-booked times
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {topSlots.map((slot) => {
            const slotTime = resolveRecommendedSlot(slot.day, slot.hour);
            const nextWeek = fallsOutsideWeek(slotTime, weekStart);
            return (
              <button
                key={`${slot.day}-${slot.hour}`}
                type="button"
                onClick={() => onSlotSelect?.(slotTime, slot.hour)}
                className="rounded-lg border border-border bg-card/60 p-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
              >
                <div className="text-xs font-medium text-foreground">
                  {format(slotTime, 'EEE d MMM')} {format(setHours(new Date(), slot.hour), 'h a')}
                  {nextWeek && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      next week
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {describeSlot(slot)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per weekday. Counts, not a score — an empty day reads as empty. */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          By weekday
        </h4>
        <div className="space-y-1.5">
          {patterns.byDay.map((day) => (
            <div key={day.day} className="flex items-center gap-2">
              <span className="w-8 text-xs text-foreground">{DAY_LABELS[day.day]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{
                    width: busiestDay.booked > 0
                      ? `${Math.round((day.booked / busiestDay.booked) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
              <span className="w-24 text-right text-[10px] text-muted-foreground">
                {day.booked === 0
                  ? 'none'
                  : describeSlot(day)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per hour of the working day. */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Clock className="h-3 w-3" />
          By hour
        </h4>
        <div className="flex gap-1">
          {patterns.byHour.map((h) => (
            <div key={h.hour} className="flex-1 text-center">
              <div
                title={`${format(setHours(new Date(), h.hour), 'h a')}: ${h.booked} booked`}
                className={cn(
                  'mb-1 flex h-8 items-end rounded-sm',
                  h.booked === 0 ? 'bg-muted/70' : 'bg-primary/20',
                )}
              >
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{
                    height: busiestHourCount > 0
                      ? `${Math.max(h.booked === 0 ? 0 : 12, (h.booked / busiestHourCount) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
              <span className="text-[8px] text-muted-foreground">
                {format(setHours(new Date(), h.hour), 'ha')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
