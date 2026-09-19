/**
 * The Overlay tool — which calendars draw their appointments on the grid.
 *
 * Audit item 26 called this "need to have a discussion": fourteen rows all
 * reading "0 events" beside a month that plainly held appointments, and
 * toggles that changed nothing anyone could see. The mechanics behind that are
 * fixed in `calendarVisibility.pure.ts` (membership always; appointments on no
 * listed calendar belong to an "Other appointments" row instead of vanishing
 * on unrelated toggles), and this panel is the determination on top:
 *
 *   • It says what it is for, in one line, because a tool whose purpose is
 *     guessed at is a tool that reads as broken.
 *   • Its summary states the OUTCOME — how many appointments the grid is
 *     drawing and how many the toggles hide — so flipping a switch always
 *     moves a number the eye is already on.
 *   • Rows with appointments come first, busiest first. The zero rows are the
 *     reason the panel was unreadable — fourteen booking types with nothing in
 *     range drowned the one that mattered — so they live behind a disclosure
 *     that says how many it holds.
 *   • The colour-chip "quick toggle" strip is gone: an unlabelled 20px square
 *     duplicating a labelled row is a second launcher and a worse one.
 *
 * Every count comes from `summariseOverlay`, the same module the grid filters
 * by, so the panel and the calendar cannot disagree about what is shown.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  summariseOverlay,
  type OverlayRow,
} from '@/lib/calendar/calendarVisibility.pure';

interface Calendar {
  id: string;
  name: string;
  eventColor?: string;
  isActive?: boolean;
}

interface MultiCalendarOverlayProps {
  calendars: Calendar[];
  events: Array<{
    id: string;
    calendarId?: string;
    startTime?: string;
  }>;
  visibleCalendars: Set<string>;
  onToggleCalendar: (calendarId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  /** Outlook integration */
  outlookEnabled?: boolean;
  outlookVisible?: boolean;
  onToggleOutlook?: () => void;
  outlookEventCount?: number;
  microsoftEmail?: string | null;
}

/** One calendar's row: colour, name, count in view, and its toggle. */
function CalendarRow({
  row,
  onToggle,
}: {
  row: OverlayRow;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-all',
        row.visible ? 'border-primary/30 bg-primary/5' : 'border-border/50 opacity-60',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn('h-4 w-4 shrink-0 rounded-full transition-all', !row.visible && 'opacity-40')}
          style={{
            backgroundColor: row.isOther
              ? 'hsl(var(--muted-foreground))'
              : row.eventColor || 'hsl(var(--info))',
          }}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.isOther
              ? `${row.count} in view · booked on calendars not in this list`
              : row.count === 0
                ? 'None in view'
                : `${row.count} in view`}
          </p>
        </div>
      </div>
      <Switch
        checked={row.visible}
        onCheckedChange={() => onToggle(row.id)}
        aria-label={`${row.visible ? 'Hide' : 'Show'} ${row.name}`}
      />
    </div>
  );
}

export function MultiCalendarOverlay({
  calendars,
  events,
  visibleCalendars,
  onToggleCalendar,
  onShowAll,
  onHideAll,
  outlookVisible,
  onToggleOutlook,
  outlookEventCount = 0,
  microsoftEmail,
}: MultiCalendarOverlayProps) {
  const [emptyOpen, setEmptyOpen] = useState(false);

  const summary = useMemo(
    () => summariseOverlay(events, calendars, visibleCalendars),
    [events, calendars, visibleCalendars],
  );

  const allOn = summary.hidden === 0 && calendars.every((c) => visibleCalendars.has(c.id));
  const allOff = calendars.every((c) => !visibleCalendars.has(c.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Layers className="h-4 w-4" />
          Calendar Overlay
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onShowAll} disabled={allOn}>
            <Eye className="mr-1 h-3 w-3" />
            All
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onHideAll} disabled={allOff}>
            <EyeOff className="mr-1 h-3 w-3" />
            None
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose which booking calendars draw their appointments on the grid.
      </p>

      {/* The outcome, where the eye already is: flipping any switch moves
          these numbers, which is what makes the toggles legible. */}
      <Card className="bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{summary.shown}</span> of{' '}
            {summary.total} appointment{summary.total !== 1 ? 's' : ''} in view
          </span>
          {summary.hidden > 0 ? (
            <Badge variant="outline" className="border-warning/40 text-xs text-warning">
              {summary.hidden} hidden
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">none hidden</Badge>
          )}
        </div>
      </Card>

      {/* Outlook keeps its own toggle and its own merge step, as ever. */}
      {microsoftEmail && onToggleOutlook && (
        <div
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-all',
            outlookVisible
              ? 'border-info/30 bg-info/5'
              : 'border-border/50 opacity-60',
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className={cn('h-4 w-4 shrink-0 rounded-full transition-all', !outlookVisible && 'opacity-40')}
              style={{ backgroundColor: 'hsl(var(--info))' }}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">Outlook</p>
              <p className="truncate text-xs text-muted-foreground">
                {outlookEventCount} in view · {microsoftEmail}
              </p>
            </div>
          </div>
          <Switch
            checked={!!outlookVisible}
            onCheckedChange={onToggleOutlook}
            aria-label={`${outlookVisible ? 'Hide' : 'Show'} Outlook`}
          />
        </div>
      )}

      {/* Calendars with appointments in view, busiest first — including the
          Other row, which exists so nothing can be invisible to the panel
          that decides visibility. */}
      {summary.active.length > 0 && (
        <div className="space-y-2">
          {summary.active.map((row) => (
            <CalendarRow key={row.id} row={row} onToggle={onToggleCalendar} />
          ))}
        </div>
      )}

      {summary.active.length === 0 && summary.empty.length === 0 && !microsoftEmail && (
        <Card className="border-dashed p-6 text-center">
          <p className="text-sm font-medium text-foreground">No calendars to show</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Booking calendars appear here once the calendar connection loads them.
          </p>
        </Card>
      )}

      {/* The zero rows, named and tucked away rather than drowning the list.
          Each stays a full control — hiding an empty calendar now still
          matters the day it books something. */}
      {summary.empty.length > 0 && (
        <Collapsible open={emptyOpen} onOpenChange={setEmptyOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40"
            >
              {emptyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Nothing in view ({summary.empty.length} calendar{summary.empty.length !== 1 ? 's' : ''})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {summary.empty.map((row) => (
              <CalendarRow key={row.id} row={row} onToggle={onToggleCalendar} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
