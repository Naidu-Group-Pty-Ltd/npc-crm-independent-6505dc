import { useMemo } from 'react';
import { format, isSameDay, getHours, getMinutes, differenceInMinutes, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { GHLEvent } from '@/hooks/useGHLCalendar';
import { DraggableEvent } from './DraggableEvent';
import { DropZone } from './DropZone';
import { cn } from '@/lib/utils';

interface TimelineViewProps {
  selectedDate: Date;
  events: GHLEvent[];
  onEventClick: (event: GHLEvent) => void;
  onEventDrop: (event: GHLEvent, date: Date, hour?: number) => void;
  getEventStyle: (event: GHLEvent) => React.CSSProperties;
  isUpdating?: boolean;
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

const HOUR_HEIGHT = 60; // pixels per hour

export function TimelineView({
  selectedDate,
  events,
  onEventClick,
  onEventDrop,
  getEventStyle,
  isUpdating = false,
}: TimelineViewProps) {
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const dayEvents = useMemo(() => {
    return events
      .filter((event) => {
        const d = safeParseISO(event.startTime);
        return d ? isSameDay(d, selectedDate) : false;
      })
      .map((event) => {
        const start = safeParseISO(event.startTime);
        const end = safeParseISO(event.endTime);
        if (!start || !end) return null;

        const startHour = getHours(start);
        const startMinute = getMinutes(start);
        const duration = differenceInMinutes(end, start);

        // Calculate position and height
        const top = startHour * HOUR_HEIGHT + (startMinute / 60) * HOUR_HEIGHT;
        const height = Math.max((duration / 60) * HOUR_HEIGHT, 24); // Minimum 24px

        return {
          event,
          start,
          end,
          top,
          height,
          duration,
        };
      })
      .filter(Boolean) as Array<{
        event: GHLEvent;
        start: Date;
        end: Date;
        top: number;
        height: number;
        duration: number;
      }>;
  }, [events, selectedDate]);

  // Find current time position
  const now = new Date();
  const isToday = isSameDay(selectedDate, now);
  const currentTimeTop = isToday
    ? getHours(now) * HOUR_HEIGHT + (getMinutes(now) / 60) * HOUR_HEIGHT
    : null;

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <div className="relative min-w-[400px] pb-4">
        {/* Header */}
        <div className="sticky top-0 bg-background z-20 pb-2 border-b border-border mb-2">
          <div className="flex items-center gap-2 px-4 py-2">
            <Clock className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h3>
            {dayEvents.length > 0 && (
              <span className="text-sm text-muted-foreground">
                ({dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''})
              </span>
            )}
          </div>
        </div>

        {/* Timeline grid */}
        <div className="relative ml-16 mr-4">
          {/* Hour rows */}
          {hours.map((hour) => (
            <DropZone
              key={hour}
              date={selectedDate}
              hour={hour}
              onDrop={onEventDrop}
              disabled={isUpdating}
              className="relative"
            >
              <div
                className="border-t border-border/50 group hover:bg-muted/30 transition-colors"
                style={{ height: HOUR_HEIGHT }}
              >
                {/* Hour label */}
                <div className="absolute -left-16 -top-2 w-14 text-right text-xs text-muted-foreground pr-2">
                  {format(new Date().setHours(hour, 0, 0, 0), 'h a')}
                </div>
                {/* Half-hour line */}
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-border/30"
                  style={{ top: HOUR_HEIGHT / 2 }}
                />
              </div>
            </DropZone>
          ))}

          {/* Current time indicator */}
          {currentTimeTop !== null && (
            <div
              className="absolute left-0 right-0 z-10 flex items-center pointer-events-none animate-pulse"
              style={{ top: currentTimeTop }}
            >
              <div className="w-3 h-3 rounded-full bg-destructive -ml-1.5" />
              <div className="flex-1 h-0.5 bg-destructive" />
            </div>
          )}

          {/* Events */}
          {dayEvents.map(({ event, top, height, start, end }) => (
            <DraggableEvent
              key={event.id}
              event={event}
              disabled={isUpdating}
              className="absolute left-0 right-4 z-[5]"
            >
              <div
                onClick={() => onEventClick(event)}
                style={{
                  ...getEventStyle(event),
                  top,
                  height,
                  position: 'absolute',
                  left: 0,
                  right: 0,
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 cursor-pointer overflow-hidden',
                  'hover:ring-2 hover:ring-primary/50 transition-all duration-200',
                  'shadow-sm hover:shadow-md',
                  isUpdating && 'opacity-50 pointer-events-none'
                )}
              >
                <div className="font-medium text-sm truncate">
                  {event.title || 'Untitled Event'}
                </div>
                <div className="text-xs opacity-80 flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  {format(start, 'h:mm a')} - {format(end, 'h:mm a')}
                </div>
                {height > 50 && event.notes && (
                  <div className="text-xs opacity-70 mt-1 line-clamp-2">
                    {event.notes}
                  </div>
                )}
              </div>
            </DraggableEvent>
          ))}
        </div>

        {/* No events message */}
        {dayEvents.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No events scheduled</p>
              <p className="text-xs opacity-70">Drag events here to reschedule</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
