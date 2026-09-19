import { useQuery } from '@tanstack/react-query';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  CalendarDays, Clock, Loader2, RefreshCw, CalendarCheck,
  ArrowRight, Inbox
} from 'lucide-react';
import { format, parseISO, isPast, isFuture, isToday, formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent, portalPanelClassName } from '@/components/portal/PortalSurface';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


function getSessionToken(): string | null {
  // In-memory only: `client-portal-verify` repopulates it from the HttpOnly
  // cookie on load. It used to come from localStorage. See src/lib/portalSession.ts.
  return getPortalSessionToken();
}

async function fetchAppointments() {
  const sessionToken = getSessionToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/portal-book-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      ...(sessionToken ? { 'x-portal-session-token': sessionToken } : {}),
    },
    credentials: 'omit',
    body: JSON.stringify({ action: 'getAppointments', portal_session_token: sessionToken, session_token: sessionToken }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
  return data.appointments || [];
}

interface Appointment {
  id: string;
  title?: string;
  startTime?: string;
  start_time?: string;
  endTime?: string;
  end_time?: string;
  status?: string;
  appointmentStatus?: string;
  calendarId?: string;
  notes?: string;
}

function getStart(apt: Appointment): string {
  return apt.startTime || apt.start_time || '';
}

function getEnd(apt: Appointment): string {
  return apt.endTime || apt.end_time || '';
}

function StatusBadge({ status, startTime }: { status: string; startTime: string }) {
  const start = parseISO(startTime);
  if (status === 'cancelled') return <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>;
  if (status === 'noshow' || status === 'no_show') return <Badge variant="destructive" className="text-[10px]">No Show</Badge>;
  if (isPast(start) && status !== 'cancelled') return <Badge variant="secondary" className="text-[10px]">Completed</Badge>;
  if (isToday(start)) return <Badge className="border-primary/20 bg-primary/10 text-[10px] text-primary">Today</Badge>;
  if (isFuture(start)) return <Badge className="border-primary/20 bg-primary/10 text-[10px] text-primary">Upcoming</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export default function PortalAppointments() {
  const { user } = usePortalAuth();

  const { data: appointments = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['portal-appointments', user?.client_id],
    queryFn: fetchAppointments,
    staleTime: 60000,
    enabled: !!user,
  });

  // Split into upcoming and past
  const now = new Date();
  const upcoming = appointments
    .filter((a: Appointment) => {
      const s = getStart(a);
      const status = a.status || a.appointmentStatus || '';
      return s && isFuture(parseISO(s)) && status !== 'cancelled';
    })
    .sort((a: Appointment, b: Appointment) => new Date(getStart(a)).getTime() - new Date(getStart(b)).getTime());

  const past = appointments
    .filter((a: Appointment) => {
      const s = getStart(a);
      const status = a.status || a.appointmentStatus || '';
      return s && (isPast(parseISO(s)) || status === 'cancelled');
    })
    .sort((a: Appointment, b: Appointment) => new Date(getStart(b)).getTime() - new Date(getStart(a)).getTime());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="client-portal-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">View your scheduled and past appointments</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="rounded-xl shadow-sm shadow-primary/5">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/client/booking">
            <Button size="sm" className="rounded-xl shadow-lg shadow-primary/10">
              <CalendarCheck className="h-3.5 w-3.5 mr-1.5" />
              Book New
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <PortalPanel>
          <PortalPanelContent className="py-10 text-center">
            <p className="text-sm text-destructive mb-3">{(error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </PortalPanelContent>
        </PortalPanel>
      ) : appointments.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<Inbox className="h-8 w-8" />}
          title="No appointments yet"
          description="Book your first appointment to get started with your advisory team."
          actionLabel="Book Appointment"
          onAction={() => { window.location.href = '/client/booking'; }}
        />
      ) : (
        <>
          {/* Upcoming */}
          {upcoming.length > 0 && (
            <div className="space-y-3">
              <h2 className="client-portal-section-title text-sm">
                <CalendarCheck className="h-4 w-4 text-primary" />
                Upcoming ({upcoming.length})
              </h2>
              <div className="space-y-2">
                {upcoming.map((apt: Appointment) => (
                  <AppointmentCard key={apt.id} appointment={apt} />
                ))}
              </div>
            </div>
          )}

          {upcoming.length > 0 && past.length > 0 && <Separator />}

          {/* Past */}
          {past.length > 0 && (
            <div className="space-y-3">
              <h2 className="client-portal-section-title text-sm text-muted-foreground">Past Appointments ({past.length})</h2>
              <div className="space-y-2">
                {past.map((apt: Appointment) => (
                  <AppointmentCard key={apt.id} appointment={apt} muted />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AppointmentCard({ appointment: apt, muted }: { appointment: Appointment; muted?: boolean }) {
  const startStr = getStart(apt);
  const endStr = getEnd(apt);
  if (!startStr) return null;

  const startDate = parseISO(startStr);
  const endDate = endStr ? parseISO(endStr) : null;
  const status = apt.status || apt.appointmentStatus || 'confirmed';

  return (
    <PortalPanel className={muted ? 'opacity-60' : undefined}>
      <PortalPanelContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 rounded-xl p-2.5 ${muted ? 'bg-muted' : 'bg-primary/10 shadow-sm shadow-primary/10'}`}>
            <CalendarDays className={`h-4 w-4 ${muted ? 'text-muted-foreground' : 'text-primary'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <p className="text-sm font-medium text-foreground truncate">{apt.title || 'Appointment'}</p>
              <StatusBadge status={status} startTime={startStr} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {format(startDate, 'EEE, dd MMM yyyy')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(startDate, 'h:mm a')}
                {endDate && ` – ${format(endDate, 'h:mm a')}`}
              </span>
            </div>
            {apt.notes && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{apt.notes}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(startDate, { addSuffix: true })}
            </p>
          </div>
        </div>
      </PortalPanelContent>
    </PortalPanel>
  );
}
