import { useCallback, useMemo } from 'react';
import { format, parseISO, areIntervalsOverlapping } from 'date-fns';
import { AlertTriangle, Clock, Calendar, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FALLBACK_CALENDAR_COLOR } from '@/lib/calendarColors';

interface ConflictCandidate {
  id: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  calendarId?: string;
  calendarName?: string;
  calendarColor?: string;
}

interface ConflictDetectionProps {
  events: ConflictCandidate[];
  onEventClick?: (event: any) => void;
  selectedDate?: Date | null;
}

interface Conflict {
  event1: any;
  event2: any;
  overlapMinutes: number;
  severity: 'low' | 'medium' | 'high';
}

export function ConflictDetection({ events, onEventClick, selectedDate }: ConflictDetectionProps) {
  const safeParseISO = (value: string | undefined): Date | null => {
    try {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const isDateSelected = selectedDate !== null && selectedDate !== undefined;

  /**
   * Pair-scan a list of events for overlaps.
   *
   * Extracted so the same rule can answer two questions: what clashes on the
   * day being looked at, and whether anything clashes anywhere else in view.
   * The panel used to answer only the first while claiming the second.
   */
  const findConflicts = useCallback((candidates: ConflictCandidate[]): Conflict[] => {
    const result: Conflict[] = [];
    const validEvents = candidates.filter(e => {
      const start = safeParseISO(e.startTime);
      const end = safeParseISO(e.endTime);
      return start && end;
    });

    for (let i = 0; i < validEvents.length; i++) {
      for (let j = i + 1; j < validEvents.length; j++) {
        const event1 = validEvents[i];
        const event2 = validEvents[j];

        const start1 = safeParseISO(event1.startTime)!;
        const end1 = safeParseISO(event1.endTime)!;
        const start2 = safeParseISO(event2.startTime)!;
        const end2 = safeParseISO(event2.endTime)!;

        try {
          const hasOverlap = areIntervalsOverlapping(
            { start: start1, end: end1 },
            { start: start2, end: end2 }
          );

          if (hasOverlap) {
            const overlapStart = start1 > start2 ? start1 : start2;
            const overlapEnd = end1 < end2 ? end1 : end2;
            const overlapMinutes = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / 60000);

            const event1Duration = (end1.getTime() - start1.getTime()) / 60000;
            const event2Duration = (end2.getTime() - start2.getTime()) / 60000;
            const overlapPercent = (overlapMinutes / Math.min(event1Duration, event2Duration)) * 100;

            let severity: 'low' | 'medium' | 'high' = 'low';
            if (overlapPercent > 75) severity = 'high';
            else if (overlapPercent > 25) severity = 'medium';

            result.push({ event1, event2, overlapMinutes, severity });
          }
        } catch {
          // Skip invalid intervals
        }
      }
    }

    return result.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.overlapMinutes - a.overlapMinutes;
    });
  }, []);

  // Everything the calendar is currently showing, Outlook included — the panel
  // is handed the same merged list the grid draws.
  const conflictsInView = useMemo(() => findConflicts(events), [events, findConflicts]);

  // Scoped to the day being looked at. `selectedDate` was read inside a memo
  // keyed only on `events`, so changing the day never recomputed this.
  const conflicts = useMemo(() => {
    if (!isDateSelected) return conflictsInView;
    return findConflicts(events.filter(e => {
      const start = safeParseISO(e.startTime);
      return start && start.toDateString() === selectedDate.toDateString();
    }));
  }, [events, isDateSelected, selectedDate, conflictsInView, findConflicts]);

  const elsewhereInView = conflictsInView.length - conflicts.length;

  const getSeverityColor = (severity: 'low' | 'medium' | 'high') => {
    switch (severity) {
      case 'high': return 'bg-destructive/20 text-destructive border-destructive/30';
      case 'medium': return 'bg-brand-500/20 text-brand-400 border-brand-500/30';
      case 'low': return 'bg-brand-500/20 text-brand-400 border-brand-500/30';
    }
  };

  const getSeverityIcon = (severity: 'low' | 'medium' | 'high') => {
    switch (severity) {
      case 'high': return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case 'medium': return <AlertTriangle className="h-4 w-4 text-brand-400" />;
      case 'low': return <AlertTriangle className="h-4 w-4 text-brand-400" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Conflict Detection
        </h3>
        <Badge variant="outline" className={cn(
          conflicts.length === 0 ? 'bg-success/20 text-success border-success/30' : 'bg-destructive/20 text-destructive border-destructive/30'
        )}>
          {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {conflicts.length === 0 ? (
        // Says WHICH appointments it checked. It used to claim "All
        // appointments are properly scheduled" having looked only at the
        // selected day, so a clash three days away read as a clean calendar —
        // which is what was reported, on a day that was not the one selected.
        <Card className="p-6 text-center bg-success/5 border-success/20">
          <div className="text-success mb-2">✓</div>
          <p className="text-sm font-medium text-success">
            {isDateSelected ? `No conflicts on ${format(selectedDate, 'EEE d MMM')}` : 'No Scheduling Conflicts'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {elsewhereInView > 0
              ? `${elsewhereInView} conflict${elsewhereInView !== 1 ? 's' : ''} on other days in view — clear the selected day to see ${elsewhereInView !== 1 ? 'them' : 'it'}.`
              : isDateSelected
                ? 'Nothing else in view clashes either.'
                : 'All appointments in view are properly scheduled'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
            {conflicts.map((conflict, idx) => {
              const start1 = safeParseISO(conflict.event1.startTime);
              const start2 = safeParseISO(conflict.event2.startTime);

              return (
                <Card key={idx} className={cn(
                  'p-3 transition-all hover:scale-[1.01]',
                  conflict.severity === 'high' && 'border-destructive/30 bg-destructive/5',
                  conflict.severity === 'medium' && 'border-brand-500/30 bg-brand-500/5',
                  conflict.severity === 'low' && 'border-brand-500/30 bg-brand-500/5'
                )}>
                  <div className="flex items-start gap-2 mb-2">
                    {getSeverityIcon(conflict.severity)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium capitalize">{conflict.severity} Overlap</span>
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(conflict.overlapMinutes)}min
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {/* Event 1 */}
                    <button
                      onClick={() => onEventClick?.(conflict.event1)}
                      className="w-full text-left p-2 rounded-md bg-background/50 hover:bg-background transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: conflict.event1.calendarColor || FALLBACK_CALENDAR_COLOR }}
                        />
                        <span className="text-xs font-medium truncate flex-1">
                          {conflict.event1.title || 'Untitled'}
                        </span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {start1 ? format(start1, 'MMM d, h:mm a') : '—'}
                      </div>
                    </button>

                    <div className="flex items-center justify-center">
                      <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        overlaps with
                      </div>
                    </div>

                    {/* Event 2 */}
                    <button
                      onClick={() => onEventClick?.(conflict.event2)}
                      className="w-full text-left p-2 rounded-md bg-background/50 hover:bg-background transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: conflict.event2.calendarColor || FALLBACK_CALENDAR_COLOR }}
                        />
                        <span className="text-xs font-medium truncate flex-1">
                          {conflict.event2.title || 'Untitled'}
                        </span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {start2 ? format(start2, 'MMM d, h:mm a') : '—'}
                      </div>
                    </button>
                  </div>
                </Card>
              );
            })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 pt-2 border-t">
        <div className="flex items-center gap-1 text-[10px]">
          <div className="w-2 h-2 rounded-full bg-destructive" />
          <span className="text-muted-foreground">High (&gt;75%)</span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <div className="w-2 h-2 rounded-full bg-brand-500" />
          <span className="text-muted-foreground">Medium (25-75%)</span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <div className="w-2 h-2 rounded-full bg-brand-500" />
          <span className="text-muted-foreground">Low (&lt;25%)</span>
        </div>
      </div>
    </div>
  );
}
