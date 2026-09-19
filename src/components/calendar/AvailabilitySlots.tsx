import { useMemo } from 'react';
import { format, isSameDay, getHours, setHours, setMinutes, addMinutes, isWithinInterval, parseISO } from 'date-fns';
import { Clock, Plus, CheckCircle2 } from 'lucide-react';
import { GHLEvent } from '@/hooks/useGHLCalendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface AvailabilitySlotsProps {
  selectedDate: Date;
  events: GHLEvent[];
  workingHours?: { start: number; end: number };
  slotDuration?: number; // in minutes
  onSlotClick?: (startTime: Date, endTime: Date) => void;
  className?: string;
}

const safeParseISO = (value: string | undefined | null): Date | null => {
  try {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      const ms = n < 1_000_000_000_000 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = parseISO(trimmed);
    if (!Number.isNaN(d.getTime())) return d;

    const fallbackMs = Date.parse(trimmed);
    if (!Number.isNaN(fallbackMs)) return new Date(fallbackMs);

    return null;
  } catch {
    return null;
  }
};

interface TimeSlot {
  start: Date;
  end: Date;
  isFree: boolean;
  eventTitle?: string;
}

export function AvailabilitySlots({
  selectedDate,
  events,
  workingHours = { start: 9, end: 17 }, // 9 AM to 5 PM default
  slotDuration = 30, // 30 minutes default
  onSlotClick,
  className,
}: AvailabilitySlotsProps) {
  // Get events for the selected date
  const dayEvents = useMemo(() => {
    return events.filter((event) => {
      const d = safeParseISO(event.startTime);
      return d ? isSameDay(d, selectedDate) : false;
    }).map((event) => ({
      event,
      start: safeParseISO(event.startTime),
      end: safeParseISO(event.endTime),
    })).filter((e) => e.start && e.end) as Array<{
      event: GHLEvent;
      start: Date;
      end: Date;
    }>;
  }, [events, selectedDate]);

  // Generate time slots
  const timeSlots = useMemo(() => {
    const slots: TimeSlot[] = [];
    const dayStart = setMinutes(setHours(new Date(selectedDate), workingHours.start), 0);
    const dayEnd = setMinutes(setHours(new Date(selectedDate), workingHours.end), 0);
    
    let currentSlotStart = dayStart;
    
    while (currentSlotStart < dayEnd) {
      const currentSlotEnd = addMinutes(currentSlotStart, slotDuration);
      
      // Check if this slot overlaps with any event
      const overlappingEvent = dayEvents.find(({ start, end }) => {
        // Check if the slot overlaps with the event
        return (
          (currentSlotStart >= start && currentSlotStart < end) ||
          (currentSlotEnd > start && currentSlotEnd <= end) ||
          (currentSlotStart <= start && currentSlotEnd >= end)
        );
      });

      slots.push({
        start: new Date(currentSlotStart),
        end: new Date(currentSlotEnd),
        isFree: !overlappingEvent,
        eventTitle: overlappingEvent?.event.title,
      });

      currentSlotStart = currentSlotEnd;
    }

    return slots;
  }, [selectedDate, dayEvents, workingHours, slotDuration]);

  const freeSlots = timeSlots.filter((s) => s.isFree);
  const busySlots = timeSlots.filter((s) => !s.isFree);

  // Calculate availability percentage
  const availabilityPercentage = timeSlots.length > 0 
    ? Math.round((freeSlots.length / timeSlots.length) * 100) 
    : 100;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Availability
        </h4>
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              'text-xs',
              availabilityPercentage > 70 ? 'text-success border-success/50' :
              availabilityPercentage > 30 ? 'text-brand-500 border-brand-500/50' :
              'text-destructive border-destructive/50'
            )}
          >
            {availabilityPercentage}% free
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/20">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-success dark:text-success">{freeSlots.length} free slots</span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border border-border">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{busySlots.length} busy</span>
        </div>
      </div>

      {/* Time Slots Grid */}
      <TooltipProvider delayDuration={150}>
      <div className="space-y-1.5">
          {timeSlots.map((slot, index) => (
            <div
              key={index}
              className={cn(
                'group flex items-center justify-between p-2 rounded-lg border transition-all duration-200',
                slot.isFree
                  ? 'bg-success/5 border-success/20 hover:bg-success/10 hover:border-success/40 cursor-pointer'
                  // A booked slot is OCCUPIED, not disabled. It carried
                  // `opacity-60` over `bg-muted/50` with muted-foreground text,
                  // which is this system's vocabulary for a control you cannot
                  // use — so a slot holding a real client read as broken chrome,
                  // and the time in it could barely be read at all. It gets a
                  // surface of its own and full-strength text instead.
                  : 'border-primary/35 bg-primary/10'
              )}
              onClick={() => slot.isFree && onSlotClick?.(slot.start, slot.end)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    slot.isFree ? 'bg-success' : 'bg-primary'
                  )}
                />
                <span className="truncate text-sm font-medium text-foreground">
                  {format(slot.start, 'h:mm a')} - {format(slot.end, 'h:mm a')}
                </span>
              </div>
              
              {slot.isFree ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-success hover:text-success hover:bg-success/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSlotClick?.(slot.start, slot.end);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Book
                </Button>
              ) : (
                // Truncation with no way to read the rest. The tooltip is the
                // way, and it is safe here now that tooltip content is
                // portalled rather than clipped by the panel it sits in.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="max-w-[9rem] shrink-0 truncate text-xs font-medium text-foreground/85">
                      {slot.eventTitle || 'Busy'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {slot.eventTitle || 'Busy'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
      </div>
      </TooltipProvider>

      {/* Working Hours Note */}
      <p className="text-xs text-muted-foreground text-center">
        Working hours: {format(setHours(new Date(), workingHours.start), 'h a')} - {format(setHours(new Date(), workingHours.end), 'h a')}
      </p>
    </div>
  );
}
