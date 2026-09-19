import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, User, Phone, Mail, Clock, Calendar as CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { format, parseISO } from 'date-fns';
import type { GHLEvent, GHLContact } from '@/hooks/useGHLCalendar';

interface EventWithContact extends GHLEvent {
  contact?: GHLContact | null;
}

interface CalendarSearchDropdownProps {
  events: GHLEvent[];
  contactCache: Map<string, GHLContact>;
  fetchContact: (contactId: string) => Promise<GHLContact | null>;
  onSelectEvent: (event: GHLEvent) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export function CalendarSearchDropdown({
  events,
  contactCache,
  fetchContact,
  onSelectEvent,
  searchQuery,
  setSearchQuery,
}: CalendarSearchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [eventsWithContacts, setEventsWithContacts] = useState<EventWithContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toSearchable = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

  // When search query changes, enrich events with contact info
  useEffect(() => {
    const enrichEvents = async () => {
      if (!searchQuery.trim()) {
        setEventsWithContacts([]);
        return;
      }

      setLoadingContacts(true);

      // Get unique contact IDs from events
      const contactIds = new Set(
        events.filter((e) => e.contactId).map((e) => e.contactId!)
      );

      // Fetch missing contacts
      const fetchPromises: Promise<void>[] = [];
      contactIds.forEach((id) => {
        if (!contactCache.has(id)) {
          fetchPromises.push(fetchContact(id).then(() => {}));
        }
      });

      await Promise.all(fetchPromises);

      // Map events with their contacts
      const enriched: EventWithContact[] = events.map((event) => ({
        ...event,
        contact: event.contactId ? contactCache.get(event.contactId) || null : null,
      }));

      setEventsWithContacts(enriched);
      setLoadingContacts(false);
    };

    enrichEvents();
  }, [searchQuery, events, contactCache, fetchContact]);

  // Filter results based on search query
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();

    return eventsWithContacts
      .filter((event) => {
        // Search in event fields
        if (toSearchable(event.title).includes(query)) return true;
        if (toSearchable(event.notes).includes(query)) return true;
        if (toSearchable(event.address).includes(query)) return true;

        // Search in contact fields
        if (event.contact) {
          const c = event.contact;
          const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ');
          if (toSearchable(c.name).includes(query)) return true;
          if (toSearchable(fullName).includes(query)) return true;
          if (toSearchable(c.email).includes(query)) return true;
          if (toSearchable(c.phone).includes(query)) return true;
        }

        return false;
      })
      .slice(0, 15); // Limit to 15 results
  }, [eventsWithContacts, searchQuery]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const safeParseISO = (value: string) => {
    try {
      const d = parseISO(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const handleSelectEvent = (event: GHLEvent) => {
    onSelectEvent(event);
    setIsOpen(false);
    setSearchQuery('');
  };

  const getContactDisplayName = (contact: GHLContact) => {
    if (contact.name) return contact.name;
    if (contact.firstName || contact.lastName) {
      return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    }
    return 'Unknown';
  };

  return (
    <div ref={containerRef} className="relative min-w-[240px] flex-1 sm:flex-none">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/80" />
        <SearchInput
          value={searchQuery}
          onValueChange={(value) => {
            setSearchQuery(value);
            setIsOpen(true);
          }}
          aria-label="Search events and contacts"
          placeholder="Search events, contacts..."
          onFocus={() => searchQuery.trim() && setIsOpen(true)}
          hideIcon
          className="h-10 w-full rounded-xl border-border bg-card/80 pl-10 pr-10 text-sm shadow-inner shadow-sm dark:shadow-black/20 transition-all placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/35 sm:w-[300px] lg:w-[340px]"
        />
        {searchQuery && (
          <button
            aria-label="Clear calendar search"
            onClick={() => {
              setSearchQuery('');
              setIsOpen(false);
            }}
            className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && searchQuery.trim() && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_22px_70px_hsl(0_0%_0%/0.45)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150">
          <ScrollArea className="max-h-[calc(100vh-180px)] sm:max-h-[520px]">
            {loadingContacts && filteredResults.length === 0 ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl bg-card/10 dark:bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/4 rounded bg-card/10 dark:bg-white/10" />
                      <Skeleton className="h-3 w-1/2 rounded bg-card/10 dark:bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="p-5 text-center text-sm text-muted-foreground">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/[0.04] text-primary/70">
                  <Search className="h-4 w-4" />
                </div>
                <p className="font-medium text-muted-foreground">No events found for "{searchQuery}"</p>
                <p className="mt-1 text-xs text-muted-foreground">Try a calendar, contact, address or note keyword.</p>
              </div>
            ) : (
              <div className="py-1">
                <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
                </div>
                {filteredResults.map((event) => {
                  const startDate = safeParseISO(event.startTime);

                  return (
                    <button
                      key={event.id}
                      aria-label={`Open ${event.title || 'Untitled'}${startDate ? ` on ${format(startDate, 'MMM d, yyyy')} at ${format(startDate, 'h:mm a')}` : ''}`}
                      onClick={() => handleSelectEvent(event)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"
                    >
                      {/* Calendar color indicator */}
                      <div
                        className="h-full min-h-[40px] w-1 shrink-0 rounded-full ring-1 ring-black/30"
                        style={{ backgroundColor: event.calendarColor || '#3b82f6' }}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{event.title || 'Untitled'}</div>

                        {/* Date/Time */}
                        {startDate && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <CalendarIcon className="h-3 w-3" />
                            <span>{format(startDate, 'MMM d, yyyy')}</span>
                            <Clock className="h-3 w-3 ml-1" />
                            <span>{format(startDate, 'h:mm a')}</span>
                          </div>
                        )}

                        {/* Contact info */}
                        {event.contact && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="secondary" className="gap-1 font-normal">
                              <User className="h-3 w-3" />
                              {getContactDisplayName(event.contact)}
                            </Badge>
                            {event.contact.phone && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Phone className="h-3 w-3" />
                                {event.contact.phone}
                              </span>
                            )}
                            {event.contact.email && (
                              <span className="flex items-center gap-1 text-muted-foreground truncate max-w-[140px]">
                                <Mail className="h-3 w-3 shrink-0" />
                                {event.contact.email}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Calendar name */}
                        {event.calendarName && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {event.calendarName}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
