import { useState, useEffect, useRef, useCallback } from 'react';
import { LiveModelBadge, ModelUpgradeButton } from '@/components/agentModels';

import { useModulePermissions } from '@/hooks/useModulePermissions';
import { supabase } from '@/integrations/supabase/client';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { format, startOfDay, endOfDay, subDays, isWithinInterval } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';

import { CallAnalyticsDashboard } from '@/components/call-logs/CallAnalyticsDashboard';
import { SquadAnalyticsDashboard } from '@/components/call-logs/SquadAnalyticsDashboard';
import { CallRecordingPlayer, CallRecordingPlayerHandle } from '@/components/call-logs/CallRecordingPlayer';
import { CallLogsExport } from '@/components/call-logs/CallLogsExport';
import { LiveCallsMonitor } from '@/components/call-logs/LiveCallsMonitor';
import { CallAnalyticsTrends } from '@/components/call-logs/CallAnalyticsTrends';
import { CallTagging, CallTagFilter } from '@/components/call-logs/CallTagging';
import { CallAlerts } from '@/components/call-logs/CallAlerts';
import { CallQualityScore, CallQualityBadge } from '@/components/call-logs/CallQualityScore';
import { WeeklyReportConfig } from '@/components/call-logs/WeeklyReportConfig';
import { CleanupContactNames } from '@/components/call-logs/CleanupContactNames';
import { CleanupTestCalls } from '@/components/call-logs/CleanupTestCalls';
import { NegativeCallAnalysis } from '@/components/call-logs/NegativeCallAnalysis';
import { BlacklistedNumbers } from '@/components/call-logs/BlacklistedNumbers';
import { CallToolCalls } from '@/components/call-logs/CallToolCalls';
import { CallTranscriptChat } from '@/components/call-logs/CallTranscriptChat';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  DollarSign,
  Search,
  Filter,
  TrendingUp,
  Users,
  CheckCircle,
  XCircle,
  Voicemail,
  RefreshCw,
  Play,
  FileText,
  MessageSquare,
  Target,
  BarChart3,
  PieChart,
  GitBranch,
  Zap,
  ArrowRight,
  Radio,
  LineChart,
  Tag,
  SlidersHorizontal,
  AlertTriangle,
  CalendarIcon,
  Ban
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { isClientFacingDeployment } from '@/lib/clientFacing';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { callLogBadgeTone } from '@/components/call-logs/badgeStyles';


const premiumPageShell = "relative -mx-4 -mt-4 min-h-screen max-w-none overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),radial-gradient(circle_at_80%_8%,hsl(var(--accent)/0.10),transparent_28%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--card))_46%,hsl(var(--background)))] px-4 py-5 text-foreground md:-mx-6 md:-mt-6 md:px-6 md:py-7";
const premiumPanel = "border-border dark:border-white/10 bg-gradient-to-br from-card/80 dark:from-background/80 via-background/60 dark:via-black/60 to-card/85 dark:to-background/85 shadow-2xl shadow-sm dark:shadow-black/30 backdrop-blur-xl";
const premiumCard = "border-border dark:border-white/10 bg-gradient-to-br from-card/95 dark:from-background/95 via-card/80 dark:via-background/80 to-background/90 dark:to-black/90 shadow-lg shadow-sm dark:shadow-black/25 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-400/35 hover:shadow-brand-500/10";
const premiumModalCard = "border-border dark:border-white/10 bg-gradient-to-br from-card/95 dark:from-background/95 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95 shadow-lg shadow-sm dark:shadow-black/25";
const premiumMutedSurface = "rounded-2xl border border-border dark:border-white/10 bg-background/35 dark:bg-black/35 shadow-inner shadow-sm dark:shadow-black/20";
const premiumSelectContent = "border-border dark:border-white/10 bg-background/95 dark:bg-background/95 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/40 backdrop-blur-xl";
const premiumScrollbar = "[scrollbar-width:thin] [scrollbar-color:rgba(251,191,36,0.45)_rgba(0,0,0,0.25)]";
const premiumMetricCard = "group relative overflow-hidden border-border dark:border-white/10 bg-gradient-to-br from-card/95 dark:from-background/95 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95 shadow-lg shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/45 before:to-transparent hover:-translate-y-1 hover:border-brand-300/40 hover:shadow-2xl hover:shadow-brand-500/10";
const premiumMetricIcon = "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border shadow-inner transition-all duration-300 group-hover:scale-105";
// `min-w-0 truncate` is load-bearing, not decoration.
//
// Each tile is `flex items-center justify-between` with this label and a
// `shrink-0` icon. A one-word label has `min-width: auto` = its own
// min-content, so the row cannot shrink below label + gap + icon + padding —
// and past that the icon is pushed outside the card, which `overflow-hidden`
// then clips. `tracking-[0.18em]` makes the label unusually wide for its
// point size, so the floor is high.
//
// Measured in Chromium against the compiled stylesheet at six widths, with
// the sidebar expanded: at 1280 ALL NINE icons were outside their card —
// Outbound and Voicemail by 56px each, which are two of the three the audit
// arrows point at — and clipping persisted at 1366 (8), 1440 (5), 1536 (3)
// and 1600 (3), clearing only at 1920. That is exactly "on a pc monitor it is
// fine, but on a laptop screen it changes". After: zero at every width.
const premiumMetricLabel = "min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground";
const premiumMetricValue = "text-2xl font-bold leading-none tracking-tight md:text-[1.65rem]";
const premiumControl = "border-border dark:border-white/10 bg-background/35 dark:bg-black/35 text-foreground shadow-inner shadow-sm dark:shadow-black/20 transition-colors hover:border-brand-400/40 hover:bg-brand-400/5 focus-visible:ring-2 focus-visible:ring-brand-400/70";
const premiumFilterControl = "h-11 rounded-2xl border-border dark:border-white/10 bg-background/45 dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/35 hover:bg-brand-300/10 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black focus-visible:ring-2 focus-visible:ring-brand-300/70";
const premiumFilterControlActive = "border-brand-300/45 bg-brand-300/12 text-brand-50 shadow-brand-500/10";
const premiumSearchInput = "h-11 rounded-2xl border-border dark:border-white/10 bg-background/55 dark:bg-black/55 pl-11 text-sm text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/30 placeholder:text-muted-foreground dark:placeholder:text-muted-foreground transition-all duration-200 hover:border-brand-300/30 focus-visible:border-brand-300/60 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black";
const premiumActiveFilterBadge = "rounded-full border border-brand-300/35 bg-brand-300/10 px-2.5 py-1 text-xs font-medium text-brand-100 shadow-sm shadow-brand-500/10";
const premiumActionBase = "min-h-10 justify-center rounded-full border px-3.5 font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:translate-y-0 disabled:pointer-events-none disabled:opacity-50";
const premiumReportAction = `${premiumActionBase} border-brand-300/50 bg-gradient-to-r from-brand-300/95 to-brand-500/90 text-brand-950 shadow-brand-500/20 hover:border-brand-100 hover:from-brand-200 hover:to-brand-400 hover:text-brand-950 hover:shadow-lg hover:shadow-brand-500/25 focus-visible:ring-brand-300`;
const premiumUtilityAction = `${premiumActionBase} border-info/40 bg-info/10 text-info shadow-info/10 hover:border-info/60 hover:bg-info/15 hover:shadow-lg hover:shadow-info/15 focus-visible:ring-info`;
const premiumQualityAction = `${premiumActionBase} border-success/25 bg-success/10 text-success hover:border-success/45 hover:bg-success/15 hover:text-success focus-visible:ring-success`;
const premiumAlertAction = `${premiumActionBase} border-brand-300/30 bg-brand-400/10 text-brand-100 hover:border-brand-300/55 hover:bg-brand-400/15 hover:text-brand-50 focus-visible:ring-brand-300`;
const premiumDangerAction = `${premiumActionBase} border-destructive/35 bg-destructive/10 text-destructive hover:border-destructive/55 hover:bg-destructive/15 hover:text-destructive focus-visible:ring-destructive`;
const premiumSecondaryAction = `${premiumActionBase} border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-300/10 hover:text-brand-50 focus-visible:ring-brand-300`;
const premiumTabList = "inline-flex h-auto min-w-max items-center gap-1.5 rounded-[1.35rem] border border-border dark:border-white/10 bg-background/45 dark:bg-black/45 p-1.5 shadow-2xl shadow-sm dark:shadow-black/30 backdrop-blur-xl";
const premiumTabTrigger = "group relative min-h-11 rounded-2xl border border-transparent px-4 py-2.5 text-xs font-medium text-muted-foreground dark:text-muted-foreground transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-brand-300/25 hover:bg-brand-300/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-300/45 data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-400/25 data-[state=active]:via-brand-300/15 data-[state=active]:to-brand-500/10 data-[state=active]:text-brand-50 data-[state=active]:shadow-[0_14px_34px_rgba(245,158,11,0.16),inset_0_1px_0_rgba(255,255,255,0.12)] md:text-sm";
const premiumWorkspaceFrame = "relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card/85 dark:from-background/85 via-background/70 dark:via-black/70 to-card/90 dark:to-background/90 p-3 shadow-2xl shadow-sm dark:shadow-black/25 backdrop-blur-xl md:p-4 before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/45 before:to-transparent";
const premiumInteractiveBadge = "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md";
const detailTabTrigger = "rounded-2xl border border-transparent px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:border-brand-300/25 hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:border-brand-300/35";
const detailLabel = "text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground";
const detailValue = "mt-1 break-words text-sm font-medium text-foreground dark:text-foreground";

interface SquadAssistant {
  id: string;
  name?: string;
  role?: string;
  handoffTimestamp?: string;
}

interface HandoffEvent {
  fromAssistant: string;
  toAssistant: string;
  timestamp: string;
  reason?: string;
}

interface StructuredDataMultiItem {
  assistant: string;
  data: Record<string, unknown>;
}

interface NegativeSentimentMoment {
  timestamp: number | null;
  transcriptSegment: string;
  triggerPhrase: string;
}

interface CallLog {
  id: string;
  vapi_call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  phone_number: string | null;
  customer_name: string | null;
  call_direction: string | null;
  call_status: string | null;
  call_outcome: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  cost: number | null;
  transcript: string | null;
  summary: string | null;
  sentiment: string | null;
  key_topics: string[] | null;
  action_items: string[] | null;
  recording_url: string | null;
  metadata: unknown;
  created_at: string;
  tags: string[] | null;
  artifact_messages: unknown[] | null;
  // Squad-specific fields
  is_squad_call: boolean | null;
  squad_id: string | null;
  squad_name: string | null;
  call_intent: string | null;
  assistants_involved: SquadAssistant[] | null;
  handoff_sequence: HandoffEvent[] | null;
  structured_data_multi: StructuredDataMultiItem[] | null;
  // Negative call analysis fields
  root_cause_category: string | null;
  escalation_severity: number | null;
  resolution_status: string | null;
  resolution_notes: string | null;
  ai_recommendations: string[] | null;
  negative_sentiment_moment: NegativeSentimentMoment | null;
  recovery_priority: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface CallStats {
  totalCalls: number;
  completedCalls: number;
  successRate: number;
  avgDuration: number;
  totalCost: number;
  inboundCalls: number;
  outboundCalls: number;
  voicemails: number;
  squadCalls: number;
}

const CallLogs = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  // Test-number cleanup and the contact-name backfill are operator tooling; a
  // client-facing deployment keeps the call log itself and drops them.
  const showInternalCallTools = !isClientFacingDeployment();
  const { canEdit: canEditCalls, canDelete: canDeleteCalls } = useModulePermissions('call_logs');
  const { fetchCallLogs, fetchCall } = useSecureCallLogs();
  const recordingPlayerRef = useRef<CallRecordingPlayerHandle>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [filteredCalls, setFilteredCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [selectedOutcome, setSelectedOutcome] = useState<string>('all');
  const [selectedSquadType, setSelectedSquadType] = useState<string>('all');
  const [selectedSquad, setSelectedSquad] = useState<string>('all');
  const [selectedIntent, setSelectedIntent] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [showCallDetail, setShowCallDetail] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [agents, setAgents] = useState<{ name: string; count: number }[]>([]);
  const [squads, setSquads] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<CallStats>({
    totalCalls: 0,
    completedCalls: 0,
    successRate: 0,
    avgDuration: 0,
    totalCost: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    voicemails: 0,
    squadCalls: 0,
  });

  // Handle modal close - stop recording playback
  const handleModalOpenChange = useCallback((open: boolean) => {
    if (!open && recordingPlayerRef.current) {
      recordingPlayerRef.current.stop();
    }
    setShowCallDetail(open);
  }, []);

  useEffect(() => {
    fetchCalls();

    // Set up realtime subscription
    const channel = supabase
      .channel('vapi-call-logs-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vapi_call_logs' },
        (payload) => {
          console.log('Call log change:', payload);
          fetchCalls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    filterCalls();
  }, [calls, searchQuery, selectedAgent, selectedOutcome, selectedSquadType, selectedSquad, selectedIntent, selectedTags, dateRange]);

  useEffect(() => {
    calculateStats();
  }, [filteredCalls]);

  const fetchCalls = async () => {
    setLoading(true);
    const BATCH_SIZE = 30;
    const MAX_BATCHES = 200; // hard safety stop (≈6,000 rows)
    let accumulated: CallLog[] = [];

    const transform = (rows: any[]): CallLog[] =>
      (rows || []).map(call => ({
        ...call,
        assistants_involved: (call.assistants_involved as unknown as SquadAssistant[]) || null,
        handoff_sequence: (call.handoff_sequence as unknown as HandoffEvent[]) || null,
        structured_data_multi: (call.structured_data_multi as unknown as StructuredDataMultiItem[]) || null,
      }));

    const refreshDerived = (rows: CallLog[]) => {
      const agentCounts = new Map<string, number>();
      const uniqueSquads = new Map<string, string>();
      rows.forEach(call => {
        if (call.agent_name) {
          agentCounts.set(call.agent_name, (agentCounts.get(call.agent_name) || 0) + 1);
        }
        if (call.squad_id) {
          uniqueSquads.set(call.squad_id, call.squad_name || call.squad_id);
        }
      });
      setAgents(
        Array.from(agentCounts, ([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setSquads(Array.from(uniqueSquads, ([id, name]) => ({ id, name })));
    };

    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const offset = i * BATCH_SIZE;
        const result: any = await fetchCallLogs({ limit: BATCH_SIZE, offset });

        if (result.error) throw result.error;

        const batch = transform(result.data || []);
        accumulated = accumulated.concat(batch);

        // Progressive UI update — first batch unblocks the table, then keeps growing
        setCalls([...accumulated]);
        refreshDerived(accumulated);

        if (i === 0) {
          setLoading(false);
          toast({
            title: 'Loading call logs',
            description:
              result.total != null
                ? `Showing ${accumulated.length} of ${result.total} — loading more in background…`
                : `Loaded ${accumulated.length} so far…`,
          });
        }

        if (!result.hasMore || batch.length < BATCH_SIZE) break;
      }

      toast({
        title: 'Refreshed',
        description: `${accumulated.length} call logs loaded`,
      });
    } catch (error: any) {
      console.error('Error fetching calls:', error);
      const description =
        error?.message ||
        error?.error?.message ||
        (typeof error === 'string' ? error : 'Failed to fetch call logs');
      toast({
        title: 'Failed to refresh call logs',
        description,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filterCalls = () => {
    let filtered = [...calls];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(call =>
        call.phone_number?.toLowerCase().includes(query) ||
        call.customer_name?.toLowerCase().includes(query) ||
        call.summary?.toLowerCase().includes(query) ||
        call.agent_name?.toLowerCase().includes(query) ||
        call.squad_name?.toLowerCase().includes(query)
      );
    }

    if (selectedAgent !== 'all') {
      filtered = filtered.filter(call => call.agent_name === selectedAgent);
    }

    if (selectedOutcome !== 'all') {
      filtered = filtered.filter(call => call.call_outcome === selectedOutcome);
    }

    if (selectedSquadType !== 'all') {
      if (selectedSquadType === 'squad') {
        filtered = filtered.filter(call => call.is_squad_call === true);
      } else if (selectedSquadType === 'non-squad') {
        filtered = filtered.filter(call => !call.is_squad_call);
      }
    }

    if (selectedSquad !== 'all') {
      filtered = filtered.filter(call => call.squad_id === selectedSquad);
    }

    if (selectedIntent !== 'all') {
      filtered = filtered.filter(call => call.call_intent === selectedIntent);
    }

    if (selectedTags.length > 0) {
      filtered = filtered.filter(call =>
        selectedTags.some(tag => call.tags?.includes(tag))
      );
    }

    // Date range filter - use started_at if available, otherwise fall back to created_at
    if (dateRange?.from) {
      const fromDate = startOfDay(dateRange.from);
      const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);

      filtered = filtered.filter(call => {
        // Use started_at if available, otherwise use created_at (for failed/unanswered calls)
        const callDate = call.started_at ? new Date(call.started_at) : (call.created_at ? new Date(call.created_at) : null);
        if (!callDate) return false;
        return isWithinInterval(callDate, { start: fromDate, end: toDate });
      });
    }

    setFilteredCalls(filtered);
  };

  const updateCallTags = (callId: string, newTags: string[]) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, tags: newTags } : c));
    if (selectedCall?.id === callId) {
      setSelectedCall(prev => prev ? { ...prev, tags: newTags } : null);
    }
  };

  const calculateStats = () => {
    const totalCalls = filteredCalls.length;
    const completedCalls = filteredCalls.filter(c => getOutcomeCategory(c.call_outcome) === 'success').length;
    const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

    const callsWithDuration = filteredCalls.filter(c => c.duration_seconds);
    const avgDuration = callsWithDuration.length > 0
      ? Math.round(callsWithDuration.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / callsWithDuration.length)
      : 0;

    const totalCost = filteredCalls.reduce((sum, c) => sum + (c.cost || 0), 0);
    const inboundCalls = filteredCalls.filter(c => c.call_direction === 'inbound').length;
    const outboundCalls = filteredCalls.filter(c => c.call_direction === 'outbound').length;
    const voicemails = filteredCalls.filter(c => getOutcomeCategory(c.call_outcome) === 'voicemail').length;
    const squadCalls = filteredCalls.filter(c => c.is_squad_call).length;

    setStats({
      totalCalls,
      completedCalls,
      successRate,
      avgDuration,
      totalCost,
      inboundCalls,
      outboundCalls,
      voicemails,
      squadCalls,
    });
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // VAPI outcome category helpers
  const getOutcomeCategory = (outcome: string | null): string => {
    if (!outcome) return 'unknown';
    const o = outcome.toLowerCase();
    if (o === 'customer-ended-call' || o === 'assistant-ended-call' || o === 'assistant-forwarded-call' || o === 'completed') return 'success';
    if (o === 'voicemail') return 'voicemail';
    if (o === 'customer-did-not-answer' || o === 'no-answer') return 'no-answer';
    if (o === 'customer-busy' || o.includes('operator-busy') || o === 'busy') return 'busy';
    if (o === 'silence-timed-out' || o === 'exceeded-max-duration' || o === 'timeout') return 'timeout';
    if (o === 'manually-canceled' || o === 'cancelled') return 'cancelled';
    if (o === 'blacklisted' || o === 'killed') return 'error';
    if (o.includes('error') || o.includes('failed')) return 'error';
    return 'other';
  };

  const OUTCOME_DISPLAY: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
    'customer-ended-call': { label: 'Customer Ended', color: 'border border-success/30 bg-success/15 text-success shadow-sm shadow-success/10', icon: CheckCircle },
    'assistant-ended-call': { label: 'Assistant Ended', color: 'border border-success/30 bg-success/15 text-success shadow-sm shadow-success/10', icon: CheckCircle },
    'assistant-forwarded-call': { label: 'Forwarded', color: 'border border-info/30 bg-info/15 text-info shadow-sm shadow-info/10', icon: Phone },
    'voicemail': { label: 'Voicemail', color: 'border border-brand-300/35 bg-brand-500/15 text-brand-200 shadow-sm shadow-brand-500/10', icon: Voicemail },
    'customer-did-not-answer': { label: 'No Answer', color: 'border border-warning/30 bg-warning/15 text-warning shadow-sm shadow-warning/10', icon: Phone },
    'customer-busy': { label: 'Busy', color: 'border border-brand-300/30 bg-brand-500/15 text-brand-100 shadow-sm shadow-brand-500/10', icon: Phone },
    'silence-timed-out': { label: 'Silence Timeout', color: 'border border-accent/30 bg-accent/15 text-accent shadow-sm shadow-accent/10', icon: Clock },
    'exceeded-max-duration': { label: 'Max Duration', color: 'border border-accent/30 bg-accent/15 text-accent shadow-sm shadow-accent/10', icon: Clock },
    'manually-canceled': { label: 'Cancelled', color: 'border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-foreground shadow-sm shadow-sm dark:shadow-black/10', icon: XCircle },
    // Legacy values
    'completed': { label: 'Completed', color: 'border border-success/30 bg-success/15 text-success shadow-sm shadow-success/10', icon: CheckCircle },
    'no-answer': { label: 'No Answer', color: 'border border-warning/30 bg-warning/15 text-warning shadow-sm shadow-warning/10', icon: Phone },
    'busy': { label: 'Busy', color: 'border border-brand-300/30 bg-brand-500/15 text-brand-100 shadow-sm shadow-brand-500/10', icon: Phone },
    'failed': { label: 'Failed', color: 'border border-destructive/35 bg-destructive/15 text-destructive shadow-sm shadow-destructive/10', icon: XCircle },
    'cancelled': { label: 'Cancelled', color: 'border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-foreground shadow-sm shadow-sm dark:shadow-black/10', icon: XCircle },
    'timeout': { label: 'Timeout', color: 'border border-accent/30 bg-accent/15 text-accent shadow-sm shadow-accent/10', icon: Clock },
    // Security terminations
    'blacklisted': { label: 'Blacklisted', color: 'border border-destructive/35 bg-destructive/15 text-destructive shadow-sm shadow-destructive/10', icon: Ban },
    'killed': { label: 'Killed', color: 'border border-destructive/35 bg-destructive/15 text-destructive shadow-sm shadow-destructive/10', icon: XCircle },
  };

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) return <Badge variant="outline" className="rounded-full border-border dark:border-white/15 bg-card/5 dark:bg-white/5 px-2.5 py-1 text-xs text-muted-foreground dark:text-foreground">Unknown</Badge>;
    const display = OUTCOME_DISPLAY[outcome];
    if (display) {
      const Icon = display.icon;
      return <Badge className={cn("rounded-full px-2.5 py-1 text-xs font-medium", display.color)}><Icon className="mr-1 h-3 w-3" /> {display.label}</Badge>;
    }
    // Fallback for any VAPI reason not explicitly mapped - format nicely
    const category = getOutcomeCategory(outcome);
    const fallbackColors: Record<string, string> = {
      'error': 'border border-destructive/35 bg-destructive/15 text-destructive shadow-sm shadow-destructive/10',
      'other': 'border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-foreground shadow-sm shadow-sm dark:shadow-black/10',
    };
    const color = fallbackColors[category] || fallbackColors['other'];
    const label = outcome.replace(/[-._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return <Badge className={cn("rounded-full px-2.5 py-1 text-xs font-medium", color)}><XCircle className="mr-1 h-3 w-3" /> {label}</Badge>;
  };

  const getSentimentBadge = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive':
        return <Badge className="rounded-full border border-success/30 bg-success/15 px-2.5 py-1 text-xs text-success shadow-sm shadow-success/10">Positive</Badge>;
      case 'negative':
        return <Badge className="rounded-full border border-destructive/35 bg-destructive/15 px-2.5 py-1 text-xs text-destructive shadow-sm shadow-destructive/10">Negative</Badge>;
      case 'neutral':
        return <Badge className="rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-2.5 py-1 text-xs text-muted-foreground dark:text-foreground">Neutral</Badge>;
      case 'mixed':
        return <Badge className="rounded-full border border-brand-300/35 bg-brand-500/15 px-2.5 py-1 text-xs text-brand-200 shadow-sm shadow-brand-500/10">Mixed</Badge>;
      default:
        return null;
    }
  };

  const openCallDetail = async (call: CallLog) => {
    // Show modal immediately with the lightweight list row, then hydrate
    // with full call (transcript + artifact_messages) which were excluded
    // from the list payload to keep the refresh fast.
    setSelectedCall(call);
    setShowCallDetail(true);
    try {
      const { data: full, error } = await fetchCall(call.id);
      if (!error && full) {
        setSelectedCall(prev =>
          prev && prev.id === full.id
            ? ({ ...prev, ...full } as CallLog)
            : prev
        );
      }
    } catch (err) {
      console.warn('[CallLogs] Failed to hydrate full call detail:', err);
    }
  };

  return (
    <DashboardThemeFrame as="main" variant="page" className={premiumPageShell}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/50 to-transparent" />
      <div className="mx-auto max-w-[1800px] space-y-5 md:space-y-7 pb-20 md:pb-0">
      {/* Header */}
      {/* Side-by-side only from xl: at laptop widths (lg) the action toolbar
          needs its own full-width row or it wraps into the title and the
          layout shifts with every zoom step.
          Even at xl the split has to be declared rather than left to the
          leftovers. `min-w-0` alone lets the title column be crushed by the
          seven-button toolbar beside it — measured at 314px on a 1920 window
          and 170px at 1280, which is where "Call Logs" stops fitting on one
          line and every zoom step moves the whole header. A column that must
          not be crushed declares a basis; the toolbar keeps its own width. */}
      <DashboardThemeFrame as="header" variant="hero" className="flex flex-col gap-4 border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.84)_52%,hsl(var(--primary)/0.12))] p-4 shadow-2xl shadow-sm dark:shadow-black/20 sm:p-5 lg:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 overflow-visible xl:basis-[26rem] xl:grow">
          <div className="mb-2 inline-flex items-center rounded-full border border-brand-300/25 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-100 shadow-sm shadow-brand-500/10">Voice Intelligence</div>
          <h1 className="overflow-visible pb-1 text-3xl font-bold leading-[1.12] tracking-tight bg-gradient-to-r from-brand-100 via-foreground to-brand-300 bg-clip-text text-transparent md:text-5xl">
            Call Logs
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground/85 dark:text-foreground/85">Track and analyze voice agent call outcomes</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <LiveModelBadge agentKey="vapi_call_summary" size="sm" showSlot />
            <LiveModelBadge agentKey="transcript_cleaning" size="sm" showSlot />
            <ModelUpgradeButton agentKey="vapi_call_summary" />
          </div>
        </div>

        <DashboardThemeFrame variant="toolbar" className="w-full border-primary/10 bg-background/45 shadow-inner shadow-sm dark:shadow-black/10 xl:w-auto xl:shrink-0 xl:justify-end">
          <div className="flex flex-1 flex-wrap items-center gap-2 xl:flex-none xl:justify-end">
          {!isMobile && <WeeklyReportConfig triggerClassName={premiumReportAction} />}
          {!isMobile && showInternalCallTools && <CleanupTestCalls onComplete={fetchCalls} testNumbersButtonClassName={premiumUtilityAction} flushButtonClassName={premiumDangerAction} />}
          {!isMobile && showInternalCallTools && <CleanupContactNames onComplete={fetchCalls} triggerClassName={premiumQualityAction} />}
          {!isMobile && <CallAlerts calls={filteredCalls} triggerClassName={premiumAlertAction} />}
          <CallLogsExport calls={filteredCalls} stats={stats} triggerClassName={premiumSecondaryAction} />
          <Button onClick={fetchCalls} variant="outline" size="sm" className={cn("gap-2", premiumSecondaryAction)}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          </div>
        </DashboardThemeFrame>
      </DashboardThemeFrame>

      {/* Main Tabs */}
      <Tabs defaultValue="logs" className="w-full">
        <div className={cn("-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0", premiumScrollbar)}>
          <TabsList aria-label="Call log views" className={cn(premiumTabList, isMobile ? "w-auto" : "")}>
            <TabsTrigger value="logs" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <Phone className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Call</span> Logs
            </TabsTrigger>
            <TabsTrigger value="issues" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Issues</span>
            </TabsTrigger>
            <TabsTrigger value="live" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <Radio className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              Live
            </TabsTrigger>
            <TabsTrigger value="blacklist" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <Ban className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              Blacklist
            </TabsTrigger>
            <TabsTrigger value="trends" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <LineChart className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              Trends
            </TabsTrigger>
            <TabsTrigger value="analytics" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <PieChart className="h-3.5 w-3.5 shrink-0 transition-colors group-data-[state=active]:text-brand-200 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Analytics</span>
            </TabsTrigger>
            <TabsTrigger value="squad-analytics" className={cn("flex items-center gap-1.5 whitespace-nowrap md:gap-2", premiumTabTrigger)}>
              <Users className="h-4 w-4 shrink-0 transition-colors group-data-[state=active]:text-brand-200" />
              Squad Analytics
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="issues" className="mt-4 min-w-0 md:mt-6" aria-label="Call issues analysis">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <NegativeCallAnalysis calls={filteredCalls as any} onRefresh={fetchCalls} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="live" className="mt-4 min-w-0 md:mt-6" aria-label="Live calls monitor">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <LiveCallsMonitor />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="blacklist" className="mt-4 min-w-0 md:mt-6" aria-label="Blacklisted numbers">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <BlacklistedNumbers canEdit={canEditCalls} canDelete={canDeleteCalls} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="trends" className="mt-4 min-w-0 md:mt-6" aria-label="Call trends charts">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <CallAnalyticsTrends calls={filteredCalls} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 min-w-0 md:mt-6" aria-label="Call analytics charts">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <CallAnalyticsDashboard calls={filteredCalls} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="squad-analytics" className="mt-4 min-w-0 md:mt-6" aria-label="Squad analytics charts">
          <DashboardThemeFrame variant="section" className={cn("overflow-x-auto border-primary/15 bg-card/70 p-3 shadow-2xl shadow-sm dark:shadow-black/20 md:p-4", premiumScrollbar)}>
            <SquadAnalyticsDashboard calls={filteredCalls} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent value="logs" className="mt-4 min-h-0 space-y-0 overflow-hidden md:mt-6">

      {/* Sticky header: Stats + Filters */}
      <div className="sticky top-0 z-20 rounded-b-3xl border-x border-b border-border dark:border-white/10 bg-background/70 dark:bg-black/70 pb-4 pt-2 space-y-4 md:space-y-6 backdrop-blur-xl shadow-2xl shadow-sm dark:shadow-black/30">

      {/* Stats Cards - Responsive grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        <Card className={cn(premiumMetricCard, "from-card/95 dark:from-background/95 via-card/85 dark:via-background/85")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Total</span>
              <div className={cn(premiumMetricIcon, "border-border/25 bg-muted/10 text-muted-foreground dark:text-foreground")}>
                <Phone className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-foreground dark:text-foreground")}>{stats.totalCalls}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-success/15 via-card/85 dark:via-background/85 hover:border-success/40 hover:shadow-success/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Done</span>
              <div className={cn(premiumMetricIcon, "border-success/25 bg-success/10 text-success")}>
                <CheckCircle className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-success")}>{stats.completedCalls}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-info/15 via-card/85 dark:via-background/85 hover:border-info/35 hover:shadow-info/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Rate</span>
              <div className={cn(premiumMetricIcon, "border-info/25 bg-info/10 text-info")}>
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-info")}>{stats.successRate}%</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-background/80 via-card/85 dark:via-background/85")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Avg</span>
              <div className={cn(premiumMetricIcon, "border-border/25 bg-muted/40 text-muted-foreground dark:text-foreground")}>
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "font-mono text-foreground dark:text-foreground")}>{formatDuration(stats.avgDuration)}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-brand-500/15 via-card/85 dark:via-background/85")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Cost</span>
              <div className={cn(premiumMetricIcon, "border-brand-300/30 bg-brand-400/10 text-brand-300")}>
                <DollarSign className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-brand-300")}>${stats.totalCost.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-success/15 via-card/85 dark:via-background/85 hover:border-success/35 hover:shadow-success/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Inbound</span>
              <div className={cn(premiumMetricIcon, "border-success/25 bg-success/10 text-success")}>
                <PhoneIncoming className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-success")}>{stats.inboundCalls}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-info/15 via-card/85 dark:via-background/85 hover:border-info/35 hover:shadow-info/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Outbound</span>
              <div className={cn(premiumMetricIcon, "border-info/25 bg-info/10 text-info")}>
                <PhoneOutgoing className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-info")}>{stats.outboundCalls}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-warning/15 via-card/85 dark:via-background/85 hover:border-warning/40 hover:shadow-warning/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Voicemail</span>
              <div className={cn(premiumMetricIcon, "border-warning/30 bg-warning/10 text-warning")}>
                <Voicemail className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-warning")}>{stats.voicemails}</p>
          </CardContent>
        </Card>
        <Card className={cn(premiumMetricCard, "from-accent/15 via-card/85 dark:via-background/85 hover:border-accent/35 hover:shadow-accent/10")}>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className={premiumMetricLabel}>Squad</span>
              <div className={cn(premiumMetricIcon, "border-accent/25 bg-accent/10 text-accent")}>
                <Users className="h-4 w-4" />
              </div>
            </div>
            <p className={cn(premiumMetricValue, "text-accent")}>{stats.squadCalls}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters - Mobile: Sheet, Desktop: Inline */}
      {isMobile ? (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-200/70" />
              <Input
                placeholder="Search calls..."
                aria-label="Search calls"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={premiumSearchInput}
              />
            </div>
            <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className={cn("h-11 w-11 shrink-0", premiumFilterControl)}>
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="flex h-[70vh] flex-col border-border dark:border-white/10 bg-background/95 dark:bg-background/95 p-0 shadow-2xl shadow-sm dark:shadow-black/50 backdrop-blur-xl">
                <SheetHeader className="border-b border-border dark:border-white/10 bg-brand-300/5 p-4">
                  <SheetTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Call Filters
                  </SheetTitle>
                </SheetHeader>
                <ScrollArea className={cn("min-h-0 flex-1 p-4", premiumScrollbar)}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Agent</label>
                      <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                        <SelectTrigger className={cn("w-full", premiumFilterControl, selectedAgent !== 'all' && premiumFilterControlActive)}>
                          <SelectValue placeholder="All Agents" />
                        </SelectTrigger>
                        <SelectContent className={premiumSelectContent}>
                          <SelectItem value="all">All Agents</SelectItem>
                          {agents.map(agent => (
                            <SelectItem key={agent.name} value={agent.name}>{agent.name} ({agent.count})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Outcome</label>
                      <Select value={selectedOutcome} onValueChange={setSelectedOutcome}>
                        <SelectTrigger className={cn("w-full", premiumFilterControl, selectedOutcome !== 'all' && premiumFilterControlActive)}>
                          <SelectValue placeholder="All Outcomes" />
                        </SelectTrigger>
                        <SelectContent className={premiumSelectContent}>
                          <SelectItem value="all">All Outcomes</SelectItem>
                          {(() => {
                            const outcomeCounts = new Map<string, number>();
                            calls.forEach(c => {
                              const o = c.call_outcome || 'unknown';
                              outcomeCounts.set(o, (outcomeCounts.get(o) || 0) + 1);
                            });
                            return Array.from(outcomeCounts.entries())
                              .sort((a, b) => b[1] - a[1])
                              .map(([outcome, count]) => {
                                const display = OUTCOME_DISPLAY[outcome];
                                const label = display?.label || outcome.replace(/[-._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                return <SelectItem key={outcome} value={outcome}>{label} ({count})</SelectItem>;
                              });
                          })()}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Call Type</label>
                      <Select value={selectedSquadType} onValueChange={setSelectedSquadType}>
                        <SelectTrigger className={cn("w-full", premiumFilterControl, selectedSquadType !== 'all' && premiumFilterControlActive)}>
                          <SelectValue placeholder="Call Type" />
                        </SelectTrigger>
                        <SelectContent className={premiumSelectContent}>
                          <SelectItem value="all">All Call Types</SelectItem>
                          <SelectItem value="squad">Squad Calls</SelectItem>
                          <SelectItem value="non-squad">Non-Squad Calls</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Intent</label>
                      <Select value={selectedIntent} onValueChange={setSelectedIntent}>
                        <SelectTrigger className={cn("w-full", premiumFilterControl, selectedIntent !== 'all' && premiumFilterControlActive)}>
                          <SelectValue placeholder="Intent" />
                        </SelectTrigger>
                        <SelectContent className={premiumSelectContent}>
                          <SelectItem value="all">All Intents</SelectItem>
                          <SelectItem value="discovery_booking">Discovery</SelectItem>
                          <SelectItem value="strategy_booking">Strategy</SelectItem>
                          <SelectItem value="finance_consult">Finance</SelectItem>
                          <SelectItem value="general_inquiry">General Inquiry</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tags</label>
                      <CallTagFilter selectedTags={selectedTags} onTagsChange={setSelectedTags} triggerClassName={cn(premiumFilterControl, selectedTags.length > 0 && premiumFilterControlActive)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Date Range</label>
                      <div className="flex flex-wrap gap-2">
                        <Button variant={!dateRange ? "default" : "outline"} size="sm" onClick={() => setDateRange(undefined)}>All Time</Button>
                        <Button variant="outline" size="sm" onClick={() => setDateRange({ from: new Date(), to: new Date() })}>Today</Button>
                        <Button variant="outline" size="sm" onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}>7 days</Button>
                        <Button variant="outline" size="sm" onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}>30 days</Button>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className={cn("w-full", premiumFilterControl)}
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedAgent('all');
                        setSelectedOutcome('all');
                        setSelectedSquadType('all');
                        setSelectedSquad('all');
                        setSelectedIntent('all');
                        setSelectedTags([]);
                        setDateRange(undefined);
                      }}
                    >
                      Clear All Filters
                    </Button>
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
          {/* Active filter count badge */}
          {(selectedAgent !== 'all' || selectedOutcome !== 'all' || selectedSquadType !== 'all' || selectedIntent !== 'all' || selectedTags.length > 0 || dateRange) && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={premiumActiveFilterBadge}>
                {[selectedAgent !== 'all', selectedOutcome !== 'all', selectedSquadType !== 'all', selectedIntent !== 'all', selectedTags.length > 0, !!dateRange].filter(Boolean).length} filter(s) active
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs text-muted-foreground dark:text-foreground hover:bg-brand-300/10 hover:text-brand-100"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedAgent('all');
                  setSelectedOutcome('all');
                  setSelectedSquadType('all');
                  setSelectedSquad('all');
                  setSelectedIntent('all');
                  setSelectedTags([]);
                  setDateRange(undefined);
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card className={cn(premiumPanel, "relative overflow-hidden rounded-3xl border-brand-300/10")}>
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent" />
          <CardContent className="p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-full flex-[1.5] sm:min-w-[260px]">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-200/70" />
                  <Input
                    placeholder="Search by phone, name, or summary..."
                    aria-label="Search by phone, name, or summary"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={premiumSearchInput}
                  />
                </div>
              </div>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className={cn("w-full sm:w-[180px]", premiumFilterControl, selectedAgent !== 'all' && premiumFilterControlActive)}>
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent className={premiumSelectContent}>
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map(agent => (
                    <SelectItem key={agent.name} value={agent.name}>{agent.name} ({agent.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedOutcome} onValueChange={setSelectedOutcome}>
                <SelectTrigger className={cn("w-full sm:w-[180px]", premiumFilterControl, selectedOutcome !== 'all' && premiumFilterControlActive)}>
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Outcomes" />
                </SelectTrigger>
                <SelectContent className={premiumSelectContent}>
                  <SelectItem value="all">All Outcomes</SelectItem>
                  {(() => {
                    const outcomeCounts = new Map<string, number>();
                    calls.forEach(c => {
                      const o = c.call_outcome || 'unknown';
                      outcomeCounts.set(o, (outcomeCounts.get(o) || 0) + 1);
                    });
                    return Array.from(outcomeCounts.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([outcome, count]) => {
                        const display = OUTCOME_DISPLAY[outcome];
                        const label = display?.label || outcome.replace(/[-._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return <SelectItem key={outcome} value={outcome}>{label} ({count})</SelectItem>;
                      });
                  })()}
                </SelectContent>
              </Select>
              <Select value={selectedSquadType} onValueChange={setSelectedSquadType}>
                <SelectTrigger className={cn("w-full sm:w-[160px]", premiumFilterControl, selectedSquadType !== 'all' && premiumFilterControlActive)}>
                  <Users className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Call Type" />
                </SelectTrigger>
                <SelectContent className={premiumSelectContent}>
                  <SelectItem value="all">All Call Types</SelectItem>
                  <SelectItem value="squad">Squad Calls</SelectItem>
                  <SelectItem value="non-squad">Non-Squad Calls</SelectItem>
                </SelectContent>
              </Select>
              {squads.length > 0 && (
                <Select value={selectedSquad} onValueChange={setSelectedSquad}>
                  <SelectTrigger className={cn("w-full sm:w-[200px]", premiumFilterControl, selectedSquad !== 'all' && premiumFilterControlActive)}>
                    <GitBranch className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Squads" />
                  </SelectTrigger>
                  <SelectContent className={premiumSelectContent}>
                    <SelectItem value="all">All Squads</SelectItem>
                    {squads.map(squad => (
                      <SelectItem key={squad.id} value={squad.id}>{squad.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={selectedIntent} onValueChange={setSelectedIntent}>
                <SelectTrigger className={cn("w-full sm:w-[160px]", premiumFilterControl, selectedIntent !== 'all' && premiumFilterControlActive)}>
                  <Target className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Intent" />
                </SelectTrigger>
                <SelectContent className={premiumSelectContent}>
                  <SelectItem value="all">All Intents</SelectItem>
                  <SelectItem value="discovery_booking">Discovery</SelectItem>
                  <SelectItem value="strategy_booking">Strategy</SelectItem>
                  <SelectItem value="finance_consult">Finance</SelectItem>
                  <SelectItem value="general_inquiry">General Inquiry</SelectItem>
                </SelectContent>
              </Select>
              <CallTagFilter selectedTags={selectedTags} onTagsChange={setSelectedTags} triggerClassName={cn(premiumFilterControl, selectedTags.length > 0 && premiumFilterControlActive)} />

              {/* Date Range Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal sm:w-[240px]", premiumFilterControl,
                      dateRange && premiumFilterControlActive,
                      !dateRange && "text-muted-foreground dark:text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d, yyyy")}
                        </>
                      ) : (
                        format(dateRange.from, "MMM d, yyyy")
                      )
                    ) : (
                      <span>Filter by date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className={cn("w-auto overflow-hidden rounded-3xl p-0", premiumSelectContent)} align="start">
                  <div className="space-y-2 border-b border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                    <p className="text-sm font-medium">Quick Select</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDateRange({ from: new Date(), to: new Date() })}
                      >
                        Today
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}
                      >
                        Last 7 days
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}
                      >
                        Last 30 days
                      </Button>
                      {dateRange && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDateRange(undefined)}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    className="pointer-events-auto bg-transparent text-foreground dark:text-foreground"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>
      )}

      </div>
      {/* End sticky header */}

      <div className="mt-4 min-h-0 md:mt-6">
      {/* Call List */}
      <Card className={cn(premiumPanel, "rounded-3xl overflow-hidden")}>
        <CardHeader className="pb-4 border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-accent/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground dark:text-foreground">
                <BarChart3 className="h-5 w-5 text-brand-300" />
                Call History
              </CardTitle>
              <CardDescription className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
                <span className="rounded-full border border-brand-300/25 bg-background/35 dark:bg-black/35 px-3 py-1 font-medium text-brand-100 shadow-inner shadow-sm dark:shadow-black/30">
                  {filteredCalls.length} {filteredCalls.length === 1 ? 'call' : 'calls'} found
                </span>
                {calls.length !== filteredCalls.length && (
                  <span className="text-muted-foreground dark:text-muted-foreground">filtered from {calls.length}</span>
                )}
              </CardDescription>
            </div>
            {/* Active filters summary */}
            {(selectedAgent !== 'all' || selectedOutcome !== 'all' || selectedSquadType !== 'all' || selectedSquad !== 'all' || selectedIntent !== 'all' || searchQuery || dateRange) && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-2 shadow-inner shadow-sm dark:shadow-black/30 lg:justify-end">
                {searchQuery && (
                  <Badge variant="secondary" className={premiumActiveFilterBadge}>
                    Search: "{searchQuery}"
                  </Badge>
                )}
                {dateRange?.from && (
                  <Badge variant="secondary" className={premiumActiveFilterBadge}>
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    {dateRange.to
                      ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d")}`
                      : format(dateRange.from, "MMM d, yyyy")
                    }
                  </Badge>
                )}
                {selectedSquad !== 'all' && (
                  <Badge className="rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-xs text-accent-foreground shadow-sm shadow-accent/10">
                    Squad: {squads.find(s => s.id === selectedSquad)?.name}
                  </Badge>
                )}
                {selectedIntent !== 'all' && (
                  <Badge className="rounded-full border border-success/30 bg-success/15 px-2.5 py-1 text-xs text-success shadow-sm shadow-success/10">
                    Intent: {selectedIntent.replace(/_/g, ' ')}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs text-muted-foreground dark:text-foreground hover:bg-brand-300/10 hover:text-brand-100"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedAgent('all');
                    setSelectedOutcome('all');
                    setSelectedSquadType('all');
                    setSelectedSquad('all');
                    setSelectedIntent('all');
                    setDateRange(undefined);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="bg-background/10 dark:bg-black/10 p-3 md:p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-brand-300" />
              <p className="text-sm text-muted-foreground">Loading call logs...</p>
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="text-center py-16">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-300/10 shadow-inner shadow-brand-500/10">
                <Phone className="w-8 h-8 text-brand-200/80" />
              </div>
              <p className="font-medium text-foreground mb-1">No call logs found</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {calls.length > 0
                  ? 'Try adjusting your filters to see more results'
                  : 'Calls will appear here once your Vapi agents start making calls'}
              </p>
              {calls.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("mt-4", premiumSecondaryAction)}
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedAgent('all');
                    setSelectedOutcome('all');
                    setSelectedSquadType('all');
                    setSelectedSquad('all');
                    setSelectedIntent('all');
                    setDateRange(undefined);
                  }}
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div className={cn("max-h-[min(64rem,calc(100vh-18rem))] min-h-[18rem] space-y-3 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6", premiumScrollbar)}>
              {filteredCalls.map(call => (
                <div
                  key={call.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open details for ${call.customer_name || call.phone_number || 'Unknown Caller'}`}
                  className={`group relative overflow-hidden rounded-2xl border border-border dark:border-white/10 bg-gradient-to-r from-card/95 dark:from-background/95 via-card/80 dark:via-background/80 to-background/90 dark:to-black/90 p-3 cursor-pointer shadow-lg shadow-sm dark:shadow-black/20 transition-all duration-300 before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-brand-300/35 before:to-transparent hover:-translate-y-0.5 hover:border-brand-300/35 hover:bg-brand-300/5 hover:shadow-xl hover:shadow-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:p-4 ${
                    call.is_squad_call ? 'border-l-4 border-l-purple-500' : ''
                  }`}
                  onClick={() => openCallDetail(call)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openCallDetail(call);
                    }
                  }}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* Left section */}
                    <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                      {/* Direction icon */}
                      <div className={`rounded-2xl border p-2.5 shadow-inner ${
                        call.call_direction === 'inbound'
                          ? 'border-success/20 bg-success/10 text-success'
                          : 'border-info/20 bg-info/10 text-info'
                      }`}>
                        <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${
                          call.call_direction === 'inbound' ? 'bg-success/30' : 'bg-info/30'
                        } shadow-[0_0_10px_currentColor]`} />
                        {call.call_direction === 'inbound' ? (
                          <PhoneIncoming className="h-5 w-5" />
                        ) : (
                          <PhoneOutgoing className="h-5 w-5" />
                        )}
                      </div>

                      {/* Main content */}
                      <div className="min-w-0 flex-1">
                        {/* Header row */}
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 max-w-full truncate text-base font-semibold tracking-tight text-foreground dark:text-foreground sm:text-lg">
                            {call.customer_name || call.phone_number || 'Unknown Caller'}
                          </span>

                          {/* Squad badge with name */}
                          {call.is_squad_call && (
                            <Badge className="rounded-full border border-accent/30 bg-accent/15 text-xs font-medium text-accent-foreground shadow-sm shadow-accent/10">
                              <Users className="w-3 h-3 mr-1" />
                              {call.squad_name || 'Squad Call'}
                            </Badge>
                          )}

                          {/* Intent badge */}
                          {call.call_intent && (
                            <Badge className="rounded-full border border-success/30 bg-success/15 text-xs text-success shadow-sm shadow-success/10">
                              <Target className="w-3 h-3 mr-1" />
                              {call.call_intent.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Badge>
                          )}

                          {/* Agent badge for non-squad calls */}
                          {call.agent_name && !call.is_squad_call && (
                            <Badge className="border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-xs text-foreground dark:text-foreground">{call.agent_name}</Badge>
                          )}
                        </div>

                        {/* Handoff flow visualization for squad calls */}
                        {call.is_squad_call && call.assistants_involved && call.assistants_involved.length > 0 && (
                          <div className="mb-3 flex flex-wrap items-center gap-1.5">
                            {call.assistants_involved.map((assistant, i) => (
                              <div key={assistant.id} className="flex items-center">
                                <span className="inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-foreground">
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                                  {assistant.name || `Agent ${i + 1}`}
                                </span>
                                {i < call.assistants_involved!.length - 1 && (
                                  <ArrowRight className="mx-1 h-3 w-3 text-muted-foreground dark:text-muted-foreground" />
                                )}
                              </div>
                            ))}
                            {call.handoff_sequence && call.handoff_sequence.length > 0 && (
                              <Badge variant="secondary" className="ml-2 border border-accent/25 bg-accent/15 text-xs text-accent-foreground">
                                <GitBranch className="w-3 h-3 mr-1" />
                                {call.handoff_sequence.length} handoff{call.handoff_sequence.length > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Meta info row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                          {call.phone_number && call.customer_name && (
                            <span className="rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-2 py-1 font-mono text-xs text-muted-foreground dark:text-foreground">{call.phone_number}</span>
                          )}
                          <span className="flex items-center gap-1 rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-2 py-1">
                            <Clock className="h-3 w-3 text-brand-200/70" />
                            {call.started_at
                              ? format(new Date(call.started_at), 'MMM d, h:mm a')
                              : call.created_at
                                ? <span className="text-muted-foreground/70">{format(new Date(call.created_at), 'MMM d, h:mm a')} (initiated)</span>
                                : '-'
                            }
                          </span>
                          <span className="flex items-center gap-1 rounded-full border border-border/10 bg-muted/5 px-2 py-1 font-mono text-xs font-semibold text-foreground dark:text-foreground">
                            {formatDuration(call.duration_seconds)}
                          </span>
                          {call.cost !== null && call.cost > 0 && (
                            <span className="flex items-center gap-1 rounded-full border border-brand-300/25 bg-brand-300/10 px-2 py-1 font-mono text-xs font-semibold text-brand-200">
                              <DollarSign className="h-3 w-3" />
                              ${call.cost.toFixed(3)}
                            </span>
                          )}
                        </div>
                        {call.tags && call.tags.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            {call.tags.map(tag => (
                              <Badge key={tag} className={callLogBadgeTone('tag', cn('max-w-[180px]', premiumInteractiveBadge))}>
                                <Tag className="mr-1 h-3 w-3 shrink-0" />
                                <span className="truncate">{tag}</span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right section - badges */}
                    <div className="flex flex-wrap items-center gap-2 lg:flex-shrink-0 lg:justify-end">
                      <CallQualityBadge
                        sentiment={call.sentiment}
                        durationSeconds={call.duration_seconds}
                        outcome={call.call_outcome}
                        cost={call.cost}
                        hasTranscript={!!call.transcript}
                      />
                      {getSentimentBadge(call.sentiment)}
                      {getOutcomeBadge(call.call_outcome)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
        </TabsContent>
      </Tabs>

      {/* Call Detail Modal */}
      <Dialog open={showCallDetail} onOpenChange={handleModalOpenChange}>
        <DialogContent className={cn(
          "flex flex-col overflow-hidden rounded-3xl border-border dark:border-white/10 bg-gradient-to-br from-card/98 dark:from-background/98 via-card/95 dark:via-background/95 to-background/95 dark:to-black/95 shadow-2xl shadow-brand-950/20 backdrop-blur-xl",
          isMobile ? "w-[calc(100vw-24px)] max-w-[calc(100vw-24px)] h-[95vh] max-h-[95vh] p-3 rounded-xl" : "w-[calc(100vw-32px)] max-w-6xl h-[85vh] max-h-[85vh]"
        )}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 bg-gradient-to-r from-brand-100 via-muted to-brand-300 bg-clip-text text-transparent">
              <Phone className="h-5 w-5 text-brand-300" />
              Call Details
            </DialogTitle>
            {selectedCall && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {selectedCall.phone_number && (
                  <Badge className={callLogBadgeTone('neutral', premiumInteractiveBadge)}>{selectedCall.phone_number}</Badge>
                )}
                {getOutcomeBadge(selectedCall.call_outcome)}
                {getSentimentBadge(selectedCall.sentiment)}
              </div>
            )}
          </DialogHeader>
          {selectedCall && (
            <Tabs defaultValue="overview" className="w-full flex flex-col flex-1 min-h-0 overflow-hidden max-w-full">
              <div className={cn("-mx-1 overflow-x-auto px-1", premiumScrollbar)}>
                <TabsList className={cn("h-auto min-w-max gap-1 rounded-2xl border border-border dark:border-white/10 bg-background/45 dark:bg-black/45 p-1", isMobile ? "inline-flex w-auto" : `grid w-full ${selectedCall.is_squad_call ? 'grid-cols-7' : 'grid-cols-6'}`)}>
                  <TabsTrigger value="overview" className={isMobile ? "text-xs" : ""}>Overview</TabsTrigger>
                  {selectedCall.is_squad_call && (
                    <TabsTrigger value="squad" className={cn(detailTabTrigger, "flex items-center gap-1 data-[state=active]:bg-accent/15 data-[state=active]:text-accent-foreground", isMobile && "text-xs")}>
                      <Users className="w-3 h-3" />
                      Squad
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="transcript" className={cn(detailTabTrigger, "data-[state=active]:bg-brand-300/15 data-[state=active]:text-brand-100", isMobile ? "text-xs" : "")}>Transcript</TabsTrigger>
                  <TabsTrigger value="tool-calls" className={cn(detailTabTrigger, "data-[state=active]:bg-info/15 data-[state=active]:text-info", isMobile ? "text-xs" : "")}>{isMobile ? "Tools" : "Tool Calls"}</TabsTrigger>
                  <TabsTrigger value="analysis" className={cn(detailTabTrigger, "data-[state=active]:bg-success/15 data-[state=active]:text-success", isMobile ? "text-xs" : "")}>Analysis</TabsTrigger>
                  <TabsTrigger value="metadata" className={cn(detailTabTrigger, "data-[state=active]:bg-muted data-[state=active]:text-foreground", isMobile ? "text-xs" : "")}>{isMobile ? "Meta" : "Metadata"}</TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className={cn("mt-2 max-w-full", isMobile ? "h-[60vh]" : "flex-1")}>
                <TabsContent value="overview" className={cn("space-y-3 sm:space-y-4 min-w-0", isMobile ? "px-1 max-w-[calc(100vw-56px)] overflow-hidden" : "pr-4")}>
                  {/* Squad badge if applicable */}
                  {selectedCall.is_squad_call && (
                    <div className="flex items-center gap-2 mb-4">
                      <Badge className={callLogBadgeTone('squad', premiumInteractiveBadge)}>
                        <Users className="w-3 h-3 mr-1" />
                        Squad Call
                      </Badge>
                      {selectedCall.squad_name && (
                        <Badge className={callLogBadgeTone('neutral', premiumInteractiveBadge)}>{selectedCall.squad_name}</Badge>
                      )}
                      {selectedCall.call_intent && (
                        <Badge className={callLogBadgeTone('success', premiumInteractiveBadge)}>
                          <Target className="w-3 h-3 mr-1" />
                          {selectedCall.call_intent.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                  )}

                  {isMobile ? (
                    /* Mobile: single-column stack */
                    <div className="space-y-2 max-w-full overflow-hidden">
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Customer</p>
                        <p className="font-medium text-sm break-words overflow-hidden">{selectedCall.customer_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground break-all overflow-hidden">{selectedCall.phone_number || '-'}</p>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">{selectedCall.is_squad_call ? 'Primary Agent' : 'Agent'}</p>
                        <p className="font-medium text-sm break-words overflow-hidden">{selectedCall.agent_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground break-all overflow-hidden">{selectedCall.agent_id || '-'}</p>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Direction</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {selectedCall.call_direction === 'inbound' ? (
                            <>
                              <PhoneIncoming className="w-4 h-4 flex-shrink-0 text-success" />
                              <span className="text-sm font-medium">Inbound</span>
                            </>
                          ) : (
                            <>
                              <PhoneOutgoing className="w-4 h-4 flex-shrink-0 text-info" />
                              <span className="text-sm font-medium">Outbound</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Outcome</p>
                        <div className="mt-0.5">{getOutcomeBadge(selectedCall.call_outcome)}</div>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="font-medium text-sm">{formatDuration(selectedCall.duration_seconds)}</p>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="font-medium text-sm">${selectedCall.cost?.toFixed(4) || '0.00'}</p>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Started</p>
                        <p className="font-medium text-sm break-words">
                          {selectedCall.started_at ? format(new Date(selectedCall.started_at), 'PPpp') : '-'}
                        </p>
                      </div>
                      <div className={cn(premiumMutedSurface, "max-w-full overflow-hidden p-3")}>
                        <p className="text-xs text-muted-foreground">Ended</p>
                        <p className="font-medium text-sm break-words">
                          {selectedCall.ended_at ? format(new Date(selectedCall.ended_at), 'PPpp') : '-'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* Desktop: original 3-column grid */
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className={detailLabel}>Customer</p>
                          <p className={detailValue}>{selectedCall.customer_name || 'Unknown'}</p>
                          <p className="text-sm text-muted-foreground">{selectedCall.phone_number || '-'}</p>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">
                            {selectedCall.is_squad_call ? 'Primary Agent' : 'Agent'}
                          </p>
                          <p className="font-medium">{selectedCall.agent_name || 'Unknown'}</p>
                          <p className="text-sm text-muted-foreground">{selectedCall.agent_id || '-'}</p>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Direction</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            {selectedCall.call_direction === 'inbound' ? (
                              <>
                                <PhoneIncoming className="w-4 h-4 text-success" />
                                <span className="text-sm">Inbound</span>
                              </>
                            ) : (
                              <>
                                <PhoneOutgoing className="w-4 h-4 text-info" />
                                <span className="text-sm">Outbound</span>
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Outcome</p>
                          <div className="mt-1">{getOutcomeBadge(selectedCall.call_outcome)}</div>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Duration</p>
                          <p className="font-medium">{formatDuration(selectedCall.duration_seconds)}</p>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Cost</p>
                          <p className="font-medium">${selectedCall.cost?.toFixed(4) || '0.00'}</p>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Started</p>
                          <p className="font-medium">
                            {selectedCall.started_at ? format(new Date(selectedCall.started_at), 'PPpp') : '-'}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className={premiumModalCard}>
                        <CardContent className="p-4">
                          <p className="text-sm text-muted-foreground">Ended</p>
                          <p className="font-medium">
                            {selectedCall.ended_at ? format(new Date(selectedCall.ended_at), 'PPpp') : '-'}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {selectedCall.summary && (
                    <Card className={cn(premiumModalCard, "max-w-full overflow-hidden")}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="w-4 h-4 flex-shrink-0" />
                          Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm break-words [overflow-wrap:anywhere]">{selectedCall.summary}</p>
                      </CardContent>
                    </Card>
                  )}

                  {(selectedCall.recording_url || selectedCall.vapi_call_id) && (
                    <CallRecordingPlayer
                      ref={recordingPlayerRef}
                      key={selectedCall.id}
                      recordingUrl={selectedCall.recording_url}
                      duration={selectedCall.duration_seconds}
                      callLogId={selectedCall.id}
                    />
                  )}
                </TabsContent>

                {/* Squad Tab - Only shown for squad calls */}
                {selectedCall.is_squad_call && (
                  <TabsContent value="squad" className="space-y-4 p-1 sm:p-2 overflow-hidden">
                    {/* Call Intent */}
                    {selectedCall.call_intent && (
                      <Card className={premiumModalCard}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Target className="w-4 h-4" />
                            Call Intent
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Badge variant="secondary" className={callLogBadgeTone('neutral', 'text-sm capitalize')}>
                            {selectedCall.call_intent.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                          </Badge>
                        </CardContent>
                      </Card>
                    )}

                    {/* Assistants Involved */}
                    <Card className={premiumModalCard}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          Assistants Involved ({selectedCall.assistants_involved?.length || 0})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {selectedCall.assistants_involved && selectedCall.assistants_involved.length > 0 ? (
                          <div className="space-y-2">
                            {selectedCall.assistants_involved.map((assistant, i) => (
                              <div key={i} className="flex items-center justify-between rounded-2xl border border-border dark:border-white/10 bg-background/35 dark:bg-black/35 p-3 shadow-inner shadow-sm dark:shadow-black/20">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                                    <span className="text-accent font-medium text-sm">{i + 1}</span>
                                  </div>
                                  <div>
                                    <p className="font-medium">{assistant.name || 'Unknown Assistant'}</p>
                                    <p className="text-xs text-muted-foreground font-mono">{assistant.id}</p>
                                  </div>
                                </div>
                                {assistant.handoffTimestamp && (
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(assistant.handoffTimestamp), 'h:mm:ss a')}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">No assistant data available</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Handoff Sequence */}
                    <Card className={premiumModalCard}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <GitBranch className="w-4 h-4" />
                          Handoff Sequence
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {selectedCall.handoff_sequence && selectedCall.handoff_sequence.length > 0 ? (
                          <div className="space-y-3">
                            {selectedCall.handoff_sequence.map((handoff, i) => {
                              const fromAssistant = selectedCall.assistants_involved?.find(a => a.id === handoff.fromAssistant);
                              const toAssistant = selectedCall.assistants_involved?.find(a => a.id === handoff.toAssistant);
                              return (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <Badge variant="outline" className={callLogBadgeTone('neutral', 'font-normal')}>
                                    {fromAssistant?.name || handoff.fromAssistant.slice(0, 8)}
                                  </Badge>
                                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                                  <Badge variant="outline" className={callLogBadgeTone('neutral', 'font-normal')}>
                                    {toAssistant?.name || handoff.toAssistant.slice(0, 8)}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground ml-auto">
                                    {format(new Date(handoff.timestamp), 'h:mm:ss a')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">No handoffs recorded</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Structured Data from Each Assistant */}
                    {selectedCall.structured_data_multi && selectedCall.structured_data_multi.length > 0 && (
                      <Card className={premiumModalCard}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Collected Data
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {selectedCall.structured_data_multi.map((item, i) => {
                              const assistant = selectedCall.assistants_involved?.find(a => a.id === item.assistant);
                              return (
                                <div key={i} className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={callLogBadgeTone('neutral')}>
                                      {assistant?.name || item.assistant.slice(0, 8)}
                                    </Badge>
                                  </div>
                                  <pre className="overflow-auto rounded-2xl border border-border dark:border-white/10 bg-background/45 dark:bg-black/45 p-3 font-mono text-xs text-foreground dark:text-foreground">
                                    {JSON.stringify(item.data, null, 2)}
                                  </pre>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>
                )}

                <TabsContent value="transcript" className="p-1 sm:p-2 overflow-hidden">
                  <CallTranscriptChat
                    artifactMessages={selectedCall.artifact_messages as any[]}
                    plainTranscript={selectedCall.transcript}
                  />
                </TabsContent>

                <TabsContent value="tool-calls" className="p-1 sm:p-2 overflow-hidden">
                  <CallToolCalls artifactMessages={selectedCall.artifact_messages as any[]} />
                </TabsContent>

                <TabsContent value="analysis" className="p-1 sm:p-2 overflow-hidden">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Call Quality Score */}
                  <Card className={premiumModalCard}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Call Quality Score</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CallQualityScore
                        sentiment={selectedCall.sentiment}
                        durationSeconds={selectedCall.duration_seconds}
                        outcome={selectedCall.call_outcome}
                        cost={selectedCall.cost}
                        hasTranscript={!!selectedCall.transcript}
                      />
                    </CardContent>
                  </Card>

                  <Card className={premiumModalCard}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Sentiment</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {getSentimentBadge(selectedCall.sentiment) || <span className="text-muted-foreground">Not analyzed</span>}
                    </CardContent>
                  </Card>

                  <Card className={premiumModalCard}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Key Topics
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedCall.key_topics?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {selectedCall.key_topics.map((topic, i) => (
                            <Badge key={i} variant="secondary" className={callLogBadgeTone('tag')}>{topic}</Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground">No topics identified</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={premiumModalCard}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        Action Items
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {selectedCall.action_items?.length ? (
                        <ul className="list-disc list-inside space-y-1">
                          {selectedCall.action_items.map((item, i) => (
                            <li key={i} className="text-sm">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground">No action items identified</p>
                      )}
                    </CardContent>
                  </Card>
                  </div>
                </TabsContent>

                <TabsContent value="metadata" className="p-1 sm:p-2 overflow-hidden">
                  <Card className={premiumModalCard}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Raw Metadata</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="overflow-auto rounded-2xl border border-border dark:border-white/10 bg-background/45 dark:bg-black/45 p-4 font-mono text-xs text-foreground dark:text-foreground">
                        {JSON.stringify(selectedCall.metadata, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </DashboardThemeFrame>
  );
};

export default CallLogs;
