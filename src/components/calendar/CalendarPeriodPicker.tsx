import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronDown } from 'lucide-react';
import {
  addWeeks,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getMonth,
  getYear,
  isSameWeek,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface CalendarPeriodPickerProps {
  /** The label the header currently shows (month, week range or timeline day). */
  label: string;
  /** Anchor date the picker opens on. */
  anchorDate: Date;
  /** Whether the week row is meaningful for the active view. */
  showWeek?: boolean;
  /** Applied when the operator confirms a period. */
  onNavigate: (date: Date) => void;
  className?: string;
}

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index),
  label: format(new Date(2000, index, 1), 'MMMM'),
}));

const YEAR_SPAN = 6;

export function CalendarPeriodPicker({
  label,
  anchorDate,
  showWeek = true,
  onNavigate,
  className,
}: CalendarPeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(anchorDate);

  useEffect(() => {
    if (open) setDraft(anchorDate);
  }, [open, anchorDate]);

  const years = useMemo(() => {
    const base = getYear(anchorDate);
    return Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, index) => base - YEAR_SPAN + index);
  }, [anchorDate]);

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(draft);
    return eachWeekOfInterval({ start: monthStart, end: endOfMonth(monthStart) }).map((weekStart) => ({
      value: weekStart.toISOString(),
      label: `${format(weekStart, 'MMM d')} – ${format(endOfWeek(weekStart), 'MMM d')}`,
      date: weekStart,
    }));
  }, [draft]);

  const activeWeekValue = weeks.find((week) => isSameWeek(week.date, draft))?.value ?? weeks[0]?.value;

  const apply = (date: Date) => {
    onNavigate(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change period — currently ${label}`}
          className={cn(
            'group inline-flex items-center gap-2 rounded-xl border border-transparent px-2 py-1 text-left transition-all duration-200 ease-out hover:border-primary/30 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
            className,
          )}
        >
          <span className="text-xl font-semibold tracking-tight text-foreground">{label}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 text-muted-foreground transition-transform group-hover:text-primary', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[19rem] rounded-2xl border-border bg-popover/95 p-4 backdrop-blur-xl">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarRange className="h-4 w-4 text-primary" />
          Jump to period
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Month</span>
              <Select
                value={String(getMonth(draft))}
                onValueChange={(value) => setDraft((current) => setMonth(current, Number(value)))}
              >
                <SelectTrigger className="h-9 rounded-xl border-border bg-card/80 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {MONTHS.map((month) => (
                    <SelectItem key={month.value} value={month.value} className="text-xs">
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Year</span>
              <Select
                value={String(getYear(draft))}
                onValueChange={(value) => setDraft((current) => setYear(current, Number(value)))}
              >
                <SelectTrigger className="h-9 rounded-xl border-border bg-card/80 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)} className="text-xs">
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {showWeek && (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Week</span>
              <Select
                value={activeWeekValue}
                onValueChange={(value) => setDraft(new Date(value))}
              >
                <SelectTrigger className="h-9 rounded-xl border-border bg-card/80 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {weeks.map((week) => (
                    <SelectItem key={week.value} value={week.value} className="text-xs">
                      {week.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 rounded-xl border border-border text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              onClick={() => apply(new Date())}
            >
              Today
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 rounded-xl border border-border text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={() => setDraft((current) => addWeeks(startOfWeek(current), 1))}
              >
                +1 week
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                onClick={() => apply(draft)}
              >
                Go
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
