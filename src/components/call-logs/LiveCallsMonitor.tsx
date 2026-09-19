import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useToast } from '@/hooks/use-toast';
import { callLogBadgeTone } from './badgeStyles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Phone, 
  PhoneIncoming, 
  PhoneOutgoing, 
  Radio, 
  Clock, 
  User,
  Users,
  Loader2,
  Activity,
  Zap,
  PhoneOff,
  ShieldAlert
} from 'lucide-react';
import { format, differenceInSeconds } from 'date-fns';
import { cn } from '@/lib/utils';
import { CallStatePanel } from './CallStatePanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface LiveCall {
  id: string;
  vapi_call_id: string;
  agent_name: string | null;
  phone_number: string | null;
  customer_name: string | null;
  call_direction: string | null;
  call_status: string | null;
  started_at: string | null;
  is_squad_call: boolean | null;
  squad_name: string | null;
  call_intent: string | null;
}

const livePanel =
  'relative h-full overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-2xl shadow-sm dark:shadow-black/30';
const liveControl =
  'rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/35 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all hover:border-success/35 hover:bg-success/10 hover:text-success focus-visible:ring-2 focus-visible:ring-success/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const liveCallCard =
  'group relative cursor-default overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-r from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 p-4 shadow-sm shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full before:bg-gradient-to-b before:from-transparent before:via-success/0 before:to-transparent hover:-translate-y-0.5 hover:border-success/40 hover:bg-success/5 hover:shadow-xl hover:shadow-success/10 hover:before:via-success/90';

const getLiveStatusTone = (status: string | null) => {
  if (status === 'in-progress') return 'border-l-emerald-400/70';
  if (status === 'ringing') return 'border-l-amber-300/70 hover:border-brand-300/45 hover:shadow-brand-500/10 hover:before:via-brand-300/90';
  if (status === 'queued') return 'border-l-sky-300/70 hover:border-info/45 hover:shadow-info/10 hover:before:via-info/90';
  return 'border-l-zinc-500/60';
};

export const LiveCallsMonitor = () => {
  const { toast } = useToast();
  const { canEdit: canControlCalls } = useModulePermissions('call_logs');
  const { fetchLiveCalls: fetchLiveCallsSecure, killLiveCall } = useSecureCallLogs();
  const [liveCalls, setLiveCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [killingCallId, setKillingCallId] = useState<string | null>(null);

  useEffect(() => {
    fetchLiveCalls();

    // Set up realtime subscription for live calls
    const channel = supabase
      .channel('live-calls-monitor')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'vapi_call_logs',
          filter: 'call_status=in.in-progress,ringing,queued'
        },
        (payload) => {
          console.log('Live call update:', payload);
          fetchLiveCalls();
        }
      )
      .subscribe();

    // Update timer every second
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    // Refresh live calls every 10 seconds
    const refreshInterval = setInterval(fetchLiveCalls, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
      clearInterval(refreshInterval);
    };
  }, []);

  const fetchLiveCalls = async () => {
    try {
      const { data, error } = await fetchLiveCallsSecure();

      if (error) throw error;

      // Client-side safety net: hide any "active" row whose started_at is
      // older than 30 minutes. Real calls never last that long — these are
      // stale rows where VAPI failed to send an end-of-call webhook.
      const HARD_STOP_MINUTES = Math.max(1, Number(import.meta.env.VITE_LIVE_CALL_HARD_STOP_MINUTES) || 30);
      const STALE_CUTOFF_MS = HARD_STOP_MINUTES * 60 * 1000; // env-configurable hard stop

      const now = Date.now();
      const fresh = (data || []).filter((c: LiveCall) => {
        if (!c.started_at) return true;
        const started = new Date(c.started_at).getTime();
        if (Number.isNaN(started)) return false;
        return now - started < STALE_CUTOFF_MS;
      });

      setLiveCalls(fresh);
    } catch (error) {
      console.error('Error fetching live calls:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCallDuration = (startedAt: string | null) => {
    if (!startedAt) return '00:00';
    const seconds = differenceInSeconds(new Date(), new Date(startedAt));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };


  const handleKillCall = async (call: LiveCall) => {
    setKillingCallId(call.id);
    const { data, error } = await killLiveCall(call.id);
    setKillingCallId(null);

    if (error) {
      toast({
        title: 'Unable to kill live call',
        description: error.message || 'The provider rejected the call termination request.',
        variant: 'destructive',
      });
      return;
    }

    const callLabel = call.customer_name || call.phone_number || 'The active call';
    if (data?.result === 'already-ended') {
      toast({
        title: 'Call already ended',
        description: `${callLabel} had already finished on Vapi. The log has been synced.`,
      });
    } else if (data?.verified) {
      toast({
        title: 'Live call terminated',
        description: `${callLabel} has been ended — confirmed by Vapi.`,
      });
    } else {
      toast({
        title: 'Termination sent',
        description: `Vapi accepted the kill request for ${callLabel}. End confirmation is pending.`,
      });
    }
    fetchLiveCalls();
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'in-progress':
        return (
          <Badge className={callLogBadgeTone('success', 'animate-pulse')}>
            <Activity className="w-3 h-3 mr-1" />
            In Progress
          </Badge>
        );
      case 'ringing':
        return (
          <Badge className={callLogBadgeTone('warning', 'animate-pulse')}>
            <Phone className="w-3 h-3 mr-1 animate-bounce" />
            Ringing
          </Badge>
        );
      case 'queued':
        return (
          <Badge className={callLogBadgeTone('info')}>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Queued
          </Badge>
        );
      default:
        return <Badge variant="outline" className={callLogBadgeTone('neutral')}>{status}</Badge>;
    }
  };

  return (
    <Card className={livePanel}>
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-success/55 to-transparent" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-success/10 blur-3xl" />
      <CardHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.92),rgba(0,0,0,0.72),rgba(8,47,73,0.16))] pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success/30 shadow-[0_0_10px_rgba(110,231,183,0.8)] animate-pulse" />
              Realtime Voice Ops
            </div>
            <CardTitle className="flex items-center gap-3 text-xl text-foreground dark:text-foreground md:text-2xl">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-success/25 bg-success/10 text-success shadow-inner shadow-success/30">
                <Radio className="w-4 h-4 text-success relative z-10" />
              {/* Outer pulse ring */}
                <span className="absolute w-7 h-7 bg-success/20 rounded-full animate-ping" />
              {/* Middle pulse ring */}
                <span className="absolute w-6 h-6 bg-success/30 rounded-full animate-pulse" />
              {/* Inner glow */}
                <span className="absolute w-5 h-5 bg-success/30 rounded-full" />
              {/* Dot indicator */}
                <span className="absolute right-1.5 top-1.5 w-2 h-2 bg-success/30 rounded-full animate-pulse shadow-[0_0_8px_2px_rgba(16,185,129,0.6)]" />
              </div>
              Live Calls
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">Monitor active, ringing, and queued voice-agent sessions in real time.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={callLogBadgeTone('neutral', 'font-mono')}>
              {liveCalls.length} active
            </Badge>
            <Button variant="ghost" size="icon" onClick={fetchLiveCalls} className={cn("h-9 w-9", liveControl)}>
              <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative p-4">
        {loading ? (
          <CallStatePanel
            tone="emerald"
            icon={<Loader2 className="h-8 w-8 animate-spin" />}
            title="Syncing live monitor..."
            description="Checking active, ringing, and queued voice-agent sessions."
          />
        ) : liveCalls.length === 0 ? (
          <CallStatePanel
            tone="neutral"
            icon={<Phone className="h-8 w-8" />}
            title="No active calls"
            description="Live calls will appear here in real time when an agent is in progress, ringing, or queued."
          />
        ) : (
          <ScrollArea className="h-[430px] pr-3 [scrollbar-color:rgba(16,185,129,0.45)_rgba(0,0,0,0.35)] [scrollbar-width:thin]">
            <div className="space-y-3">
              {liveCalls.map((call) => (
                <div key={call.id} className={cn(liveCallCard, 'border-l-4', getLiveStatusTone(call.call_status))}>
                  <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={cn(
                        'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-inner',
                        call.call_direction === 'inbound'
                          ? 'border-success/25 bg-success/10 text-success'
                          : 'border-info/25 bg-info/10 text-info'
                      )}>
                        <span className={cn(
                          'absolute right-2 top-2 h-2 w-2 rounded-full shadow-[0_0_10px_currentColor]',
                          call.call_status === 'in-progress' ? 'bg-success/30 animate-pulse' : call.call_status === 'ringing' ? 'bg-brand-300 animate-pulse' : 'bg-info/30'
                        )} />
                        {call.call_direction === 'inbound' ? (
                          <PhoneIncoming className="h-5 w-5" />
                        ) : (
                          <PhoneOutgoing className="h-5 w-5" />
                        )}
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-semibold text-foreground dark:text-foreground">
                            {call.customer_name || call.phone_number || 'Unknown Caller'}
                          </span>
                          <Badge className={call.call_direction === 'inbound' ? callLogBadgeTone('success') : callLogBadgeTone('info')}>
                            {call.call_direction || 'unknown'}
                          </Badge>
                        {call.is_squad_call && (
                          <Badge className={callLogBadgeTone('squad')}>
                            <Users className="w-3 h-3 mr-1" />
                            Squad
                          </Badge>
                        )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
                          <div className="flex items-center gap-1 rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/25 px-2.5 py-1">
                            <User className="w-3 h-3 text-muted-foreground dark:text-muted-foreground" />
                            {call.agent_name || 'Unknown Agent'}
                          </div>
                          {call.squad_name && (
                            <div className="flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-accent">
                              <Zap className="w-3 h-3" />
                              {call.squad_name}
                            </div>
                          )}
                        </div>

                        {call.call_intent && (
                          <Badge variant="secondary" className={callLogBadgeTone('info', 'capitalize')}>
                            {call.call_intent.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                          </Badge>
                        )}
                      </div>
                    </div>

                      <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 md:flex-col md:items-end">
                        {getStatusBadge(call.call_status)}
                        <div className="flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-3 py-1.5 font-mono text-sm text-success shadow-sm shadow-success/10">
                          <Clock className="w-3 h-3 text-success" />
                          <span className="font-semibold">
                            {getCallDuration(call.started_at)}
                          </span>
                        </div>
                        {call.started_at && (
                          <span className="rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/25 px-2.5 py-1 text-xs text-muted-foreground dark:text-muted-foreground">
                            Started {format(new Date(call.started_at), 'h:mm a')}
                          </span>
                        )}
                        {canControlCalls && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={killingCallId === call.id}
                                className="rounded-full border border-destructive/40 bg-destructive/15 text-destructive shadow-sm shadow-destructive/10 hover:bg-destructive hover:text-destructive-foreground"
                              >
                                {killingCallId === call.id ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <PhoneOff className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Kill call
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle className="flex items-center gap-2">
                                  <ShieldAlert className="h-5 w-5 text-destructive" />
                                  Kill this live call?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This immediately sends a termination request to Vapi for {call.customer_name || call.phone_number || 'this caller'} and closes the live monitor row. Use only when a live agent session must be stopped.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleKillCall(call)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Kill live call
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
