import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Calendar, Clock, Plus, Loader2, Keyboard, User, Search, Phone, Mail, Video, PhoneCall, Globe, Users, X, UserPlus } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { toTimezoneISO } from '@/lib/sydneyTime';
import { describeNotificationPlan, planBookingNotifications } from '@/lib/calendar/bookingNotifications.pure';
import { getBookingTimezone, AUSTRALIAN_TIMEZONES } from '@/lib/bookingTimezone';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFinanceContacts, FinanceContact } from '@/hooks/useFinanceContacts';
import { supabase } from '@/integrations/supabase/client';
import type { GHLCalendar, GHLContact, GHLTeamMember } from '@/hooks/useGHLCalendar';
import { TeamOutlookAvailability } from './TeamOutlookAvailability';
import { suggestedAppointmentTitle } from '@/lib/calendar/appointmentTitle.pure';

export interface BookingRecipient {
  name: string;
  email: string;
  source: 'auto' | 'manual'; // auto = from client DB, manual = user typed
}

interface QuickAddAppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: GHLCalendar[];
  defaultDate?: Date;
  defaultHour?: number;
  isLoading: boolean;
  onSubmit: (data: {
    calendarId: string;
    title: string;
    startTime: string;
    endTime: string;
    contactId?: string;
    notes?: string;
    overrideAvailability?: boolean;
    assignedUserId?: string;
    secondaryRecipients?: { financeContactId: string; name: string; email: string }[];
    bookingRecipients?: { name: string; email: string }[];
    /**
     * The client, by ADDRESS rather than by CRM id.
     *
     * The dialog used to hand back a `contactId` and nothing else, so the
     * client could not be emailed from here even in principle — the CRM was
     * the only thing that knew how to reach them. Carrying the address makes
     * the booking announceable with no CRM at all.
     */
    client?: { name?: string; email?: string };
    /** What the operator actually chose: call | zoom | in-person. */
    appointmentType?: string;
  }) => Promise<boolean>;
  onSearchContacts?: (query: string) => Promise<GHLContact[]>;
}

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
];

const APPOINTMENT_TYPES = [
  { value: 'call', label: 'Phone Call', icon: PhoneCall },
  { value: 'zoom', label: 'Zoom Meeting', icon: Video },
  { value: 'in-person', label: 'In Person', icon: User },
];

export function QuickAddAppointmentModal({
  open,
  onOpenChange,
  calendars,
  defaultDate,
  defaultHour,
  isLoading,
  onSubmit,
  onSearchContacts,
}: QuickAddAppointmentModalProps) {
  const isMobile = useIsMobile();
  const { contacts: financeContacts, isLoading: isLoadingFinanceContacts } = useFinanceContacts();
  const [title, setTitle] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [notes, setNotes] = useState('');
  const [appointmentType, setAppointmentType] = useState('call');
  // True once the operator types in the title box. A suggestion may be
  // replaced when the type changes; their own wording never may.
  const [titleAuthored, setTitleAuthored] = useState(false);
  const [inputTimezone, setInputTimezone] = useState<string>(() => getBookingTimezone());
  const [selectedFinanceContacts, setSelectedFinanceContacts] = useState<FinanceContact[]>([]);
  const [overrideAvailability, setOverrideAvailability] = useState(false);
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<string>('');
  
  // Booking recipients state (secondary invite recipients)
  const [bookingRecipients, setBookingRecipients] = useState<BookingRecipient[]>([]);
  const [manualRecipientName, setManualRecipientName] = useState('');
  const [manualRecipientEmail, setManualRecipientEmail] = useState('');
  
  // Contact search state
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<GHLContact | null>(null);
  const [searchResults, setSearchResults] = useState<GHLContact[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // A new draft is initialised only on the closed-to-open transition. Calendar
  // selection and calendar query refreshes must never reinitialise this draft.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setTitle('');
      setNotes('');
      setContactSearch('');
      setSelectedContact(null);
      setSearchResults([]);
      setAppointmentType('call');
      setTitleAuthored(false);
      setSelectedFinanceContacts([]);
      setOverrideAvailability(false);
      setSelectedTeamMemberId('');
      setBookingRecipients([]);
      setManualRecipientName('');
      setManualRecipientEmail('');

      const d = defaultDate || new Date();
      setDate(format(d, 'yyyy-MM-dd'));

      if (defaultHour !== undefined) {
        setTime(`${String(defaultHour).padStart(2, '0')}:00`);
      } else {
        const currentHour = d.getHours();
        setTime(`${String(currentHour).padStart(2, '0')}:00`);
      }

      setSelectedCalendarId(currentCalendarId => currentCalendarId || calendars[0]?.id || '');

      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
    wasOpenRef.current = open;
  }, [open, defaultDate, defaultHour, calendars]);

  // Re-suggest the title when the appointment type changes.
  //
  // The title used to be written once, inside the contact picker, and nothing
  // revisited it — so picking "Zoom Meeting" and then switching to "Phone Call"
  // left a booking named "Zoom Meeting with <client>" and sent it out that way.
  // A suggestion follows the type; a title the operator typed is left alone,
  // which is what `titleAuthored` is for.
  useEffect(() => {
    if (!open || titleAuthored) return;
    const typeLabel = APPOINTMENT_TYPES.find(t => t.value === appointmentType)?.label || 'Appointment';
    const contactName = selectedContact
      ? selectedContact.name
        || `${selectedContact.firstName || ''} ${selectedContact.lastName || ''}`.trim()
      : '';
    // Before anyone is picked there is nothing to name, so the box stays empty
    // rather than filling with a bare type the operator did not ask for.
    if (!contactName) return;
    setTitle(suggestedAppointmentTitle({ typeLabel, contactName }));
  }, [open, appointmentType, selectedContact, titleAuthored]);

  // Calendar data can arrive after the dialog opens. Set only the missing
  // calendar value; all existing draft fields remain untouched.
  useEffect(() => {
    if (open && !selectedCalendarId && calendars.length > 0) {
      setSelectedCalendarId(calendars[0].id);
    }
  }, [open, selectedCalendarId, calendars]);

  // Debounced contact search
  useEffect(() => {
    if (!contactSearch.trim() || !onSearchContacts) {
      setSearchResults([]);
      setShowContactDropdown(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await onSearchContacts(contactSearch.trim());
        setSearchResults(results);
        setShowContactDropdown(results.length > 0);
      } catch (err) {
        console.error('Error searching contacts:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [contactSearch, onSearchContacts]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowContactDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (title.trim() && selectedCalendarId) {
          handleSubmit(new Event('submit') as any);
        }
        return;
      }

      if (e.altKey && !isNaN(Number(e.key))) {
        const num = Number(e.key);
        if (num >= 1 && num <= 6) {
          e.preventDefault();
          setDuration(DURATION_OPTIONS[num - 1].value);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, title, selectedCalendarId]);

  const handleSelectContact = async (contact: GHLContact) => {
    setSelectedContact(contact);
    setContactSearch('');
    setShowContactDropdown(false);
    
    // Suggest a title unless the operator has written their own.
    if (!titleAuthored) {
      const contactName = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
      const typeLabel = APPOINTMENT_TYPES.find(t => t.value === appointmentType)?.label || 'Appointment';
      setTitle(suggestedAppointmentTitle({ typeLabel, contactName }));
    }

    // Auto-populate secondary contacts from client database
    // Match by email to find the client record
    const contactEmail = contact.email?.toLowerCase()?.trim();
    if (contactEmail) {
      try {
        const { data: clientData } = await supabase
          .from('clients')
          .select('id, secondary_first_name, secondary_surname, secondary_email')
          .or(`primary_email.ilike.${contactEmail},secondary_email.ilike.${contactEmail}`)
          .limit(1)
          .single();
        
        if (clientData) {
          const autoRecipients: BookingRecipient[] = [];

          // Add secondary contact if exists
          if (clientData.secondary_email && clientData.secondary_first_name) {
            const secName = [clientData.secondary_first_name, clientData.secondary_surname].filter(Boolean).join(' ');
            // Don't add if already in the list
            if (!bookingRecipients.some(r => r.email.toLowerCase() === clientData.secondary_email!.toLowerCase())) {
              autoRecipients.push({
                name: secName,
                email: clientData.secondary_email,
                source: 'auto',
              });
            }
          }

          // Also check for additional contacts
          const { data: additionalContacts } = await supabase
            .from('client_additional_contacts')
            .select('first_name, surname, email')
            .eq('client_id', clientData.id)
            .not('email', 'is', null);

          if (additionalContacts) {
            for (const ac of additionalContacts) {
              if (ac.email && !bookingRecipients.some(r => r.email.toLowerCase() === ac.email!.toLowerCase())) {
                autoRecipients.push({
                  name: [ac.first_name, ac.surname].filter(Boolean).join(' '),
                  email: ac.email,
                  source: 'auto',
                });
              }
            }
          }

          if (autoRecipients.length > 0) {
            setBookingRecipients(prev => [...prev, ...autoRecipients]);
          }
        }
      } catch (err) {
        // Silently fail - auto-populate is best-effort
        console.log('Could not auto-populate secondary contacts:', err);
      }
    }
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    setContactSearch('');
    // Remove auto-populated recipients when clearing the contact
    setBookingRecipients(prev => prev.filter(r => r.source === 'manual'));
  };

  const getContactDisplayName = (contact: GHLContact): string => {
    if (contact.name) return contact.name;
    const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    return fullName || contact.email || contact.phone || 'Unknown Contact';
  };

  const handleAddManualRecipient = () => {
    const email = manualRecipientEmail.trim().toLowerCase();
    const name = manualRecipientName.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (bookingRecipients.some(r => r.email.toLowerCase() === email)) return;
    
    setBookingRecipients(prev => [...prev, {
      name: name || email.split('@')[0],
      email,
      source: 'manual',
    }]);
    setManualRecipientName('');
    setManualRecipientEmail('');
  };

  const handleRemoveBookingRecipient = (email: string) => {
    setBookingRecipients(prev => prev.filter(r => r.email !== email));
  };

  const openNativePicker = (inputRef: React.RefObject<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();
    // showPicker is not implemented by every browser; focusing the native input
    // remains a safe fallback that preserves its standard interaction.
    try {
      if (typeof (input as HTMLInputElement).showPicker === 'function') {
        (input as HTMLInputElement).showPicker();
        return;
      }
    } catch {
      // fall through to click fallback
    }
    input.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCalendarId || !date || !time || !title.trim()) return;

    const [hours, minutes] = time.split(':').map(Number);
    const durationMinutes = parseInt(duration, 10);

    // Calculate end time parts (handle hour overflow)
    const endTotalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(endTotalMinutes / 60) % 24;
    const endMins = endTotalMinutes % 60;
    const endTimeStr = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

    // Treat selected time as wall-clock time in the chosen timezone
    const startTimeISO = toTimezoneISO(date, time, inputTimezone);
    const endTimeISO = toTimezoneISO(date, endTimeStr, inputTimezone);

    const secondaryRecipients = selectedFinanceContacts.map(fc => ({
      financeContactId: fc.id,
      name: fc.name,
      email: fc.email,
    }));

    const bookingRecipientsPayload = bookingRecipients.map(r => ({
      name: r.name,
      email: r.email,
    }));

    const success = await onSubmit({
      calendarId: selectedCalendarId,
      title: title.trim(),
      startTime: startTimeISO,
      endTime: endTimeISO,
      contactId: selectedContact?.id,
      notes: notes.trim() || undefined,
      overrideAvailability: overrideAvailability || undefined,
      assignedUserId: selectedTeamMemberId || undefined,
      secondaryRecipients: secondaryRecipients.length > 0 ? secondaryRecipients : undefined,
      bookingRecipients: bookingRecipientsPayload.length > 0 ? bookingRecipientsPayload : undefined,
      client: selectedContact
        ? {
            name: selectedContact.name
              || [selectedContact.firstName, selectedContact.lastName].filter(Boolean).join(' ')
              || undefined,
            email: selectedContact.email || undefined,
          }
        : undefined,
      appointmentType,
    });

    if (success) {
      onOpenChange(false);
    }
  };

  // Who will actually be emailed, shown before the operator commits. The
  // client used to be invisible here because the CRM sent their confirmation
  // out of sight; now they are on the list like everyone else, and a client
  // with no address on file is called out rather than quietly skipped.
  const notificationPlan = planBookingNotifications({
    parties: [
      ...(selectedContact
        ? [{
            role: 'client' as const,
            name: selectedContact.name
              || [selectedContact.firstName, selectedContact.lastName].filter(Boolean).join(' '),
            email: selectedContact.email,
          }]
        : []),
      ...bookingRecipients.map((r) => ({
        role: 'additional_contact' as const, name: r.name, email: r.email,
      })),
      ...selectedFinanceContacts.map((fc) => ({
        role: 'finance_partner' as const, name: fc.name, email: fc.email, financeContactId: fc.id,
      })),
    ],
    // This workspace sends the client's confirmation itself, so a booking
    // made with no CRM behind it is announced exactly like one that has one.
    crm: { linked: !!selectedContact?.id, sendsClientConfirmation: false },
  });

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Appointment Type */}
      <div className="space-y-2">
        <Label>Type</Label>
        <div className={cn("flex gap-2", isMobile && "flex-wrap")}>
          {APPOINTMENT_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => setAppointmentType(type.value)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all',
                  isMobile ? 'flex-1 min-w-[30%] justify-center' : 'flex-1',
                  appointmentType === type.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className={isMobile ? "text-xs" : ""}>{type.label}</span>
              </button>
            );
          })}
        </div>
      </div>

          {/* Contact/Recipient Search */}
          <div className="space-y-2">
            <Label>Recipient</Label>
            {selectedContact ? (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {getContactDisplayName(selectedContact)}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selectedContact.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {selectedContact.phone}
                      </span>
                    )}
                    {selectedContact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {selectedContact.email}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearContact}
                  className="h-8 w-8 p-0"
                >
                  ×
                </Button>
              </div>
            ) : (
              <div className="relative" ref={dropdownRef}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <SearchInput
                    value={contactSearch}
                    onValueChange={setContactSearch}
                    placeholder="Search contacts by name, email, or phone..."
                    onFocus={() => searchResults.length > 0 && setShowContactDropdown(true)}
                    hideIcon
                    className="pl-8"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Contact Search Results Dropdown */}
                {showContactDropdown && searchResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => handleSelectContact(contact)}
                        className="w-full flex items-center gap-2 p-2 hover:bg-accent text-left transition-colors"
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary shrink-0">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {getContactDisplayName(contact)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {contact.phone && (
                              <span className="flex items-center gap-1 truncate">
                                <Phone className="h-3 w-3 shrink-0" />
                                {contact.phone}
                              </span>
                            )}
                            {contact.email && (
                              <span className="flex items-center gap-1 truncate">
                                <Mail className="h-3 w-3 shrink-0" />
                                {contact.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Secondary Booking Recipients */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              Additional Invite Recipients
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Add extra people to receive the booking invite (e.g. spouse, co-applicant).
            </p>

            {/* Current recipients as badges */}
            {bookingRecipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {bookingRecipients.map((r) => (
                  <Badge key={r.email} variant="secondary" className="flex items-center gap-1 pr-1">
                    <span className="text-xs">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">({r.email})</span>
                    {r.source === 'auto' && (
                      <span className="text-[9px] text-primary/70 ml-0.5">Auto</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBookingRecipient(r.email)}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Manual entry */}
            <div className="flex gap-2">
              <Input
                placeholder="Name"
                value={manualRecipientName}
                onChange={(e) => setManualRecipientName(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Email *"
                type="email"
                value={manualRecipientEmail}
                onChange={(e) => setManualRecipientEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddManualRecipient();
                  }
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Add invite recipient"
                onClick={handleAddManualRecipient}
                disabled={!manualRecipientEmail.trim()}
                className="shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              ref={titleInputRef}
              id="title"
              placeholder="Appointment title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleAuthored(true);
              }}
              required
            />
          </div>

          {/* Calendar */}
          <div className="space-y-2">
            <Label>Calendar *</Label>
            <Select
              value={selectedCalendarId}
              onValueChange={(nextCalendarId) => {
                if (nextCalendarId !== selectedCalendarId) setSelectedCalendarId(nextCalendarId);
              }}
            >
              {/* The trigger must not grow to fit its value. Radix renders the
                  selected item's own markup inside it, so a long calendar name
                  ("Mortgage Freedom Consultation") set the trigger's
                  max-content width, which widened the dialog and pushed the
                  time picker and the add-recipient button out of frame — the
                  reported "everything shifted a little to the right". */}
              <SelectTrigger className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                <Calendar className="h-4 w-4 mr-2 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="Select calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: cal.eventColor || '#3b82f6' }}
                      />
                      <span className="truncate">{cal.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Team Member Selector (for round-robin calendars) */}
          {(() => {
            const selectedCal = calendars.find(c => c.id === selectedCalendarId);
            const members = selectedCal?.teamMembers;
            const isRoundRobin = selectedCal?.calendarType?.toLowerCase().includes('round_robin') || 
                                 selectedCal?.calendarType?.toLowerCase().includes('round-robin') ||
                                 selectedCal?.calendarType?.toLowerCase() === 'round_robin';
            if (isRoundRobin && members && members.length > 1) {
              return (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Assign Team Member
                  </Label>
                  <Select value={selectedTeamMemberId} onValueChange={setSelectedTeamMemberId}>
                    <SelectTrigger className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                      <SelectValue placeholder="Auto-assign (round robin)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-assign (round robin)</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{member.name || member.email || member.userId}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    This is a round-robin calendar. Select a specific team member or leave as auto-assign.
                  </p>
                </div>
              );
            }
            return null;
          })()}

          {/* Date and Time */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <div className="relative">
                <Input
                  ref={dateInputRef}
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="has-custom-picker cursor-pointer pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open date picker"
                  onClick={() => openNativePicker(dateInputRef)}
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:ring-primary"
                >
                  <Calendar className="h-4 w-4" />
                </Button>
              </div>
            </div>
             <div className="space-y-2">
              <Label htmlFor="time">Time *</Label>
              <div className="relative">
                <Input
                  ref={timeInputRef}
                  id="time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="has-custom-picker cursor-pointer pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open time picker"
                  onClick={() => openNativePicker(timeInputRef)}
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:ring-primary"
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Timezone Selector */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              Timezone
            </Label>
            <Select value={inputTimezone} onValueChange={setInputTimezone}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUSTRALIAN_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration with keyboard shortcuts */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt, idx) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuration(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    duration === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  {opt.label}
                  <span className="ml-1 text-[10px] opacity-60">Alt+{idx + 1}</span>
                </button>
              ))}
            </div>
          </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Optional notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </div>

      {/* Secondary Recipients (Finance Contacts) */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          Notify Finance Contacts
        </Label>
        {isLoadingFinanceContacts ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading contacts...
          </div>
        ) : financeContacts.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">No finance contacts configured.</p>
        ) : (
          <div className="space-y-2">
            {/* Selected contacts as badges */}
            {selectedFinanceContacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedFinanceContacts.map(fc => (
                  <Badge key={fc.id} variant="secondary" className="flex items-center gap-1 pr-1">
                    <span className="text-xs">{fc.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFinanceContacts(prev => prev.filter(c => c.id !== fc.id))}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {/* Available contacts to add */}
            <div className="flex flex-wrap gap-1.5">
              {financeContacts
                .filter(fc => !selectedFinanceContacts.some(s => s.id === fc.id))
                .map(fc => (
                  <button
                    key={fc.id}
                    type="button"
                    onClick={() => setSelectedFinanceContacts(prev => [...prev, fc])}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
                      'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground',
                      fc.is_default && 'ring-1 ring-primary/30'
                    )}
                  >
                    <Mail className="h-3 w-3" />
                    {fc.name}
                    {fc.is_default && <span className="text-[10px] opacity-60">(Default)</span>}
                  </button>
                ))}
            </div>
            {selectedFinanceContacts.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {selectedFinanceContacts.length} contact{selectedFinanceContacts.length > 1 ? 's' : ''} will receive an email with a .ics calendar invite.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Override Availability Toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
        <div className="space-y-0.5">
          <Label htmlFor="override-availability" className="text-sm font-medium cursor-pointer flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            Override availability
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Book outside the calendar's configured availability window
          </p>
        </div>
        <button
          id="override-availability"
          type="button"
          role="switch"
          aria-checked={overrideAvailability}
          onClick={() => setOverrideAvailability(prev => !prev)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            overrideAvailability ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
              overrideAvailability ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      {/* Outlook Team Availability Check */}
      {date && time && (
        <TeamOutlookAvailability
          selectedDate={date}
          proposedStartTime={(() => {
            try {
              const startISO = toTimezoneISO(date, time, inputTimezone);
              return startISO;
            } catch { return undefined; }
          })()}
          proposedEndTime={(() => {
            try {
              const [h, m] = time.split(':').map(Number);
              const endMin = h * 60 + m + parseInt(duration);
              const endH = Math.floor(endMin / 60) % 24;
              const endM = endMin % 60;
              const endStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
              return toTimezoneISO(date, endStr, inputTimezone);
            } catch { return undefined; }
          })()}
          compact
        />
      )}

      {!isMobile && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          <Keyboard className="h-3 w-3" />
          <span><kbd className="px-1 bg-background rounded">⌘/Ctrl+Enter</kbd> to save</span>
          <span>•</span>
          <span><kbd className="px-1 bg-background rounded">Esc</kbd> to close</span>
          <span>•</span>
          <span><kbd className="px-1 bg-background rounded">Alt+1-6</kbd> duration</span>
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{describeNotificationPlan(notificationPlan)}</span>
        {notificationPlan.warnings.map((warning) => (
          <span key={warning} className="mt-1 block text-warning">{warning}</span>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || !title.trim() || !selectedCalendarId} className="flex-1">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              Create
            </>
          )}
        </Button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
          <DrawerHeader className="flex-shrink-0 pb-2">
            <DrawerTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Quick Add Appointment
            </DrawerTitle>
          </DrawerHeader>
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6"
            data-vaul-no-drag
          >
            {formContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-[95vw] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden gap-0 p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 pr-14">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Quick Add Appointment
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 pb-6">
            {formContent}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
