import { useState, useEffect, useMemo, useCallback } from 'react';
import { Mail, Plus, Trash2, Users, Clock, RefreshCw, Settings, Check, X, MapPin, FileText, Bell, Tag, ChevronDown, ChevronUp, Shield, Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { OutlookEvent, OutlookTeamMember, CreateOutlookEventPayload } from '@/hooks/useOutlookCalendar';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { OutlookCalendarSettings as OutlookCalendarSettingsComponent } from '@/components/calendar/OutlookCalendarSettings';
import { format, parseISO } from 'date-fns';
import { toTimezoneISO } from '@/lib/sydneyTime';
import { getBookingTimezone, AUSTRALIAN_TIMEZONES } from '@/lib/bookingTimezone';

interface OutlookCalendarPanelProps {
  outlookEvents: OutlookEvent[];
  teamAvailability: OutlookTeamMember[];
  isLoading: boolean;
  isCreating: boolean;
  outlookEnabled: boolean;
  microsoftEmail: string | null;
  onRefresh: () => void;
  onFetchTeam: () => void;
  onCreateEvent: (payload: CreateOutlookEventPayload) => Promise<any>;
  onDeleteEvent: (eventId: string) => Promise<boolean>;
  onSetMicrosoftEmail: (email: string | null) => Promise<boolean>;
  onGetMicrosoftEmail: () => Promise<string | null>;
  outlookVisible: boolean;
  onToggleOutlookVisible: () => void;
  selectedDate?: Date | null;
  onCreatePrepBlock?: (opts: {
    appointmentTitle: string;
    appointmentStartTime: string;
    clientName?: string;
    prepMinutes?: number;
    notes?: string;
  }) => Promise<any>;
}

const SHOW_AS_OPTIONS = [
  { value: 'busy', label: 'Busy' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'free', label: 'Free' },
  { value: 'oof', label: 'Out of Office' },
];

const REMINDER_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '5', label: '5 min before' },
  { value: '15', label: '15 min before' },
  { value: '30', label: '30 min before' },
  { value: '60', label: '1 hour before' },
];

const CATEGORY_PRESETS = [
  'Internal Meeting', 'Client Prep', 'Follow-Up', 'Team Sync', 'Admin', 'Training',
];

export function OutlookCalendarPanel({
  outlookEvents,
  teamAvailability,
  isLoading,
  isCreating,
  outlookEnabled,
  microsoftEmail,
  onRefresh,
  onFetchTeam,
  onCreateEvent,
  onDeleteEvent,
  onSetMicrosoftEmail,
  onGetMicrosoftEmail,
  outlookVisible,
  onToggleOutlookVisible,
  selectedDate,
  onCreatePrepBlock,
}: OutlookCalendarPanelProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<string | null>(null);

  // Event creation form
  const [newSubject, setNewSubject] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newTimezone, setNewTimezone] = useState<string>(() => getBookingTimezone());
  const [newBody, setNewBody] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newShowAs, setNewShowAs] = useState('busy');
  const [newReminder, setNewReminder] = useState('15');
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const [newAttendees, setNewAttendees] = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');

  const { data: teamUsers = [] } = useTeamUsers();

  useEffect(() => {
    onGetMicrosoftEmail().then(email => {
      if (email) setEmailInput(email);
    });
  }, []);

  // Pull the caller's account email so we can lock the mailbox input to it —
  // mirrors the server-side ownership guard in outlook-calendar.setMicrosoftEmail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invokeSecureFunction } = await import('@/lib/secureInvoke');
        const { data } = await invokeSecureFunction('admin-user-management', { action: 'get_own_profile' });
        if (cancelled) return;
        if (data?.success) {
          setAccountEmail(data.user?.email || null);
          setAccountRole(data.user?.role || null);
          if (data.user?.email && data.user?.role !== 'superadmin') {
            setEmailInput(data.user.email);
          }
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);


  useEffect(() => {
    if (selectedDate) {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      setNewStartTime(`${dateStr}T09:00`);
      setNewEndTime(`${dateStr}T09:30`);
    }
  }, [selectedDate]);

  const handleSaveEmail = async () => {
    const trimmed = emailInput.trim();
    const success = await onSetMicrosoftEmail(trimmed || null);
    if (success) {
      setShowSettings(false);
      if (trimmed) onRefresh();
    }
  };

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setTestResults(null);
    try {
      const { invokeSecureFunction } = await import('@/lib/secureInvoke');
      const { data } = await invokeSecureFunction('outlook-calendar', {
        action: 'testPermissions',
        testEmail: emailInput.trim() || microsoftEmail,
      });
      setTestResults(data?.diagnostics || { error: 'No diagnostics returned' });
    } catch (err: any) {
      setTestResults({ error: err.message });
    } finally {
      setTestingConnection(false);
    }
  }, [emailInput, microsoftEmail]);

  const resetForm = () => {
    setNewSubject('');
    setNewBody('');
    setNewLocation('');
    setNewTimezone(getBookingTimezone());
    setNewShowAs('busy');
    setNewReminder('15');
    setNewCategories([]);
    setNewAttendees([]);
    setAttendeeInput('');
    setShowAdvanced(false);
  };

  const handleCreateEvent = async () => {
    if (!newSubject || !newStartTime || !newEndTime) return;
    
    const [startDate, startTime] = newStartTime.split('T');
    const [endDate, endTime] = newEndTime.split('T');
    if (!startDate || !startTime || !endDate || !endTime) return;

    const payload: CreateOutlookEventPayload = {
      subject: newSubject,
      startTime: toTimezoneISO(startDate, startTime, newTimezone),
      endTime: toTimezoneISO(endDate, endTime, newTimezone),
      timezone: newTimezone,
    };

    if (newBody.trim()) payload.body = newBody;
    if (newLocation.trim()) payload.location = newLocation;
    if (newShowAs !== 'busy') payload.showAs = newShowAs;
    if (newReminder !== '0') payload.reminderMinutes = parseInt(newReminder);
    if (newCategories.length > 0) payload.categories = newCategories;
    if (newAttendees.length > 0) payload.attendees = newAttendees;

    const result = await onCreateEvent(payload);
    if (result) {
      resetForm();
      setShowQuickCreate(false);
    }
  };

  const handleAddAttendee = () => {
    const normalizedInput = attendeeInput.trim().toLowerCase();
    if (!normalizedInput) return;

    const matchedTeamUser = teamUsers.find((user) => {
      const email = user.email?.toLowerCase();
      return Boolean(email) && (
        user.username.toLowerCase() === normalizedInput ||
        email === normalizedInput
      );
    });

    const emailToAdd = matchedTeamUser?.email?.toLowerCase() ?? normalizedInput;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToAdd)) return;
    if (newAttendees.includes(emailToAdd)) return;

    setNewAttendees(prev => [...prev, emailToAdd]);
    setAttendeeInput('');
  };

  const handleAddTeamMember = (userEmail: string) => {
    if (!userEmail || newAttendees.includes(userEmail.toLowerCase())) return;
    setNewAttendees(prev => [...prev, userEmail.toLowerCase()]);
  };

  const handleToggleCategory = (cat: string) => {
    setNewCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const filteredTeamSuggestions = useMemo(() => {
    const query = attendeeInput.trim().toLowerCase();
    if (!query) return [];

    return teamUsers.filter((user) => {
      const email = user.email?.toLowerCase();
      if (!email || newAttendees.includes(email)) return false;

      return user.username.toLowerCase().includes(query) || email.includes(query);
    });
  }, [attendeeInput, newAttendees, teamUsers]);

  const dayEvents = useMemo(() => {
    if (!selectedDate) return outlookEvents;
    return outlookEvents.filter(e => {
      if (!e.startTime) return false;
      try {
        const d = parseISO(e.startTime);
        return format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
      } catch { return false; }
    });
  }, [outlookEvents, selectedDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Mail className="h-4 w-4" style={{ color: 'hsl(207 89% 41%)' }} />
          Outlook Calendar
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card className="p-3 space-y-3 bg-muted/30">
          <p className="text-xs text-muted-foreground">Your Microsoft 365 email:</p>
          <div className="flex gap-2">
            <Input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="user@yourcompany.com"
              className="h-8 text-xs"
              disabled={!!accountEmail && accountRole !== 'superadmin'}
              readOnly={!!accountEmail && accountRole !== 'superadmin'}
            />
            <Button size="sm" className="h-8" onClick={handleSaveEmail}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {accountEmail && accountRole !== 'superadmin'
              ? 'Locked to your account email for security. A superadmin can link a different address on your behalf.'
              : 'This links your Outlook calendar. Events will appear as an overlay on the calendar.'}
          </p>

          <Button 
            size="sm" 
            variant="outline" 
            className="w-full h-7 text-xs gap-1.5"
            onClick={handleTestConnection}
            disabled={testingConnection || (!emailInput.trim() && !microsoftEmail)}
          >
            {testingConnection ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
            {testingConnection ? 'Testing...' : 'Test Connection & Permissions'}
          </Button>
          {testResults && (
            <Card className="p-2.5 space-y-1.5 bg-background/50 text-[10px]">
              <p className="font-medium text-xs">Diagnostics</p>
              {testResults.error && (
                <p className="text-destructive">❌ Error: {testResults.error}</p>
              )}
              {testResults.tenantId && (
                <p className="text-muted-foreground">Tenant: {testResults.tenantId}</p>
              )}
              {testResults.testEmail && (
                <p className="text-muted-foreground">Testing: {testResults.testEmail}</p>
              )}
              {testResults.tokenAcquired !== undefined && (
                <p>{testResults.tokenAcquired ? '✅' : '❌'} Token acquired</p>
              )}
              {testResults.userLookup && (
                <p>{testResults.userLookup.success ? '✅' : '❌'} User lookup {testResults.userLookup.success ? `(${testResults.userLookup.displayName})` : `— ${testResults.userLookup.error}`}</p>
              )}
              {testResults.calendarAccess && (
                <p>{testResults.calendarAccess.success ? '✅' : '❌'} Calendar access {testResults.calendarAccess.success ? `(${testResults.calendarAccess.calendarName})` : `— ${testResults.calendarAccess.error}`}</p>
              )}
              {testResults.eventsList && (
                <p>{testResults.eventsList.success ? '✅' : '❌'} List events {testResults.eventsList.success ? `(${testResults.eventsList.count} found)` : `— ${testResults.eventsList.error}`}</p>
              )}
              {testResults.hint && (
                <p className="text-brand-500 font-medium mt-1">💡 {testResults.hint}</p>
              )}
            </Card>
          )}
        </Card>
      )}

      {/* Status & Toggle */}
      <Card className="p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn('w-3 h-3 rounded-full', microsoftEmail ? 'bg-[hsl(207,89%,41%)]' : 'bg-muted-foreground/30')}
            />
            <span className="text-xs">
              {microsoftEmail ? (
                <>
                  <span className="text-muted-foreground">Connected: </span>
                  <span className="font-medium">{microsoftEmail}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Not configured — set email above</span>
              )}
            </span>
          </div>
          {microsoftEmail && (
            <Switch
              checked={outlookVisible}
              onCheckedChange={onToggleOutlookVisible}
            />
          )}
        </div>
        {microsoftEmail && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-xs" style={{ borderColor: 'hsl(207,89%,41%)', color: 'hsl(207,89%,41%)' }}>
              {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}{selectedDate ? ' today' : ''}
            </Badge>
          </div>
        )}
      </Card>

      {/* Quick Create — Enhanced */}
      {microsoftEmail && (
        <div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => setShowQuickCreate(!showQuickCreate)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Internal Event
          </Button>

          {showQuickCreate && (
            <Card className="p-3 mt-2 space-y-3 bg-muted/30">
              {/* Title */}
              <Input
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="Event title (e.g. Prep: John Smith)"
                className="h-8 text-xs"
              />
              
              {/* Date/Time */}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="datetime-local"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  type="datetime-local"
                  value={newEndTime}
                  onChange={(e) => setNewEndTime(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              {/* Timezone */}
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Globe className="h-3 w-3" /> Timezone
                </Label>
                <Select value={newTimezone} onValueChange={setNewTimezone} disabled={isCreating}>
                  <SelectTrigger className="h-8 text-xs w-full">
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

              {/* Location */}
              <div className="flex items-center gap-2">
                <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                <Input
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="Location (optional)"
                  className="h-7 text-xs"
                />
              </div>

              {/* Attendees — Team Quick Add */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Users className="h-3 w-3" /> Attendees
                </Label>
                <div className="flex gap-1 flex-wrap items-center">
                  {teamUsers.map(u => {
                    const userEmail = u.email;
                    if (!userEmail) return null;
                    const isAdded = newAttendees.includes(userEmail.toLowerCase());
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => isAdded
                          ? setNewAttendees(prev => prev.filter(e => e !== userEmail.toLowerCase()))
                          : handleAddTeamMember(userEmail)
                        }
                        className={cn(
                          'text-[10px] px-2 py-1 rounded-full border transition-colors',
                          isAdded
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-muted/50 border-border hover:bg-muted'
                        )}
                      >
                        {u.username}
                        {isAdded && <Check className="h-2.5 w-2.5 ml-0.5 inline" />}
                      </button>
                    );
                  })}
                  {teamUsers.filter(u => u.email).length > 1 && (() => {
                    const allEmails = teamUsers.filter(u => u.email).map(u => u.email!.toLowerCase());
                    const allAdded = allEmails.every(e => newAttendees.includes(e));
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          if (allAdded) {
                            setNewAttendees(prev => prev.filter(e => !allEmails.includes(e)));
                          } else {
                            setNewAttendees(prev => [...new Set([...prev, ...allEmails])]);
                          }
                        }}
                        className={cn(
                          'text-[10px] px-2 py-1 rounded-full border transition-colors font-medium',
                          allAdded
                            ? 'border-primary/50 bg-primary/25 text-primary hover:bg-primary/30'
                            // Was `bg-accent/50 … text-primary` — the accent is
                            // a violet and the primary is too, so the control
                            // rendered as unreadable text on its own colour.
                            : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                        )}
                      >
                        {allAdded ? 'Remove All' : 'Invite All'}
                      </button>
                    );
                  })()}
                </div>
                {/* Manual email add */}
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    <Input
                      value={attendeeInput}
                      onChange={(e) => setAttendeeInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddAttendee())}
                      placeholder="Type team name or email..."
                      className="h-7 text-xs"
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={handleAddAttendee}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  {filteredTeamSuggestions.length > 0 && (
                    <div className="rounded-md border bg-popover p-1">
                      {filteredTeamSuggestions.slice(0, 6).map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            if (user.email) handleAddTeamMember(user.email);
                            setAttendeeInput('');
                          }}
                          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <span className="font-medium">{user.username}</span>
                          <span className="text-muted-foreground">{user.email}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {newAttendees.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {newAttendees.map(email => (
                        <Badge key={email} variant="secondary" className="text-[10px] gap-1">
                          {email}
                          <button onClick={() => setNewAttendees(prev => prev.filter(e => e !== email))}>
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAdvanced ? 'Less options' : 'More options'}
              </button>

              {showAdvanced && (
                <div className="space-y-3 border-t pt-3">
                  {/* Notes */}
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Notes
                    </Label>
                    <Textarea
                      value={newBody}
                      onChange={(e) => setNewBody(e.target.value)}
                      placeholder="Meeting notes, agenda..."
                      className="text-xs min-h-[60px]"
                    />
                  </div>

                  {/* Show As & Reminder */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1">
                        <Shield className="h-3 w-3" /> Show As
                      </Label>
                      <Select value={newShowAs} onValueChange={setNewShowAs}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SHOW_AS_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1">
                        <Bell className="h-3 w-3" /> Reminder
                      </Label>
                      <Select value={newReminder} onValueChange={setNewReminder}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REMINDER_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Categories */}
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      <Tag className="h-3 w-3" /> Categories
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {CATEGORY_PRESETS.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => handleToggleCategory(cat)}
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                            newCategories.includes(cat)
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'bg-muted/50 border-border hover:bg-muted'
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Create Button */}
              <Button
                size="sm"
                className="w-full h-8 text-xs"
                onClick={handleCreateEvent}
                disabled={isCreating || !newSubject}
              >
                {isCreating ? 'Creating...' : 'Create on Outlook'}
              </Button>
            </Card>
          )}
        </div>
      )}

      {/* Team Availability */}
      {microsoftEmail && (
        <div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => { setShowTeam(!showTeam); if (!showTeam) onFetchTeam(); }}
          >
            <Users className="h-3 w-3 mr-1" />
            Team Availability
          </Button>

          {showTeam && teamAvailability.length > 0 && (
            <Card className="p-3 mt-2 bg-muted/30">
              <div className="space-y-2">
                  {teamAvailability.map(member => (
                    <div key={member.userId} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium truncate max-w-[120px]">{member.username}</span>
                        <div className="flex items-center gap-1">
                          {member.busySlots.length === 0 ? (
                            <Badge variant="outline" className="text-[10px] text-success border-success/30">Free</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-brand-500 border-brand-500/30">
                              {member.busySlots.length} busy
                            </Badge>
                          )}
                          {member.error && (
                            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Error</Badge>
                          )}
                        </div>
                      </div>
                      {/* Show busy slots inline */}
                      {member.busySlots.length > 0 && (
                        <div className="pl-2 space-y-0.5">
                          {member.busySlots.slice(0, 3).map((slot, i) => (
                            <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-brand-500/60 shrink-0" />
                              <span>
                                {slot.start ? format(parseISO(slot.start), 'h:mm a') : '?'} – {slot.end ? format(parseISO(slot.end), 'h:mm a') : '?'}
                              </span>
                              <span className="truncate opacity-70">{slot.title}</span>
                            </div>
                          ))}
                          {member.busySlots.length > 3 && (
                            <p className="text-[9px] text-muted-foreground">+{member.busySlots.length - 3} more</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Automation Settings */}
      {microsoftEmail && (
        <>
          <Separator />
          <OutlookCalendarSettingsComponent microsoftEmail={microsoftEmail} />
        </>
      )}

      <Separator />

      {/* Event List */}
      {outlookVisible && microsoftEmail && (
        <div className="space-y-1.5">
            {dayEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {isLoading ? 'Loading Outlook events...' : 'No Outlook events'}
              </p>
            ) : (
              dayEvents.map(event => (
                <div
                  key={event.id}
                  className="p-2 rounded-md border bg-[hsl(207,89%,41%)]/5 border-[hsl(207,89%,41%)]/20 hover:bg-[hsl(207,89%,41%)]/10 transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{event.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">
                          {event.startTime ? format(parseISO(event.startTime), 'h:mm a') : '—'}
                          {' – '}
                          {event.endTime ? format(parseISO(event.endTime), 'h:mm a') : '—'}
                        </span>
                      </div>
                      {event.location && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                          <p className="text-[10px] text-muted-foreground truncate">{event.location}</p>
                        </div>
                      )}
                      {event.attendees.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Users className="h-2.5 w-2.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">
                            {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      {event.categories.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {event.categories.map(cat => (
                            <Badge key={cat} variant="outline" className="text-[9px] px-1 py-0">
                              {cat}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => onDeleteEvent(event.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            )}
        </div>
      )}
    </div>
  );
}
