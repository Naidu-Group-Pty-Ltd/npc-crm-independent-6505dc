import { useEffect, useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FALLBACK_CALENDAR_COLOR } from '@/lib/calendarColors';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar, Clock, User, MapPin, FileText, Phone, Mail, Trash2, Edit2, Save, X, CalendarClock, RefreshCw, Globe, Users, UserPlus, Plus, Loader2 } from 'lucide-react';
import { format, parseISO, addMinutes, differenceInMinutes } from 'date-fns';
import { toTimezoneISO } from '@/lib/sydneyTime';
import { formatInSydney, formatDateInSydney, getSydneyTzAbbr, getSydneyDateTimeParts, isNonSydneyTimezone, formatInLocal } from '@/lib/timezoneUtils';
import { getBookingTimezone, AUSTRALIAN_TIMEZONES } from '@/lib/bookingTimezone';
import { GHLEvent, GHLCalendar, GHLContact } from '@/hooks/useGHLCalendar';
import { useFinanceContacts, FinanceContact } from '@/hooks/useFinanceContacts';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import type { BookingRecipient } from './QuickAddAppointmentModal';

interface ContactDetails {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
}

export interface RescheduleData {
  newStartTime: string;
  newEndTime: string;
  originalStartTime?: string;
  originalEndTime?: string;
  overrideAvailability?: boolean;
  assignedUserId?: string;
  secondaryRecipients?: { financeContactId: string; name: string; email: string }[];
  bookingRecipients?: { name: string; email: string }[];
  notes?: string;
}

interface EventDetailsModalProps {
  event: GHLEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getStatusColor: (status: string, appointmentStatus?: string) => string;
  fetchContact?: (contactId: string) => Promise<ContactDetails | null>;
  onUpdateEvent?: (eventId: string, updates: { title?: string; notes?: string; appointmentStatus?: string }) => Promise<{ success: boolean }>;
  onDeleteEvent?: (eventId: string) => Promise<{ success: boolean }>;
  onRescheduleEvent?: (eventId: string, rescheduleData: RescheduleData) => Promise<{ success: boolean; undo?: () => Promise<boolean> }>;
  calendars?: GHLCalendar[];
}

const APPOINTMENT_STATUSES = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'showed', label: 'Showed' },
  { value: 'noshow', label: 'No Show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'pending', label: 'Pending' },
];

const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
];

/**
 * How a recipient's role reads on screen.
 *
 * `recipient_role` is a database column and its values are database
 * vocabulary; an operator reads "Additional contact", not
 * `additional_contact`.
 */
const INVITED_ROLE_LABEL: Record<string, string> = {
  client: 'Client',
  additional_contact: 'Additional contact',
  finance_partner: 'Finance partner',
};

export function EventDetailsModal({ 
  event, 
  open, 
  onOpenChange, 
  getStatusColor, 
  fetchContact,
  onUpdateEvent,
  onDeleteEvent,
  onRescheduleEvent,
  calendars = [],
}: EventDetailsModalProps) {
  const { contacts: financeContacts, isLoading: isLoadingFinanceContacts } = useFinanceContacts();
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStatus, setEditStatus] = useState('');
  
  // Reschedule form state
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleDuration, setRescheduleDuration] = useState(30);
  const [rescheduleTimezone, setRescheduleTimezone] = useState<string>(() => getBookingTimezone());
  // A reschedule usually happens for a reason and the form had nowhere to
  // record one (audit item 29). Seeded from the booking's existing notes so
  // rescheduling never silently discards them.
  const [rescheduleNotes, setRescheduleNotes] = useState('');
  
  // New: Override availability, team member, finance contacts, booking recipients
  const [overrideAvailability, setOverrideAvailability] = useState(false);
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<string>('');
  const [selectedFinanceContacts, setSelectedFinanceContacts] = useState<FinanceContact[]>([]);
  const [bookingRecipients, setBookingRecipients] = useState<BookingRecipient[]>([]);
  /**
   * Who was invited when this appointment was booked.
   *
   * The window showed the client and nobody else, so an operator could not
   * tell whether the additional contact and the finance partner had been
   * included — and rescheduling made them add everyone again by hand. The
   * booking already records this; it was simply never read back.
   */
  const [invitedRecipients, setInvitedRecipients] = useState<
    { name: string; email: string; role?: string | null }[]
  >([]);
  /**
   * Whether the invitation ledger could be read at all.
   *
   * An empty list and a failed read drew the same thing — nothing — so an
   * operator could not tell "nobody else was invited" from "this window could
   * not find out". Both are real states and they lead to different actions.
   */
  const [invitedState, setInvitedState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [manualRecipientName, setManualRecipientName] = useState('');
  const [manualRecipientEmail, setManualRecipientEmail] = useState('');

  useEffect(() => {
    if (!open || !event?.id) {
      setInvitedRecipients([]);
      setInvitedState('loading');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await invokeSecureFunction('get-client-data', {
          listMode: true,
          listOptions: {
            table: 'appointment_secondary_recipients',
            select: 'contact_name, contact_email, recipient_role',
            filters: { appointment_ghl_id: event.id },
          },
        });
        if (cancelled) return;
        const seen = new Set<string>();
        const rows = (data?.records || [])
          .map((r: { contact_name?: string | null; contact_email?: string | null; recipient_role?: string | null }) => ({
            name: (r.contact_name || '').trim(),
            email: (r.contact_email || '').trim(),
            role: r.recipient_role ?? null,
          }))
          .filter((r: { email: string }) => {
            const key = r.email.toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        setInvitedRecipients(rows);
        setInvitedState('ready');
      } catch {
        // A booking whose invitations cannot be read still opens: this is a
        // record of who was told, not a precondition for viewing the meeting.
        if (!cancelled) {
          setInvitedRecipients([]);
          setInvitedState('unavailable');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, event?.id]);

  useEffect(() => {
    if (open && event?.contactId && fetchContact) {
      setLoadingContact(true);
      setContact(null);
      fetchContact(event.contactId)
        .then(data => setContact(data))
        .finally(() => setLoadingContact(false));
    } else if (!open) {
      setContact(null);
      setIsEditing(false);
      setIsRescheduling(false);
    }
  }, [open, event?.contactId, fetchContact]);

  /**
   * Start a reschedule from who was actually invited.
   *
   * The form used to start empty and then guess, by looking the client up and
   * pulling their secondary contact and additional contacts out of the CRM —
   * which is a different question from "who was invited to THIS booking", and
   * left the finance partner out entirely. The booking's own ledger answers
   * the real question; the CRM pass below still runs, so somebody added to the
   * client since the booking is still offered.
   */
  useEffect(() => {
    if (!isRescheduling || invitedState !== 'ready' || invitedRecipients.length === 0) return;
    setBookingRecipients((prev) => {
      const have = new Set(prev.map((r) => r.email.toLowerCase()));
      const added = invitedRecipients
        .filter((r) => r.email && !have.has(r.email.toLowerCase()))
        // The client is told by the booking's own confirmation; this list is
        // the people the command centre invites alongside them.
        .filter((r) => r.role !== 'client')
        .map((r) => ({ name: r.name || r.email, email: r.email, source: 'auto' as const }));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [isRescheduling, invitedState, invitedRecipients]);

  // Auto-populate booking recipients from client DB when contact loads
  useEffect(() => {
    if (!contact?.email || !isRescheduling) return;
    
    const autoPopulate = async () => {
      const contactEmail = contact.email?.toLowerCase()?.trim();
      if (!contactEmail) return;
      
      try {
        const { data: clientData } = await supabase
          .from('clients')
          .select('id, secondary_first_name, secondary_surname, secondary_email')
          .or(`primary_email.ilike.${contactEmail},secondary_email.ilike.${contactEmail}`)
          .limit(1)
          .single();
        
        if (clientData) {
          const autoRecipients: BookingRecipient[] = [];
          
          if (clientData.secondary_email && clientData.secondary_first_name) {
            const secName = [clientData.secondary_first_name, clientData.secondary_surname].filter(Boolean).join(' ');
            if (!bookingRecipients.some(r => r.email.toLowerCase() === clientData.secondary_email!.toLowerCase())) {
              autoRecipients.push({ name: secName, email: clientData.secondary_email, source: 'auto' });
            }
          }
          
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
        console.log('Could not auto-populate secondary contacts for reschedule:', err);
      }
    };
    
    autoPopulate();
  }, [contact?.email, isRescheduling]);

  useEffect(() => {
    if (event) {
      setEditTitle(event.title || '');
      setEditNotes(event.notes || '');
      setEditStatus(event.appointmentStatus || event.status || '');
      
      setRescheduleNotes(event.notes || '');
      // Initialize reschedule form with current event times in Sydney timezone
      const sydneyStart = getSydneyDateTimeParts(event.startTime);
      setRescheduleDate(sydneyStart.dateStr);
      setRescheduleTime(sydneyStart.timeStr);
      
      // Calculate duration from the actual UTC timestamps
      const startDate = parseISO(event.startTime);
      const endDate = parseISO(event.endTime);
      setRescheduleDuration(differenceInMinutes(endDate, startDate));
    }
  }, [event]);

  if (!event) return null;

  const startDate = parseISO(event.startTime);
  const endDate = parseISO(event.endTime);
  const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
  const calendarColor = event.calendarColor || FALLBACK_CALENDAR_COLOR;
  const tzAbbr = getSydneyTzAbbr(event.startTime);
  const showLocalTime = isNonSydneyTimezone();

  const contactName = contact?.name || 
    (contact?.firstName || contact?.lastName 
      ? `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() 
      : null);

  // Determine if event's calendar is round-robin
  const eventCalendar = calendars.find(c => c.id === event.calendarId);
  const isRoundRobin = eventCalendar?.calendarType?.toLowerCase().includes('round_robin') || 
                       eventCalendar?.calendarType?.toLowerCase().includes('round-robin') ||
                       eventCalendar?.calendarType?.toLowerCase() === 'round_robin';
  const teamMembers = eventCalendar?.teamMembers;
  const showTeamMemberSelector = isRoundRobin && teamMembers && teamMembers.length > 1;

  const handleSave = async () => {
    if (!onUpdateEvent) return;
    setIsSaving(true);
    const result = await onUpdateEvent(event.id, {
      title: editTitle,
      notes: editNotes,
      appointmentStatus: editStatus,
    });
    setIsSaving(false);
    if (result.success) {
      logActivityDirect({
        actionType: 'appointment_updated',
        entityType: 'appointment',
        entityId: event.id,
        entityName: editTitle,
        metadata: { status: editStatus }
      });
      setIsEditing(false);
    }
  };

  const handleReschedule = async () => {
    if (!onRescheduleEvent || !rescheduleDate || !rescheduleTime) return;
    
    setIsSaving(true);
    
    const newStartISO = toTimezoneISO(rescheduleDate, rescheduleTime, rescheduleTimezone);
    
    const [hours, minutes] = rescheduleTime.split(':').map(Number);
    const endTotalMinutes = hours * 60 + minutes + rescheduleDuration;
    const endHours = Math.floor(endTotalMinutes / 60) % 24;
    const endMins = endTotalMinutes % 60;
    const endTimeStr = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
    const newEndISO = toTimezoneISO(rescheduleDate, endTimeStr, rescheduleTimezone);

    const secondaryRecipients = selectedFinanceContacts.map(fc => ({
      financeContactId: fc.id,
      name: fc.name,
      email: fc.email,
    }));

    const bookingRecipientsPayload = bookingRecipients.map(r => ({
      name: r.name,
      email: r.email,
    }));
    
    const result = await onRescheduleEvent(event.id, {
      newStartTime: newStartISO,
      newEndTime: newEndISO,
      originalStartTime: event.startTime,
      originalEndTime: event.endTime,
      overrideAvailability: overrideAvailability || undefined,
      assignedUserId: (selectedTeamMemberId && selectedTeamMemberId !== 'auto') ? selectedTeamMemberId : undefined,
      secondaryRecipients: secondaryRecipients.length > 0 ? secondaryRecipients : undefined,
      bookingRecipients: bookingRecipientsPayload.length > 0 ? bookingRecipientsPayload : undefined,
      notes: rescheduleNotes,
    });
    
    setIsSaving(false);
    if (result.success) {
      logActivityDirect({
        actionType: 'appointment_rescheduled',
        entityType: 'appointment',
        entityId: event.id,
        entityName: event.title,
      });
      setIsRescheduling(false);
      // Reset reschedule-specific state
      setOverrideAvailability(false);
      setSelectedTeamMemberId('');
      setSelectedFinanceContacts([]);
      setBookingRecipients([]);
      setManualRecipientName('');
      setManualRecipientEmail('');
    }
  };

  const handleDelete = async () => {
    if (!onDeleteEvent) return;
    const result = await onDeleteEvent(event.id);
    if (result.success) {
      logActivityDirect({
        actionType: 'appointment_deleted',
        entityType: 'appointment',
        entityId: event.id,
        entityName: event.title,
      });
      onOpenChange(false);
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(event.title || '');
    setEditNotes(event.notes || '');
    setEditStatus(event.appointmentStatus || event.status || '');
    setIsEditing(false);
  };

  const handleCancelReschedule = () => {
    const sydneyStart = getSydneyDateTimeParts(event.startTime);
    const startDate = parseISO(event.startTime);
    const endDate = parseISO(event.endTime);
    setRescheduleDate(sydneyStart.dateStr);
    setRescheduleTime(sydneyStart.timeStr);
    setRescheduleDuration(differenceInMinutes(endDate, startDate));
    setIsRescheduling(false);
    setOverrideAvailability(false);
    setSelectedTeamMemberId('');
    setSelectedFinanceContacts([]);
    setBookingRecipients([]);
    setManualRecipientName('');
    setManualRecipientEmail('');
  };

  const handleStartRescheduling = () => {
    setIsRescheduling(true);
    // Auto-populate will trigger via the useEffect when isRescheduling becomes true
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            {isEditing ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-lg font-semibold"
                placeholder="Event title"
              />
            ) : (
              <DialogTitle className="text-xl leading-tight pr-8">
                {event.title || 'Untitled Event'}
              </DialogTitle>
            )}
          </div>
          {isEditing ? (
            <Select value={editStatus} onValueChange={setEditStatus}>
              <SelectTrigger className="w-fit mt-2">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {APPOINTMENT_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge className={`w-fit mt-2 ${getStatusColor(event.status, event.appointmentStatus)}`}>
              {event.appointmentStatus || event.status}
            </Badge>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 pt-2 pr-4">
          {/* Date & Time - with reschedule form */}
          {isRescheduling ? (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <CalendarClock className="h-4 w-4" />
                Reschedule Appointment
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="reschedule-date" className="text-xs">Date</Label>
                  <Input
                    id="reschedule-date"
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reschedule-time" className="text-xs">Time</Label>
                  <Input
                    id="reschedule-time"
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              {/* Timezone Selector */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Timezone
                </Label>
                <Select value={rescheduleTimezone} onValueChange={setRescheduleTimezone}>
                  <SelectTrigger className="h-9 text-xs">
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
              
              <div className="space-y-2">
                <Label className="text-xs">Duration</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRescheduleDuration(opt.value)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                        rescheduleDuration === opt.value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border hover:bg-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Team Member Selector (for round-robin calendars) */}
              {showTeamMemberSelector && (
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    Assign Team Member
                  </Label>
                  <Select value={selectedTeamMemberId} onValueChange={setSelectedTeamMemberId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Auto-assign (round robin)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-assign (round robin)</SelectItem>
                      {teamMembers!.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{member.name || member.email || member.userId}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Round-robin calendar — select a specific team member or leave as auto-assign.
                  </p>
                </div>
              )}

              {/* Additional Invite Recipients (Booking Recipients) */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <UserPlus className="h-3 w-3 text-muted-foreground" />
                  Additional Invite Recipients
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Extra people to receive the updated booking invite.
                </p>
                
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
                
                <div className="flex gap-2">
                  <Input
                    placeholder="Name"
                    value={manualRecipientName}
                    onChange={(e) => setManualRecipientName(e.target.value)}
                    className="flex-1 h-8 text-xs"
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
                    className="flex-1 h-8 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleAddManualRecipient}
                    disabled={!manualRecipientEmail.trim()}
                    className="shrink-0 h-8 w-8"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Finance Contacts */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  Notify Finance Contacts
                </Label>
                {isLoadingFinanceContacts ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading contacts...
                  </div>
                ) : financeContacts.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground p-1">No finance contacts configured.</p>
                ) : (
                  <div className="space-y-2">
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
                    <div className="flex flex-wrap gap-1.5">
                      {financeContacts
                        .filter(fc => !selectedFinanceContacts.some(s => s.id === fc.id))
                        .map(fc => (
                          <button
                            key={fc.id}
                            type="button"
                            onClick={() => setSelectedFinanceContacts(prev => [...prev, fc])}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                          >
                            <Mail className="h-3 w-3" />
                            {fc.name}
                            {fc.is_default && <span className="text-[10px] opacity-60">(Default)</span>}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Override Availability Toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-background">
                <div className="space-y-0.5">
                  <Label htmlFor="reschedule-override" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    Override availability
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Book outside configured availability window
                  </p>
                </div>
                <button
                  id="reschedule-override"
                  type="button"
                  role="switch"
                  aria-checked={overrideAvailability}
                  onClick={() => setOverrideAvailability(prev => !prev)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    overrideAvailability ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                      overrideAvailability ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              
              <div className="space-y-2 pt-2">
                <Label htmlFor="reschedule-notes" className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Notes
                </Label>
                <Textarea
                  id="reschedule-notes"
                  value={rescheduleNotes}
                  onChange={(e) => setRescheduleNotes(e.target.value)}
                  placeholder="Why is this moving? Anything the attendees should know."
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">{formatDateInSydney(event.startTime)}</p>
                <p className="text-sm text-muted-foreground">
                  {formatInSydney(event.startTime)} – {formatInSydney(event.endTime)} {tzAbbr} ({durationMinutes} min)
                </p>
                {showLocalTime && (
                  <p className="text-xs text-muted-foreground/70 flex items-center gap-1 mt-0.5">
                    <Globe className="h-3 w-3" />
                    Your time: {formatInLocal(event.startTime)} – {formatInLocal(event.endTime)}
                  </p>
                )}
              </div>
              {onRescheduleEvent && !isEditing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleStartRescheduling}
                  className="h-8 px-2"
                >
                  <CalendarClock className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* Calendar */}
          {event.calendarName && (
            <div className="flex items-start gap-3">
              <div 
                className="h-5 w-5 rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: calendarColor }}
              />
              <div>
                <p className="text-sm text-muted-foreground">Calendar</p>
                <p className="font-medium">{event.calendarName}</p>
              </div>
            </div>
          )}

          <Separator />

          {/* Contact Info */}
          {event.contactId && (
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <User className="h-4 w-4" />
                Contact Information
              </h4>
              {loadingContact ? (
                <div className="pl-6 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : contact ? (
                <div className="pl-6 space-y-2 text-sm">
                  {contactName && (
                    <p className="font-medium text-foreground">{contactName}</p>
                  )}
                  {contact.companyName && (
                    <p className="text-muted-foreground">{contact.companyName}</p>
                  )}
                  {contact.email && (
                    <a 
                      href={`mailto:${contact.email}`} 
                      className="flex items-center gap-2 text-primary hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a 
                      href={`tel:${contact.phone}`} 
                      className="flex items-center gap-2 text-primary hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {contact.phone}
                    </a>
                  )}
                </div>
              ) : (
                <div className="pl-6 space-y-2 text-sm">
                  <p className="text-muted-foreground">Contact ID: {event.contactId}</p>
                </div>
              )}
            </div>
          )}

          {/*
            Who else was invited, always drawn once the read has settled.
            It used to be hidden when the list was empty, so a booking that had
            recorded nobody was indistinguishable from one this window could
            not read — and until the ledger's `finance_contact_id` stopped
            being NOT NULL, it recorded nobody but the finance partner.
          */}
          {invitedState !== 'loading' && (
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Also invited{invitedRecipients.length > 0 ? ` (${invitedRecipients.length})` : ''}
              </h4>
              <div className="pl-6 space-y-1.5 text-sm">
                {invitedState === 'unavailable' ? (
                  <p className="text-xs text-muted-foreground">
                    The list of people invited to this booking could not be read just now.
                  </p>
                ) : invitedRecipients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nobody else was invited to this booking.
                  </p>
                ) : (
                  <>
                    {invitedRecipients.map((r) => (
                      <div key={r.email} className="flex min-w-0 flex-wrap items-center gap-x-2">
                        {r.name && <span className="font-medium text-foreground">{r.name}</span>}
                        <a href={`mailto:${r.email}`} className="min-w-0 truncate text-primary hover:underline">
                          {r.email}
                        </a>
                        {r.role && (
                          <Badge variant="outline" className="text-[10px]">
                            {INVITED_ROLE_LABEL[r.role] ?? r.role}
                          </Badge>
                        )}
                      </div>
                    ))}
                    <p className="pt-1 text-xs text-muted-foreground">
                      These people are notified automatically when this appointment is rescheduled or cancelled.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Location */}
          {event.address && (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">{event.address}</p>
              </div>
            </div>
          )}

          {/* Notes */}
          <Separator />
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </h4>
            {isEditing ? (
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes..."
                className="min-h-[80px]"
              />
            ) : event.notes ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap pl-6">
                {event.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/50 pl-6 italic">No notes</p>
            )}
          </div>

          {/* Event ID for reference */}
          <Separator />
          <div className="text-xs text-muted-foreground">
            Event ID: {event.id}
          </div>
        </div>
        </ScrollArea>

        {/* Footer with actions */}
        {/* The reschedule actions are pinned here rather than living inside the
            scrolling body. They used to sit below "Notify Finance Contacts",
            past the fold, and the footer was suppressed while rescheduling — so
            the primary action of the screen was off-screen with no scrollbar
            visible to suggest it existed (audit item 29). */}
        {isRescheduling && (
          <DialogFooter className="shrink-0 flex-row gap-2 pt-4 sm:justify-between">
            <Button
              variant="outline"
              onClick={handleCancelReschedule}
              disabled={isSaving}
              className="flex-1"
            >
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleReschedule}
              disabled={isSaving || !rescheduleDate || !rescheduleTime}
              className="flex-1"
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              {isSaving ? 'Saving…' : 'Confirm reschedule'}
            </Button>
          </DialogFooter>
        )}

        {(onUpdateEvent || onDeleteEvent) && !isRescheduling && (
          <DialogFooter className="flex-row justify-between sm:justify-between gap-2 pt-4">
            {onDeleteEvent && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isSaving}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Event</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{event.title || 'this event'}"? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            
            {onUpdateEvent && (
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                      <Save className="h-4 w-4 mr-1" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    <Edit2 className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
