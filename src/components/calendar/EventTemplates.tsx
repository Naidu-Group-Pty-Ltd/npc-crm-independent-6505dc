import { useState } from 'react';
import { format, addMinutes } from 'date-fns';
import { toTimezoneISO } from '@/lib/sydneyTime';
import { getBookingTimezone } from '@/lib/bookingTimezone';
import { 
  Calendar, 
  Clock, 
  Phone, 
  Video, 
  Users, 
  Coffee, 
  FileText, 
  Loader2,
  Zap,
  Plus,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { GHLCalendar } from '@/hooks/useGHLCalendar';
import { cn } from '@/lib/utils';

export interface EventTemplate {
  id: string;
  name: string;
  icon: React.ReactNode;
  duration: number; // in minutes
  color: string;
  defaultTitle: string;
  defaultNotes?: string;
  category: 'meeting' | 'call' | 'event' | 'other';
}

// Pre-defined templates
export const DEFAULT_TEMPLATES: EventTemplate[] = [
  {
    id: 'quick-call',
    name: 'Quick Call',
    icon: <Phone className="h-4 w-4" />,
    duration: 15,
    color: '#22c55e',
    defaultTitle: 'Quick Call',
    category: 'call',
  },
  {
    id: 'discovery-call',
    name: 'Discovery Call',
    icon: <Phone className="h-4 w-4" />,
    duration: 30,
    color: '#3b82f6',
    defaultTitle: 'Discovery Call',
    defaultNotes: 'Initial consultation to understand needs',
    category: 'call',
  },
  {
    id: 'video-meeting',
    name: 'Video Meeting',
    icon: <Video className="h-4 w-4" />,
    duration: 45,
    color: '#8b5cf6',
    defaultTitle: 'Video Meeting',
    category: 'meeting',
  },
  {
    id: 'strategy-session',
    name: 'Strategy Session',
    icon: <Users className="h-4 w-4" />,
    duration: 60,
    color: '#f59e0b',
    defaultTitle: 'Strategy Session',
    defaultNotes: 'Deep dive into strategy and planning',
    category: 'meeting',
  },
  {
    id: 'coffee-chat',
    name: 'Coffee Chat',
    icon: <Coffee className="h-4 w-4" />,
    duration: 30,
    color: '#ec4899',
    defaultTitle: 'Coffee Chat',
    category: 'other',
  },
  {
    id: 'follow-up',
    name: 'Follow-up',
    icon: <FileText className="h-4 w-4" />,
    duration: 20,
    color: '#14b8a6',
    defaultTitle: 'Follow-up Call',
    defaultNotes: 'Follow-up on previous discussion',
    category: 'call',
  },
];

interface EventTemplatesProps {
  calendars: GHLCalendar[];
  selectedDate?: Date;
  selectedHour?: number;
  onCreateAppointment: (data: {
    calendarId: string;
    title: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }) => Promise<{ success: boolean }>;
  isUpdating?: boolean;
  className?: string;
}

export function EventTemplates({
  calendars,
  selectedDate,
  selectedHour,
  onCreateAppointment,
  isUpdating = false,
  className,
}: EventTemplatesProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<EventTemplate | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(calendars[0]?.id || '');
  const [customTitle, setCustomTitle] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [recentlyCreated, setRecentlyCreated] = useState<string | null>(null);
  const { toast } = useToast();

  const handleTemplateClick = (template: EventTemplate) => {
    setSelectedTemplate(template);
    setCustomTitle(template.defaultTitle);
    setCustomNotes(template.defaultNotes || '');
    
    // Set default time
    const targetDate = selectedDate || new Date();
    const hour = selectedHour ?? new Date().getHours() + 1;
    setCustomTime(`${String(hour).padStart(2, '0')}:00`);
    
    // Set default calendar
    if (calendars.length > 0 && !selectedCalendarId) {
      setSelectedCalendarId(calendars[0].id);
    }
    
    setConfirmModalOpen(true);
  };

  const handleQuickCreate = async () => {
    if (!selectedTemplate || !selectedCalendarId) return;

    setIsCreating(true);

    try {
      const targetDate = selectedDate || new Date();
      const [hours, minutes] = customTime.split(':').map(Number);
      
      // Calculate end time
      const durationMinutes = selectedTemplate.duration;
      const endTotalMinutes = hours * 60 + minutes + durationMinutes;
      const endHours = Math.floor(endTotalMinutes / 60) % 24;
      const endMins = endTotalMinutes % 60;

      const dateStr = format(targetDate, 'yyyy-MM-dd');
      const startTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      const endTimeStr = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

      // Treat selected time in the configured booking timezone
      const bookingTz = getBookingTimezone();
      const result = await onCreateAppointment({
        calendarId: selectedCalendarId,
        title: customTitle || selectedTemplate.defaultTitle,
        startTime: toTimezoneISO(dateStr, startTimeStr, bookingTz),
        endTime: toTimezoneISO(dateStr, endTimeStr, bookingTz),
        notes: customNotes || undefined,
      });

      if (result.success) {
        setRecentlyCreated(selectedTemplate.id);
        setTimeout(() => setRecentlyCreated(null), 3000);
        setConfirmModalOpen(false);
        toast({
          title: 'Appointment created',
          description: `"${customTitle || selectedTemplate.defaultTitle}" scheduled for ${startTimeStr}`,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Failed to create appointment',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const groupedTemplates = {
    call: DEFAULT_TEMPLATES.filter((t) => t.category === 'call'),
    meeting: DEFAULT_TEMPLATES.filter((t) => t.category === 'meeting'),
    other: DEFAULT_TEMPLATES.filter((t) => t.category === 'other' || t.category === 'event'),
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Quick Templates
        </h4>
        <Badge variant="outline" className="text-xs">
          {DEFAULT_TEMPLATES.length} templates
        </Badge>
      </div>

      {/* Templates Grid */}
      <div className="space-y-4">
          {/* Calls */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Phone className="h-3 w-3" /> Calls
            </p>
            <div className="grid grid-cols-2 gap-2">
              {groupedTemplates.call.map((template) => (
                <TemplateButton
                  key={template.id}
                  template={template}
                  onClick={() => handleTemplateClick(template)}
                  isLoading={isUpdating}
                  isRecentlyCreated={recentlyCreated === template.id}
                />
              ))}
            </div>
          </div>

          {/* Meetings */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Users className="h-3 w-3" /> Meetings
            </p>
            <div className="grid grid-cols-2 gap-2">
              {groupedTemplates.meeting.map((template) => (
                <TemplateButton
                  key={template.id}
                  template={template}
                  onClick={() => handleTemplateClick(template)}
                  isLoading={isUpdating}
                  isRecentlyCreated={recentlyCreated === template.id}
                />
              ))}
            </div>
          </div>

          {/* Other */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Other
            </p>
            <div className="grid grid-cols-2 gap-2">
              {groupedTemplates.other.map((template) => (
                <TemplateButton
                  key={template.id}
                  template={template}
                  onClick={() => handleTemplateClick(template)}
                  isLoading={isUpdating}
                  isRecentlyCreated={recentlyCreated === template.id}
                />
              ))}
            </div>
          </div>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="sm:max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTemplate?.icon}
              Create {selectedTemplate?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Calendar Selection */}
            <div className="space-y-2">
              <Label>Calendar</Label>
              <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select calendar" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((cal) => (
                    <SelectItem key={cal.id} value={cal.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cal.eventColor || '#3b82f6' }}
                        />
                        {cal.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Appointment title"
              />
            </div>

            {/* Time */}
            <div className="space-y-2">
              <Label>Time</Label>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="flex-1"
                />
                <Badge variant="secondary">{selectedTemplate?.duration}min</Badge>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="Add notes..."
                rows={2}
              />
            </div>

            {/* Date Display */}
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-sm text-muted-foreground">
                Scheduling for:{' '}
                <span className="font-medium text-foreground">
                  {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : format(new Date(), 'EEEE, MMMM d, yyyy')}
                </span>
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleQuickCreate} disabled={isCreating || !selectedCalendarId}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create in GHL
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateButton({
  template,
  onClick,
  isLoading,
  isRecentlyCreated,
}: {
  template: EventTemplate;
  onClick: () => void;
  isLoading?: boolean;
  isRecentlyCreated?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        'group relative flex flex-col items-start gap-1 p-3 rounded-lg border transition-all duration-200',
        'hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm',
        'active:scale-[0.98]',
        isLoading && 'opacity-50 cursor-not-allowed',
        isRecentlyCreated && 'border-success/30 bg-success/10'
      )}
      style={{ borderLeftWidth: '3px', borderLeftColor: template.color }}
    >
      {/* Success indicator */}
      {isRecentlyCreated && (
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-success flex items-center justify-center animate-in zoom-in">
          <CheckCircle2 className="h-3 w-3 text-foreground" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div style={{ color: template.color }}>{template.icon}</div>
        <span className="font-medium text-sm">{template.name}</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {template.duration}min
      </div>
    </button>
  );
}
