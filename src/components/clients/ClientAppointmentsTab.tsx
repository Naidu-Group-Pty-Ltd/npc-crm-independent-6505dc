import { useState, useEffect } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CalendarDays, Clock, Loader2, MapPin, Video, Phone,
  User, RefreshCw, Inbox, ExternalLink
} from 'lucide-react';
import { format, parseISO, isPast, isFuture, isToday, formatDistanceToNow } from 'date-fns';

interface ClientAppointmentsTabProps {
  clientId: string;
  ghlContactId?: string | null;
}

interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  appointmentStatus?: string;
  calendarId?: string;
  calendarName?: string;
  notes?: string;
  address?: string;
}

function getStatusBadge(status: string, startTime: string) {
  const start = parseISO(startTime);
  if (status === 'cancelled') return <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>;
  if (status === 'noshow' || status === 'no_show') return <Badge variant="destructive" className="text-[10px]">No Show</Badge>;
  if (isPast(start) && status !== 'cancelled') return <Badge variant="secondary" className="text-[10px]">Completed</Badge>;
  if (isToday(start)) return <Badge className="bg-brand-500/10 text-brand-600 text-[10px]">Today</Badge>;
  if (isFuture(start)) return <Badge className="bg-success/10 text-success text-[10px]">Upcoming</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export function ClientAppointmentsTab({ clientId, ghlContactId }: ClientAppointmentsTabProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAppointments = async () => {
    if (!ghlContactId) return;
    
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await invokeSecureFunction('ghl-calendar-proxy', {
        action: 'getContactAppointments',
        contactId: ghlContactId,
      });

      if (fnError) throw fnError;
      
      const events = data?.events || data?.appointments || [];
      // Sort: upcoming first, then past
      events.sort((a: any, b: any) => {
        const aTime = new Date(a.startTime || a.start_time).getTime();
        const bTime = new Date(b.startTime || b.start_time).getTime();
        return bTime - aTime;
      });
      setAppointments(events);
    } catch (err: any) {
      console.error('Failed to fetch appointments:', err);
      setError(err.message || 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [ghlContactId]);

  if (!ghlContactId) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <User className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No GHL contact linked to this client.</p>
          <p className="text-xs text-muted-foreground mt-1">Link a GoHighLevel contact to see appointments.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchAppointments}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Appointments</h3>
          <p className="text-xs text-muted-foreground">All scheduled appointments for this client</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAppointments} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {appointments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No appointments found for this client.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt) => {
            const startDate = parseISO(apt.startTime);
            const endDate = parseISO(apt.endTime);
            return (
              <Card key={apt.id}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <CalendarDays className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{apt.title || 'Appointment'}</p>
                        {getStatusBadge(apt.status || apt.appointmentStatus || 'confirmed', apt.startTime)}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {format(startDate, 'EEE, dd MMM yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(startDate, 'h:mm a')} – {format(endDate, 'h:mm a')}
                        </span>
                      </div>
                      {apt.calendarName && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1">Calendar: {apt.calendarName}</p>
                      )}
                      {apt.notes && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{apt.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(startDate, { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {appointments.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}
