import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  startOfWeek, 
  endOfWeek, 
  isSameDay, 
  isToday, 
  isSameMonth,
  addMonths,
  subMonths
} from 'date-fns';
import { cn } from '@/lib/utils';

interface MiniCalendarNavigatorProps {
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
  eventsPerDay?: Record<string, number>;
}

export function MiniCalendarNavigator({
  currentMonth,
  setCurrentMonth,
  selectedDate,
  onDateSelect,
  eventsPerDay = {},
}: MiniCalendarNavigatorProps) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    onDateSelect(today);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          aria-label="Previous mini calendar month"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl border border-border text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-0 active:scale-95"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-semibold tracking-tight text-foreground">{format(currentMonth, 'MMM yyyy')}</span>
        <Button
          aria-label="Next mini calendar month"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl border border-border text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-0 active:scale-95"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 rounded-xl border border-border bg-muted/60 p-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <div key={i} className="py-1 text-center text-[10px] font-semibold text-muted-foreground">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const eventCount = eventsPerDay[dateKey] || 0;
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isTodayDate = isToday(day);

          return (
            <button
              key={dateKey}
              aria-label={`Select ${format(day, 'EEEE, MMMM d, yyyy')}${eventCount > 0 ? `, ${eventCount} event${eventCount === 1 ? '' : 's'}` : ', no events'}`}
              aria-pressed={Boolean(isSelected)}
              onClick={() => onDateSelect(day)}
              className={cn(
                'relative flex h-7 w-full items-center justify-center rounded-xl border text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                isSelected && 'border-primary/70 bg-primary/20 text-primary shadow-[0_8px_20px_hsl(var(--primary)/0.14)]',
                !isSelected && isTodayDate && 'border-primary/45 bg-primary/10 text-primary',
                !isSelected && !isTodayDate && 'border-transparent text-muted-foreground hover:border-primary/25 hover:bg-primary/10 hover:text-primary',
                !isCurrentMonth && 'text-muted-foreground hover:text-muted-foreground'
              )}
            >
              {format(day, 'd')}
              {eventCount > 0 && !isSelected && (
                <span
                  className={cn(
                    'absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full',
                    eventCount > 3 ? 'bg-destructive' : 'bg-primary'
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Today button */}
      <Button
        variant="outline"
        size="sm"
        className="h-9 w-full rounded-xl border-primary/35 bg-primary/15 text-xs font-semibold text-primary transition-all hover:-translate-y-0.5 hover:border-primary/55 hover:bg-primary/20 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-0 active:scale-[0.98]"
        onClick={goToToday}
      >
        Today
      </Button>
    </div>
  );
}
