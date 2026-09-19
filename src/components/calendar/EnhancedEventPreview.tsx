import { useState } from 'react';
import { Calendar, Clock, MapPin, User, Phone, Mail, Check, RefreshCw, X, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Skeleton } from '@/components/ui/skeleton';
import { format, parseISO } from 'date-fns';
import { GHLEvent, GHLContact } from '@/hooks/useGHLCalendar';

interface EnhancedEventPreviewProps {
  event: GHLEvent;
  getStatusColor: (status: string, appointmentStatus?: string) => string;
  fetchContact: (contactId: string) => Promise<GHLContact | null>;
  contactCache: Map<string, GHLContact>;
  onConfirm?: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
  onViewDetails: () => void;
  children: React.ReactNode;
}

export function EnhancedEventPreview({
  event,
  getStatusColor,
  fetchContact,
  contactCache,
  onConfirm,
  onReschedule,
  onCancel,
  onViewDetails,
  children,
}: EnhancedEventPreviewProps) {
  const [contact, setContact] = useState<GHLContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);

  const handleOpen = async () => {
    if (event.contactId && !contact && !contactCache[event.contactId]) {
      setLoadingContact(true);
      const fetchedContact = await fetchContact(event.contactId);
      setContact(fetchedContact);
      setLoadingContact(false);
    } else if (event.contactId && contactCache.get(event.contactId)) {
      setContact(contactCache.get(event.contactId) || null);
    }
  };

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

  const startDate = safeParseISO(event.startTime);
  const endDate = safeParseISO(event.endTime);
  const displayContact = contact || (event.contactId ? contactCache.get(event.contactId) : null) || null;
  const status = (event.appointmentStatus || event.status || '').toLowerCase();
  const canConfirm = status !== 'confirmed' && status !== 'cancelled' && status !== 'canceled';
  const canCancel = status !== 'cancelled' && status !== 'canceled';

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={(open) => open && handleOpen()}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent 
        className="w-80 p-0 overflow-hidden" 
        side="right" 
        align="start"
        sideOffset={8}
      >
        {/* Header with color */}
        <div 
          className="p-3 text-foreground"
          style={{ backgroundColor: event.calendarColor || '#3b82f6' }}
        >
          <h4 className="font-medium text-sm truncate">{event.title || 'Untitled Event'}</h4>
          {event.calendarName && (
            <p className="text-xs opacity-80 mt-0.5">{event.calendarName}</p>
          )}
        </div>

        <div className="p-3 space-y-3">
          {/* Date & Time */}
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-sm">
              {startDate && (
                <>
                  <div className="font-medium">{format(startDate, 'EEEE, MMMM d, yyyy')}</div>
                  <div className="text-muted-foreground">
                    {format(startDate, 'h:mm a')}
                    {endDate && ` - ${format(endDate, 'h:mm a')}`}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <Badge className={`text-xs ${getStatusColor(event.status, event.appointmentStatus)}`}>
              {event.appointmentStatus || event.status}
            </Badge>
          </div>

          {/* Location */}
          {event.address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <span className="text-sm text-muted-foreground">{event.address}</span>
            </div>
          )}

          {/* Contact info */}
          {loadingContact ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : displayContact ? (
            <div className="space-y-1.5 p-2 bg-muted/30 rounded-md">
              <div className="flex items-center gap-2">
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {displayContact.firstName} {displayContact.lastName}
                </span>
              </div>
              {displayContact.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3 w-3 text-muted-foreground" />
                  <a 
                    href={`tel:${displayContact.phone}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {displayContact.phone}
                  </a>
                </div>
              )}
              {displayContact.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  <a 
                    href={`mailto:${displayContact.email}`}
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {displayContact.email}
                  </a>
                </div>
              )}
            </div>
          ) : null}

          {/* Notes preview */}
          {event.notes && (
            <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/30 p-2 rounded">
              {event.notes}
            </p>
          )}

          {/* Quick actions */}
          <div className="flex items-center gap-1.5 pt-2 border-t">
            {canConfirm && onConfirm && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs flex-1"
                onClick={(e) => { e.stopPropagation(); onConfirm(); }}
              >
                <Check className="h-3 w-3 mr-1" />
                Confirm
              </Button>
            )}
            {onReschedule && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs flex-1"
                onClick={(e) => { e.stopPropagation(); onReschedule(); }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Reschedule
              </Button>
            )}
            {canCancel && onCancel && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            <Button 
              size="sm" 
              variant="default" 
              className="h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
