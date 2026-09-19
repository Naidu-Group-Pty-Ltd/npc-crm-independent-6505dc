import { useState, useEffect, useMemo, useRef } from 'react';
import { Users, ChevronDown, ChevronUp, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { format, parseISO } from 'date-fns';

interface BusySlot {
  start: string;
  end: string;
  title: string;
  showAs?: string;
}

interface TeamMemberAvailability {
  userId: string;
  username: string;
  busySlots: BusySlot[];
  error?: string;
  /**
   * False when this colleague has no Outlook mailbox linked.
   *
   * They used to be filtered out server-side, so a colleague who had never
   * connected Outlook was indistinguishable from one who did not exist — the
   * panel listed two of three people and said nothing about the third
   * (audit item 27).
   */
  outlookConnected?: boolean;
}

interface TeamOutlookAvailabilityProps {
  selectedDate?: string;
  proposedStartTime?: string;
  proposedEndTime?: string;
  compact?: boolean;
}

function formatSlotTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm');
  } catch {
    return '—';
  }
}

/**
 * Shows team Outlook availability inline in booking forms.
 * Auto-fetches when the selected date changes.
 */
export function TeamOutlookAvailability({
  selectedDate,
  proposedStartTime,
  proposedEndTime,
  compact = false,
}: TeamOutlookAvailabilityProps) {
  const [expanded, setExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [team, setTeam] = useState<TeamMemberAvailability[]>([]);
  const [fetched, setFetched] = useState(false);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const lastFetchedDate = useRef<string | null>(null);

  const fetchAvailability = async (dateStr: string) => {
    setIsLoading(true);
    try {
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;

      const { data } = await invokeSecureFunction('outlook-calendar', {
        action: 'teamAvailability',
        startTime: dayStart,
        endTime: dayEnd,
      });

      if (data?.success && data.team) {
        setTeam(data.team);
      }
      setFetched(true);
      lastFetchedDate.current = dateStr;
    } catch (err) {
      console.error('[TeamOutlookAvailability] Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-fetch when date changes
  useEffect(() => {
    if (selectedDate && selectedDate !== lastFetchedDate.current) {
      fetchAvailability(selectedDate);
    }
  }, [selectedDate]);

  const hasConflict = (slots: BusySlot[]) => {
    if (!proposedStartTime || !proposedEndTime) return false;
    const pStart = new Date(proposedStartTime).getTime();
    const pEnd = new Date(proposedEndTime).getTime();
    return slots.some(slot => {
      const sStart = new Date(slot.start).getTime();
      const sEnd = new Date(slot.end).getTime();
      return pStart < sEnd && sStart < pEnd;
    });
  };

  const getConflictingSlots = (slots: BusySlot[]) => {
    if (!proposedStartTime || !proposedEndTime) return [];
    const pStart = new Date(proposedStartTime).getTime();
    const pEnd = new Date(proposedEndTime).getTime();
    return slots.filter(slot => {
      const sStart = new Date(slot.start).getTime();
      const sEnd = new Date(slot.end).getTime();
      return pStart < sEnd && sStart < pEnd;
    });
  };

  const conflictCount = useMemo(() => {
    // An unconnected colleague reports nothing, so they can neither clash nor
    // be counted as clear.
    return team.filter(m => m.outlookConnected !== false && hasConflict(m.busySlots)).length;
  }, [team, proposedStartTime, proposedEndTime]);

  if (!selectedDate) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setExpanded(!expanded)}
          disabled={isLoading && !fetched}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Users className="h-3 w-3" />
          )}
          Outlook Availability
          {fetched && conflictCount > 0 && (
            <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-1">
              {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {fetched && conflictCount === 0 && team.length > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-success border-success/30">
              All free
            </Badge>
          )}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
        {expanded && fetched && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => selectedDate && fetchAvailability(selectedDate)}
            disabled={isLoading}
          >
            Refresh
          </Button>
        )}
      </div>

      {expanded && fetched && (
        <div className={cn(
          'rounded-lg border p-2 space-y-1.5',
          compact ? 'bg-muted/20' : 'bg-muted/30'
        )}>
          {team.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No team members with Outlook configured
            </p>
          ) : (
            team.map(member => {
              const conflict = hasConflict(member.busySlots);
              const conflictingSlots = getConflictingSlots(member.busySlots);
              const isMemberExpanded = expandedMember === member.userId;

              return (
                <div key={member.userId} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setExpandedMember(isMemberExpanded ? null : member.userId)}
                    className={cn(
                      'w-full flex items-center justify-between py-1.5 px-2 rounded text-xs transition-colors',
                      'hover:bg-muted/50',
                      conflict && 'bg-destructive/5 border border-destructive/20'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        member.outlookConnected === false ? 'bg-muted-foreground/40' :
                        member.error ? 'bg-muted-foreground/30' :
                        conflict ? 'bg-destructive' :
                        member.busySlots.length > 0 ? 'bg-brand-500' : 'bg-success'
                      )} />
                      <span className="font-medium truncate max-w-[120px]">{member.username}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {member.outlookConnected === false ? (
                        <span className="text-[10px] text-muted-foreground">Outlook not connected</span>
                      ) : member.error ? (
                        <span className="text-[10px] text-muted-foreground">Unavailable</span>
                      ) : member.busySlots.length === 0 ? (
                        <span className="text-[10px] text-success">Free all day</span>
                      ) : conflict ? (
                        <span className="text-[10px] text-destructive font-medium">
                          {conflictingSlots.length} conflict{conflictingSlots.length !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] text-brand-500">
                          {member.busySlots.length} busy slot{member.busySlots.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {member.busySlots.length > 0 && !member.error && (
                        <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', isMemberExpanded && 'rotate-180')} />
                      )}
                    </div>
                  </button>

                  {/* Expanded busy slot details */}
                  {isMemberExpanded && member.busySlots.length > 0 && (
                    <div className="ml-6 space-y-0.5">
                      {member.busySlots.map((slot, idx) => {
                        const isConflicting = conflictingSlots.some(
                          cs => cs.start === slot.start && cs.end === slot.end
                        );
                        return (
                          <div
                            key={idx}
                            className={cn(
                              'flex items-center gap-2 text-[10px] py-0.5 px-1.5 rounded',
                              isConflicting ? 'text-destructive bg-destructive/5' : 'text-muted-foreground'
                            )}
                          >
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            <span className="font-medium">
                              {formatSlotTime(slot.start)}–{formatSlotTime(slot.end)}
                            </span>
                            <span className="truncate max-w-[100px]">{slot.title}</span>
                            {slot.showAs && slot.showAs !== 'busy' && (
                              <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3">
                                {slot.showAs === 'tentative' ? 'Tentative' : slot.showAs === 'oof' ? 'OOF' : slot.showAs}
                              </Badge>
                            )}
                            {isConflicting && (
                              <Badge variant="destructive" className="text-[8px] px-0.5 py-0 h-3">
                                Overlap
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
