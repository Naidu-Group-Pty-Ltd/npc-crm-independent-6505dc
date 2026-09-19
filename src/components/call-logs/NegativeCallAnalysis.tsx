import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import { cn } from '@/lib/utils';
import { callLogBadgeBase, callLogBadgeTone } from './badgeStyles';
import { CallStatePanel } from './CallStatePanel';
import { format } from 'date-fns';
import { 
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Clock,
  Phone,
  User,
  MessageSquare,
  Lightbulb,
  TrendingDown,
  ArrowUpRight,
  Filter,
  RefreshCw,
  FileText,
  Target,
  Zap,
  Users,
  ChevronRight,
  X,
  PhoneCall
} from 'lucide-react';
import { CriticalMomentDetection } from './CriticalMomentDetection';
import { AgentPerformanceFlags } from './AgentPerformanceFlags';
import { TrendAlerts } from './TrendAlerts';
import { ComparativeCoaching } from './ComparativeCoaching';

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
  call_outcome: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  sentiment: string | null;
  summary: string | null;
  transcript: string | null;
  key_topics: string[] | null;
  action_items: string[] | null;
  root_cause_category: string | null;
  escalation_severity: number | null;
  resolution_status: string | null;
  resolution_notes: string | null;
  ai_recommendations: string[] | null;
  negative_sentiment_moment: NegativeSentimentMoment | null;
  recovery_priority: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  recording_url: string | null;
}

interface NegativeCallAnalysisProps {
  calls: CallLog[];
  onRefresh: () => void;
}

const ROOT_CAUSE_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  pricing_objection: { label: 'Pricing Objection', icon: TrendingDown, color: 'text-brand-500' },
  service_complaint: { label: 'Service Complaint', icon: AlertCircle, color: 'text-destructive' },
  agent_confusion: { label: 'Agent Confusion', icon: Users, color: 'text-warning' },
  long_hold_time: { label: 'Long Hold Time', icon: Clock, color: 'text-brand-500' },
  unresolved_query: { label: 'Unresolved Query', icon: MessageSquare, color: 'text-accent' },
  technical_issue: { label: 'Technical Issue', icon: Zap, color: 'text-info' },
  miscommunication: { label: 'Miscommunication', icon: Phone, color: 'text-accent' },
  customer_frustration: { label: 'Customer Frustration', icon: AlertTriangle, color: 'text-destructive' },
  wrong_transfer: { label: 'Wrong Transfer', icon: ArrowUpRight, color: 'text-accent' },
  information_gap: { label: 'Information Gap', icon: FileText, color: 'text-info' },
};

const RESOLUTION_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  needs_review: { label: 'Needs Review', color: 'text-brand-400', bgColor: 'bg-brand-500/20' },
  reviewed: { label: 'Reviewed', color: 'text-info', bgColor: 'bg-info/20' },
  resolved: { label: 'Resolved', color: 'text-success', bgColor: 'bg-success/20' },
  escalated: { label: 'Escalated', color: 'text-destructive', bgColor: 'bg-destructive/20' },
};

const getSeverityColor = (severity: number | null) => {
  if (!severity) return 'border-border/30 bg-muted/15 text-muted-foreground dark:text-foreground';
  if (severity <= 2) return 'border-brand-300/30 bg-brand-500/15 text-brand-300';
  if (severity <= 3) return 'border-warning/30 bg-warning/15 text-warning';
  if (severity <= 4) return 'border-destructive/35 bg-destructive/15 text-destructive';
  return 'border-destructive/45 bg-destructive/20 text-destructive';
};

const getSeverityLabel = (severity: number | null) => {
  if (!severity) return 'Unknown';
  if (severity === 1) return 'Minor';
  if (severity === 2) return 'Moderate';
  if (severity === 3) return 'Significant';
  if (severity === 4) return 'Serious';
  return 'Critical';
};

const issuePanel =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card/95 dark:from-background/95 via-card/80 dark:via-background/80 to-background/90 dark:to-black/90 shadow-2xl shadow-sm dark:shadow-black/30';
const issueStatCard =
  'group relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br shadow-lg shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/40 before:to-transparent hover:-translate-y-0.5 hover:border-brand-300/35 hover:shadow-brand-500/10';
const issueControl =
  'rounded-2xl border-border dark:border-white/10 bg-background/45 dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all hover:border-brand-300/35 hover:bg-brand-300/10 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black';
const issueRow =
  'group relative cursor-pointer overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-r from-card/90 dark:from-background/90 via-card/75 dark:via-background/75 to-background/85 dark:to-black/85 p-4 shadow-sm shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full before:bg-gradient-to-b before:from-transparent before:via-brand-300/0 before:to-transparent hover:-translate-y-0.5 hover:border-brand-300/40 hover:bg-brand-400/5 hover:shadow-xl hover:shadow-brand-500/10 hover:before:via-brand-300/90';

export const NegativeCallAnalysis = ({ calls, onRefresh }: NegativeCallAnalysisProps) => {
  const { toast } = useToast();
  const { updateCall } = useSecureCallLogs();
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [newStatus, setNewStatus] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRootCause, setFilterRootCause] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  // Filter to negative/mixed sentiment calls
  const negativeCalls = useMemo(() => {
    return calls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed');
  }, [calls]);

  // Apply filters
  const filteredCalls = useMemo(() => {
    let filtered = [...negativeCalls];
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(c => c.resolution_status === filterStatus);
    }
    if (filterRootCause !== 'all') {
      filtered = filtered.filter(c => c.root_cause_category === filterRootCause);
    }
    if (filterSeverity !== 'all') {
      const severityNum = parseInt(filterSeverity);
      filtered = filtered.filter(c => c.escalation_severity === severityNum);
    }
    
    // Sort by recovery priority (highest first), then by date
    return filtered.sort((a, b) => {
      if ((b.recovery_priority || 0) !== (a.recovery_priority || 0)) {
        return (b.recovery_priority || 0) - (a.recovery_priority || 0);
      }
      return new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime();
    });
  }, [negativeCalls, filterStatus, filterRootCause, filterSeverity]);

  // Calculate stats
  const stats = useMemo(() => {
    const needsReview = negativeCalls.filter(c => c.resolution_status === 'needs_review').length;
    const resolved = negativeCalls.filter(c => c.resolution_status === 'resolved').length;
    const escalated = negativeCalls.filter(c => c.resolution_status === 'escalated').length;
    const highPriority = negativeCalls.filter(c => (c.recovery_priority || 0) >= 4).length;
    
    // Root cause breakdown
    const rootCauseBreakdown: Record<string, number> = {};
    negativeCalls.forEach(c => {
      if (c.root_cause_category) {
        rootCauseBreakdown[c.root_cause_category] = (rootCauseBreakdown[c.root_cause_category] || 0) + 1;
      }
    });
    
    return { needsReview, resolved, escalated, highPriority, rootCauseBreakdown, total: negativeCalls.length };
  }, [negativeCalls]);

  const handleUpdateResolution = async () => {
    if (!selectedCall || !newStatus) return;
    
    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        resolution_status: newStatus,
        resolution_notes: resolutionNotes || null,
        reviewed_at: new Date().toISOString(),
      };
      
      const { error } = await updateCall(selectedCall.id, updateData);
      
      if (error) throw error;
      
      toast({
        title: 'Resolution Updated',
        description: `Call marked as ${RESOLUTION_STATUS_CONFIG[newStatus]?.label || newStatus}`,
      });
      
      setSelectedCall(null);
      setResolutionNotes('');
      setNewStatus('');
      onRefresh();
    } catch (error) {
      console.error('Error updating resolution:', error);
      toast({
        title: 'Error',
        description: 'Failed to update resolution status',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const openCallDetail = (call: CallLog) => {
    setSelectedCall(call);
    setResolutionNotes(call.resolution_notes || '');
    setNewStatus(call.resolution_status || 'needs_review');
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Recovery Queue - high priority calls needing follow-up
  const recoveryQueue = useMemo(() => {
    return negativeCalls
      .filter(c => c.resolution_status !== 'resolved' && (c.recovery_priority || 0) >= 3)
      .sort((a, b) => (b.recovery_priority || 0) - (a.recovery_priority || 0))
      .slice(0, 10);
  }, [negativeCalls]);

  return (
    <div className="space-y-6">
      <Card className={issuePanel}>
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-destructive/10 blur-3xl" />
        <CardHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.92),rgba(0,0,0,0.72),rgba(127,29,29,0.16))]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
                <AlertTriangle className="h-3 w-3" />
                Exception Management
              </div>
              <CardTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive shadow-inner shadow-destructive/40">
                  <AlertCircle className="h-5 w-5" />
                </span>
                Call Quality Issues
              </CardTitle>
              <CardDescription className="mt-2 text-muted-foreground dark:text-muted-foreground">
                Prioritize negative or mixed-sentiment calls, recovery queues, root causes, and coaching signals.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} className={cn(issueControl, 'gap-2')}>
              <RefreshCw className="h-4 w-4" />
              Refresh issues
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className={cn(issueStatCard, 'from-card/95 dark:from-background/95 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95')}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl border border-border/20 bg-muted/40 p-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground dark:text-foreground" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Total Issues</span>
            </div>
            <p className="text-2xl font-bold text-foreground dark:text-foreground">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className={cn(issueStatCard, 'from-brand-500/15 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95')}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl border border-brand-300/25 bg-brand-500/10 p-2">
                <Clock className="h-4 w-4 text-brand-300" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Needs Review</span>
            </div>
            <p className="text-2xl font-bold text-brand-300">{stats.needsReview}</p>
          </CardContent>
        </Card>
        <Card className={cn(issueStatCard, 'from-destructive/15 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95 hover:border-destructive/40 hover:shadow-destructive/10')}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-2">
                <ArrowUpRight className="h-4 w-4 text-destructive" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Escalated</span>
            </div>
            <p className="text-2xl font-bold text-destructive">{stats.escalated}</p>
          </CardContent>
        </Card>
        <Card className={cn(issueStatCard, 'from-success/15 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95 hover:border-success/40 hover:shadow-success/10')}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl border border-success/25 bg-success/10 p-2">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Resolved</span>
            </div>
            <p className="text-2xl font-bold text-success">{stats.resolved}</p>
          </CardContent>
        </Card>
        <Card className={cn(issueStatCard, 'from-accent/15 via-card/85 dark:via-background/85 to-background/95 dark:to-black/95 hover:border-accent/40 hover:shadow-accent/10')}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-xl border border-accent/25 bg-accent/10 p-2">
                <Target className="h-4 w-4 text-accent" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">High Priority</span>
            </div>
            <p className="text-2xl font-bold text-accent">{stats.highPriority}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="issues" className="w-full">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-color:rgba(251,191,36,0.45)_rgba(0,0,0,0.25)] [scrollbar-width:thin] md:mx-0 md:px-0">
          <TabsList className="inline-flex h-auto w-auto min-w-max gap-1.5 rounded-[1.35rem] border border-border dark:border-white/10 bg-background/45 dark:bg-black/45 p-1.5 shadow-2xl shadow-sm dark:shadow-black/30 backdrop-blur-xl">
            <TabsTrigger value="issues" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <AlertCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">All</span> Issues
            </TabsTrigger>
            <TabsTrigger value="critical-moments" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <Zap className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Critical</span> Moments
            </TabsTrigger>
            <TabsTrigger value="recovery" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <PhoneCall className="w-3.5 h-3.5 md:w-4 md:h-4" />
              Recovery
              {recoveryQueue.length > 0 && (
                <Badge variant="secondary" className={callLogBadgeTone('danger', 'ml-1 h-5 px-1.5')}>
                  {recoveryQueue.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="agents" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <Users className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Agent</span> Flags
            </TabsTrigger>
            <TabsTrigger value="trends" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <TrendingDown className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Trend</span> Alerts
            </TabsTrigger>
            <TabsTrigger value="coaching" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <Lightbulb className="w-3.5 h-3.5 md:w-4 md:h-4" />
              Coaching
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="flex min-h-10 items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground dark:text-muted-foreground transition-all hover:bg-brand-300/10 hover:text-brand-100 data-[state=active]:bg-brand-400/20 data-[state=active]:text-brand-50 md:text-sm">
              <Target className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Root Cause</span> Breakdown
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="issues" className="mt-4">
          {/* Filters */}
          <Card className={cn(issuePanel, 'mb-4')}>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-3 items-center">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className={cn('w-[160px]', issueControl)}>
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterRootCause} onValueChange={setFilterRootCause}>
                  <SelectTrigger className={cn('w-[180px]', issueControl)}>
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Root Cause" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Root Causes</SelectItem>
                    {Object.entries(ROOT_CAUSE_LABELS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger className={cn('w-[150px]', issueControl)}>
                    <Target className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="5">5 - Critical</SelectItem>
                    <SelectItem value="4">4 - Serious</SelectItem>
                    <SelectItem value="3">3 - Significant</SelectItem>
                    <SelectItem value="2">2 - Moderate</SelectItem>
                    <SelectItem value="1">1 - Minor</SelectItem>
                  </SelectContent>
                </Select>
                {(filterStatus !== 'all' || filterRootCause !== 'all' || filterSeverity !== 'all') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-muted-foreground dark:text-foreground hover:bg-brand-300/10 hover:text-brand-100"
                    onClick={() => {
                      setFilterStatus('all');
                      setFilterRootCause('all');
                      setFilterSeverity('all');
                    }}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
                <div className="ml-auto rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-3 py-1 text-sm font-medium text-muted-foreground dark:text-foreground">
                  {filteredCalls.length} {filteredCalls.length === 1 ? 'call' : 'calls'}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Call List */}
          <Card className={issuePanel}>
            <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-destructive/10 via-transparent to-brand-500/10 pb-4">
              <CardTitle className="flex items-center gap-2 text-foreground dark:text-foreground">
                <AlertCircle className="w-5 h-5 text-brand-300" />
                Negative Sentiment Calls
              </CardTitle>
              <CardDescription className="text-muted-foreground dark:text-muted-foreground">
                Calls requiring attention based on AI analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <ScrollArea className="h-[500px] pr-3 [scrollbar-color:rgba(251,191,36,0.45)_rgba(0,0,0,0.35)] [scrollbar-width:thin]">
                <div className="space-y-3">
                  {filteredCalls.length === 0 ? (
                    <CallStatePanel
                      tone="emerald"
                      icon={<CheckCircle className="h-8 w-8" />}
                      title="No negative calls found"
                      description="All matching calls are clear of negative sentiment or escalation indicators."
                    />
                  ) : (
                    filteredCalls.map(call => (
                      <div
                        key={call.id}
                        className={issueRow}
                        onClick={() => openCallDetail(call)}
                      >
                        <div className="relative z-10 flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="truncate text-base font-semibold text-foreground dark:text-foreground">
                                {call.customer_name || call.phone_number || 'Unknown Caller'}
                              </span>
                              {call.escalation_severity && (
                                <Badge className={cn(callLogBadgeBase, getSeverityColor(call.escalation_severity))}>
                                  {getSeverityLabel(call.escalation_severity)}
                                </Badge>
                              )}
                              {call.recovery_priority && call.recovery_priority >= 4 && (
                                <Badge variant="outline" className={callLogBadgeTone('danger')}>
                                  High Priority
                                </Badge>
                              )}
                            </div>
                            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
                              <span className="rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-2.5 py-1">{call.agent_name || 'Unknown Agent'}</span>
                              <span className="rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-2.5 py-1">{call.started_at ? format(new Date(call.started_at), 'MMM d, h:mm a') : '-'}</span>
                              <span className="rounded-full border border-border/15 bg-muted/40 px-2.5 py-1 font-mono text-xs text-foreground dark:text-foreground">{formatDuration(call.duration_seconds)}</span>
                            </div>
                            {call.root_cause_category && ROOT_CAUSE_LABELS[call.root_cause_category] && (
                              <div className="mb-2 flex items-center gap-1.5 rounded-full border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 px-2.5 py-1 w-fit">
                                {(() => {
                                  const config = ROOT_CAUSE_LABELS[call.root_cause_category];
                                  const Icon = config.icon;
                                  return (
                                    <>
                                      <Icon className={`w-4 h-4 ${config.color}`} />
                                      <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            {call.summary && (
                              <p className="line-clamp-2 rounded-2xl border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 p-3 text-sm text-muted-foreground dark:text-muted-foreground">{call.summary}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {call.resolution_status && RESOLUTION_STATUS_CONFIG[call.resolution_status] && (
                              <Badge className={cn(callLogBadgeBase, RESOLUTION_STATUS_CONFIG[call.resolution_status].bgColor, RESOLUTION_STATUS_CONFIG[call.resolution_status].color, 'border-border dark:border-white/10')}>
                                {RESOLUTION_STATUS_CONFIG[call.resolution_status].label}
                              </Badge>
                            )}
                            <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-brand-200" />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recovery" className="mt-4">
          <Card className={issuePanel}>
            <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-destructive/10">
              <CardTitle className="flex items-center gap-2 text-foreground dark:text-foreground">
                <PhoneCall className="w-5 h-5 text-brand-300" />
                Customer Recovery Queue
              </CardTitle>
              <CardDescription className="text-muted-foreground dark:text-muted-foreground">
                Prioritized list of customers needing follow-up based on urgency and issue severity
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              {recoveryQueue.length === 0 ? (
                <CallStatePanel
                  tone="emerald"
                  icon={<CheckCircle className="h-8 w-8" />}
                  title="Recovery queue is empty"
                  description="No high-priority customers need immediate follow-up right now."
                />
              ) : (
                <div className="space-y-3">
                  {recoveryQueue.map((call, index) => (
                    <div
                      key={call.id}
                      className={issueRow}
                      onClick={() => openCallDetail(call)}
                    >
                      <div className="relative z-10 flex items-center gap-4">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-300/10 font-bold text-brand-200 shadow-inner shadow-brand-950/30">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="truncate font-semibold text-foreground dark:text-foreground">
                              {call.customer_name || call.phone_number || 'Unknown'}
                            </span>
                            <Badge className={cn(callLogBadgeBase, getSeverityColor(call.escalation_severity))}>
                              Priority {call.recovery_priority}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground dark:text-muted-foreground">
                            {call.root_cause_category && ROOT_CAUSE_LABELS[call.root_cause_category]?.label}
                            {' • '}
                            {call.started_at ? format(new Date(call.started_at), 'MMM d, h:mm a') : '-'}
                          </div>
                        </div>
                        {call.ai_recommendations && call.ai_recommendations.length > 0 && (
                          <div className="hidden md:block max-w-xs">
                            <div className="mb-1 flex items-center gap-1 text-xs text-brand-200">
                              <Lightbulb className="w-3 h-3" />
                              Recommendation
                            </div>
                            <p className="line-clamp-1 text-sm text-muted-foreground dark:text-foreground">{call.ai_recommendations[0]}</p>
                          </div>
                        )}
                        <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-brand-200" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Critical Moment Detection Tab */}
        <TabsContent value="critical-moments" className="mt-4">
          <CriticalMomentDetection calls={calls} />
        </TabsContent>

        {/* Agent Performance Flags Tab */}
        <TabsContent value="agents" className="mt-4">
          <AgentPerformanceFlags calls={calls} />
        </TabsContent>

        {/* Trend Alerts Tab */}
        <TabsContent value="trends" className="mt-4">
          <TrendAlerts calls={calls} />
        </TabsContent>

        {/* Comparative Coaching Tab */}
        <TabsContent value="coaching" className="mt-4">
          <ComparativeCoaching calls={calls} />
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          <Card className={issuePanel}>
            <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-accent/10 via-transparent to-brand-500/10">
              <CardTitle className="flex items-center gap-2 text-foreground dark:text-foreground">
                <TrendingDown className="w-5 h-5 text-accent" />
                Root Cause Breakdown
              </CardTitle>
              <CardDescription className="text-muted-foreground dark:text-muted-foreground">
                Distribution of issues by root cause category
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              {Object.keys(stats.rootCauseBreakdown).length === 0 ? (
                <CallStatePanel
                  tone="neutral"
                  icon={<FileText className="h-8 w-8" />}
                  title="No root causes identified"
                  description="Root causes will appear as calls are analyzed and categorized."
                />
              ) : (
                <div className="space-y-4">
                  {Object.entries(stats.rootCauseBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cause, count]) => {
                      const config = ROOT_CAUSE_LABELS[cause];
                      const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;
                      const Icon = config?.icon || AlertCircle;
                      
                      return (
                        <div key={cause} className="space-y-2 rounded-3xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${config?.color || 'text-muted-foreground'}`} />
                              <span className="font-medium text-foreground dark:text-foreground">{config?.label || cause}</span>
                            </div>
                            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                              {count} ({percentage.toFixed(0)}%)
                            </span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Call Detail Dialog */}
      <Dialog open={!!selectedCall} onOpenChange={(open) => !open && setSelectedCall(null)}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-hidden border-border bg-background/95 shadow-2xl shadow-brand-950/20 backdrop-blur-xl sm:w-auto sm:max-h-[90vh] sm:overflow-hidden dark:border-white/10 dark:bg-background/95">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground dark:text-foreground">
              <AlertTriangle className="w-5 h-5 text-brand-300" />
              Call Analysis
            </DialogTitle>
          </DialogHeader>
          
          {selectedCall && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:hsl(var(--brand-300)/0.4)_transparent] [scrollbar-width:thin]">
              <div className="space-y-6 pb-2">
              {/* Call Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                  <label className="text-xs text-muted-foreground dark:text-muted-foreground">Customer</label>
                  <p className="font-medium text-foreground dark:text-foreground">{selectedCall.customer_name || selectedCall.phone_number || 'Unknown'}</p>
                </div>
                <div className="rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                  <label className="text-xs text-muted-foreground dark:text-muted-foreground">Agent</label>
                  <p className="font-medium text-foreground dark:text-foreground">{selectedCall.agent_name || 'Unknown'}</p>
                </div>
                <div className="rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                  <label className="text-xs text-muted-foreground dark:text-muted-foreground">Date & Time</label>
                  <p className="font-medium text-foreground dark:text-foreground">
                    {selectedCall.started_at ? format(new Date(selectedCall.started_at), 'MMM d, yyyy h:mm a') : '-'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                  <label className="text-xs text-muted-foreground dark:text-muted-foreground">Duration</label>
                  <p className="font-medium text-foreground dark:text-foreground">{formatDuration(selectedCall.duration_seconds)}</p>
                </div>
              </div>

              {/* Severity & Root Cause */}
              <div className="flex flex-wrap gap-3">
                {selectedCall.escalation_severity && (
                  <Badge className={cn(callLogBadgeBase, getSeverityColor(selectedCall.escalation_severity))}>
                    Severity: {selectedCall.escalation_severity}/5 - {getSeverityLabel(selectedCall.escalation_severity)}
                  </Badge>
                )}
                {selectedCall.recovery_priority && (
                  <Badge variant="outline" className={callLogBadgeTone('danger')}>
                    Recovery Priority: {selectedCall.recovery_priority}/5
                  </Badge>
                )}
                {selectedCall.root_cause_category && ROOT_CAUSE_LABELS[selectedCall.root_cause_category] && (
                  <Badge variant="secondary" className={callLogBadgeTone('neutral', 'gap-1')}>
                    {(() => {
                      const config = ROOT_CAUSE_LABELS[selectedCall.root_cause_category!];
                      const Icon = config.icon;
                      return (
                        <>
                          <Icon className="w-3 h-3" />
                          {config.label}
                        </>
                      );
                    })()}
                  </Badge>
                )}
              </div>

              {/* Negative Moment */}
              {selectedCall.negative_sentiment_moment && (
                <div className="rounded-3xl border border-destructive/25 bg-destructive/10 p-4 shadow-inner shadow-destructive/20">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-destructive" />
                    <span className="font-medium text-destructive">Critical Moment</span>
                  </div>
                  {selectedCall.negative_sentiment_moment.triggerPhrase && (
                    <p className="text-sm mb-2">
                      <span className="text-muted-foreground dark:text-muted-foreground">Trigger: </span>
                      <span className="italic">"{selectedCall.negative_sentiment_moment.triggerPhrase}"</span>
                    </p>
                  )}
                  {selectedCall.negative_sentiment_moment.transcriptSegment && (
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                      "{selectedCall.negative_sentiment_moment.transcriptSegment}"
                    </p>
                  )}
                </div>
              )}

              {/* AI Recommendations */}
              {selectedCall.ai_recommendations && selectedCall.ai_recommendations.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-4 h-4 text-brand-300" />
                    <span className="font-medium text-foreground dark:text-foreground">AI Recommendations</span>
                  </div>
                  <div className="space-y-2">
                    {selectedCall.ai_recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-2 rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3">
                        <span className="font-medium text-brand-200">{idx + 1}.</span>
                        <span className="text-sm text-muted-foreground dark:text-foreground">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              {selectedCall.summary && (
                <div>
                  <label className="text-xs text-muted-foreground dark:text-muted-foreground mb-1 block">Summary</label>
                  <p className="rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-3 text-sm text-muted-foreground dark:text-foreground">{selectedCall.summary}</p>
                </div>
              )}

              {/* Resolution Status */}
              <div className="space-y-4 border-t border-border dark:border-white/10 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <span className="font-medium text-foreground dark:text-foreground">Resolution Status</span>
                </div>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className={issueControl}>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="needs_review">Needs Review</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Add resolution notes..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={3}
                  className="rounded-2xl border-border dark:border-white/10 bg-background/35 dark:bg-black/35 text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:ring-brand-300"
                />
              </div>
              </div>
            </div>
          )}


          <DialogFooter>
            <Button variant="outline" className={issueControl} onClick={() => setSelectedCall(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateResolution} disabled={saving || !newStatus} className="rounded-full bg-gradient-to-r from-brand-300 to-brand-500 text-brand-950 shadow-lg shadow-brand-500/20 hover:from-brand-200 hover:to-brand-400">
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Resolution'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
