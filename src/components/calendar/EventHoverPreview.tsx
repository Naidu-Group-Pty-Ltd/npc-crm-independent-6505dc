import { useState, useRef, useEffect } from 'react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { Clock, MapPin, User, Calendar, FileText, ExternalLink, Globe } from 'lucide-react';
import { formatInSydney, formatDateInSydney, getSydneyTzAbbr, isNonSydneyTimezone, formatInLocal } from '@/lib/timezoneUtils';
import { GHLEvent, GHLContact } from '@/hooks/useGHLCalendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EventHoverPreviewProps {
  event: GHLEvent;
  children: React.ReactNode;
  getStatusColor: (status: string, appointmentStatus?: string) => string;
  fetchContact?: (contactId: string) => Promise<GHLContact | null>;
  contactCache?: Map<string, GHLContact>;
  onViewDetails?: () => void;
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

export function EventHoverPreview({
  event,
  children,
  getStatusColor,
  fetchContact,
  contactCache,
  onViewDetails,
  className,
}: EventHoverPreviewProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [contact, setContact] = useState<GHLContact | null>(null);
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');
  const triggerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

  const startTime = safeParseISO(event.startTime);
  const endTime = safeParseISO(event.endTime);
  const duration = startTime && endTime ? differenceInMinutes(endTime, startTime) : null;

  // Load contact on hover
  useEffect(() => {
    if (isVisible && event.contactId && fetchContact) {
      // Check cache first
      if (contactCache?.has(event.contactId)) {
        setContact(contactCache.get(event.contactId)!);
      } else {
        fetchContact(event.contactId).then((c) => {
          if (c) setContact(c);
        });
      }
    }
  }, [isVisible, event.contactId, fetchContact, contactCache]);

  // Calculate position
  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Prefer bottom, but use top if not enough space
      setPosition(spaceBelow < 250 && spaceAbove > spaceBelow ? 'top' : 'bottom');
    }
  }, [isVisible]);

  const handleMouseEnter = () => {
    hoverTimeout.current = setTimeout(() => {
      setIsVisible(true);
    }, 300); // 300ms delay before showing
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
    }
    setIsVisible(false);
    setContact(null);
  };

  const color = event.calendarColor || '#3b82f6';

  return (
    <div
      ref={triggerRef}
      className={cn('relative', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {/* Hover Preview Card */}
      {isVisible && (
        <div
          ref={previewRef}
          className={cn(
            'absolute z-50 w-72 p-4 rounded-xl border bg-popover text-popover-foreground shadow-xl',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            'left-1/2 -translate-x-1/2'
          )}
          style={{ borderLeftWidth: '4px', borderLeftColor: color }}
        >
          {/* Arrow */}
          <div
            className={cn(
              'absolute left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-popover border',
              position === 'bottom' 
                ? '-top-1.5 border-t border-l' 
                : '-bottom-1.5 border-b border-r'
            )}
          />

          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm truncate">{event.title || 'Untitled Event'}</h4>
              {event.calendarName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3" />
                  {event.calendarName}
                </p>
              )}
            </div>
            <Badge className={cn('text-[10px] shrink-0', getStatusColor(event.status, event.appointmentStatus))}>
              {event.appointmentStatus || event.status}
            </Badge>
          </div>

          {/* Time & Duration */}
          <div className="flex items-center gap-2 text-sm mb-2">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <span className="font-medium">
                {formatInSydney(event.startTime)} – {formatInSydney(event.endTime)} {getSydneyTzAbbr(event.startTime)}
              </span>
              {duration && (
                <span className="text-muted-foreground ml-2">
                  ({duration >= 60 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : `${duration}m`})
                </span>
              )}
            </div>
          </div>

          {/* Local time reference for non-Sydney users */}
          {isNonSydneyTimezone() && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mb-2 ml-6">
              <Globe className="h-3 w-3 shrink-0" />
              Your time: {formatInLocal(event.startTime)} – {formatInLocal(event.endTime)}
            </div>
          )}

          {/* Date */}
          {startTime && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <Calendar className="h-4 w-4 shrink-0" />
              {formatDateInSydney(event.startTime)}
            </div>
          )}

          {/* Contact */}
          {(contact || event.contactId) && (
            <div className="flex items-center gap-2 text-sm mb-2">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              {contact ? (
                <div>
                  <span className="font-medium">
                    {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown'}
                  </span>
                  {contact.email && (
                    <span className="text-muted-foreground text-xs block">{contact.email}</span>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground animate-pulse">Loading contact...</span>
              )}
            </div>
          )}

          {/* Address */}
          {event.address && (
            <div className="flex items-start gap-2 text-sm mb-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-muted-foreground line-clamp-2">{event.address}</span>
            </div>
          )}

          {/* Notes */}
          {event.notes && (
            <div className="flex items-start gap-2 text-sm mb-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-muted-foreground line-clamp-2">{event.notes}</p>
            </div>
          )}

          {/* View Details Button */}
          {onViewDetails && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails();
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Full Details
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
