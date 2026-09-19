import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Users, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Award,
  Target,
  AlertCircle,
  CheckCircle,
  XCircle,
  HelpCircle
} from 'lucide-react';

interface CallLog {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  sentiment: string | null;
  call_outcome: string | null;
  root_cause_category: string | null;
  escalation_severity: number | null;
  duration_seconds: number | null;
  started_at: string | null;
}

interface AgentPerformanceFlagsProps {
  calls: CallLog[];
}

interface AgentMetrics {
  agentId: string;
  agentName: string;
  totalCalls: number;
  negativeCalls: number;
  negativeRate: number;
  avgSeverity: number;
  topIssues: { category: string; count: number }[];
  successRate: number;
  avgDuration: number;
  trend: 'improving' | 'declining' | 'stable';
  flags: string[];
}

const FLAG_THRESHOLDS = {
  HIGH_NEGATIVE_RATE: 20, // More than 20% negative calls
  HIGH_AVG_SEVERITY: 3.5, // Average severity above 3.5
  LOW_SUCCESS_RATE: 60, // Success rate below 60%
  RECURRING_ISSUE: 3, // Same issue 3+ times
};

export const AgentPerformanceFlags = ({ calls }: AgentPerformanceFlagsProps) => {
  const agentMetrics = useMemo(() => {
    const agentMap = new Map<string, CallLog[]>();
    
    // Group calls by agent
    calls.forEach(call => {
      if (call.agent_id && call.agent_name) {
        const existing = agentMap.get(call.agent_id) || [];
        existing.push(call);
        agentMap.set(call.agent_id, existing);
      }
    });

    // Calculate metrics for each agent
    const metrics: AgentMetrics[] = [];
    
    agentMap.forEach((agentCalls, agentId) => {
      const agentName = agentCalls[0]?.agent_name || agentId;
      const totalCalls = agentCalls.length;
      const negativeCalls = agentCalls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length;
      const negativeRate = totalCalls > 0 ? (negativeCalls / totalCalls) * 100 : 0;
      
      const callsWithSeverity = agentCalls.filter(c => c.escalation_severity);
      const avgSeverity = callsWithSeverity.length > 0 
        ? callsWithSeverity.reduce((sum, c) => sum + (c.escalation_severity || 0), 0) / callsWithSeverity.length 
        : 0;
      
      const completedCalls = agentCalls.filter(c => c.call_outcome === 'completed').length;
      const successRate = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
      
      const callsWithDuration = agentCalls.filter(c => c.duration_seconds);
      const avgDuration = callsWithDuration.length > 0
        ? callsWithDuration.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / callsWithDuration.length
        : 0;
      
      // Calculate top issues
      const issueCount: Record<string, number> = {};
      agentCalls.forEach(c => {
        if (c.root_cause_category) {
          issueCount[c.root_cause_category] = (issueCount[c.root_cause_category] || 0) + 1;
        }
      });
      const topIssues = Object.entries(issueCount)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      
      // Calculate trend (compare recent calls vs older calls)
      const sortedCalls = [...agentCalls].sort((a, b) => 
        new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()
      );
      const recentHalf = sortedCalls.slice(0, Math.ceil(sortedCalls.length / 2));
      const olderHalf = sortedCalls.slice(Math.ceil(sortedCalls.length / 2));
      
      const recentNegRate = recentHalf.length > 0 
        ? recentHalf.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length / recentHalf.length 
        : 0;
      const olderNegRate = olderHalf.length > 0 
        ? olderHalf.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length / olderHalf.length 
        : 0;
      
      let trend: 'improving' | 'declining' | 'stable' = 'stable';
      if (recentNegRate < olderNegRate - 0.05) trend = 'improving';
      else if (recentNegRate > olderNegRate + 0.05) trend = 'declining';
      
      // Generate flags
      const flags: string[] = [];
      if (negativeRate > FLAG_THRESHOLDS.HIGH_NEGATIVE_RATE) {
        flags.push('High negative call rate');
      }
      if (avgSeverity > FLAG_THRESHOLDS.HIGH_AVG_SEVERITY) {
        flags.push('High average severity');
      }
      if (successRate < FLAG_THRESHOLDS.LOW_SUCCESS_RATE) {
        flags.push('Low success rate');
      }
      topIssues.forEach(issue => {
        if (issue.count >= FLAG_THRESHOLDS.RECURRING_ISSUE) {
          flags.push(`Recurring: ${formatIssue(issue.category)}`);
        }
      });
      
      metrics.push({
        agentId,
        agentName,
        totalCalls,
        negativeCalls,
        negativeRate,
        avgSeverity,
        topIssues,
        successRate,
        avgDuration,
        trend,
        flags,
      });
    });

    // Sort by flags count (most flagged first), then by negative rate
    return metrics.sort((a, b) => {
      if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
      return b.negativeRate - a.negativeRate;
    });
  }, [calls]);

  const summaryStats = useMemo(() => {
    const flaggedAgents = agentMetrics.filter(a => a.flags.length > 0).length;
    const decliningAgents = agentMetrics.filter(a => a.trend === 'declining').length;
    const improvingAgents = agentMetrics.filter(a => a.trend === 'improving').length;
    return { flaggedAgents, decliningAgents, improvingAgents, totalAgents: agentMetrics.length };
  }, [agentMetrics]);

  if (agentMetrics.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No Agent Data Available</p>
            <p className="text-sm text-muted-foreground">Agent performance metrics will appear here as calls are processed.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-card to-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-muted">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Total Agents</span>
            </div>
            <p className="text-xl font-bold">{summaryStats.totalAgents}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-brand-500/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-brand-500/10">
                <AlertTriangle className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <span className="text-xs text-muted-foreground">Flagged</span>
            </div>
            <p className="text-xl font-bold text-brand-500">{summaryStats.flaggedAgents}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-destructive/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-destructive/10">
                <TrendingDown className="w-3.5 h-3.5 text-destructive" />
              </div>
              <span className="text-xs text-muted-foreground">Declining</span>
            </div>
            <p className="text-xl font-bold text-destructive">{summaryStats.decliningAgents}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-success/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-success/10">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
              </div>
              <span className="text-xs text-muted-foreground">Improving</span>
            </div>
            <p className="text-xl font-bold text-success">{summaryStats.improvingAgents}</p>
          </CardContent>
        </Card>
      </div>

      {/* Agent Performance Cards */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Agent Performance Flags
          </CardTitle>
          <CardDescription>
            Identify agents that may need coaching or support based on call patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-4">
              {agentMetrics.map(agent => (
                <div
                  key={agent.agentId}
                  className={`p-4 rounded-lg border ${agent.flags.length > 0 ? 'border-brand-500/30 bg-brand-500/5' : 'bg-card'}`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-muted">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-medium">{agent.agentName}</h4>
                        <p className="text-sm text-muted-foreground">{agent.totalCalls} calls</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.trend === 'improving' && (
                        <Badge className="bg-success/20 text-success border-success/30">
                          <TrendingUp className="w-3 h-3 mr-1" /> Improving
                        </Badge>
                      )}
                      {agent.trend === 'declining' && (
                        <Badge className="bg-destructive/20 text-destructive border-destructive/30">
                          <TrendingDown className="w-3 h-3 mr-1" /> Declining
                        </Badge>
                      )}
                      {agent.flags.length === 0 && (
                        <Badge className="bg-success/20 text-success border-success/30">
                          <Award className="w-3 h-3 mr-1" /> Good Standing
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="p-2 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                              <AlertCircle className="w-3 h-3" />
                              Negative Rate
                            </div>
                            <p className={`font-semibold ${agent.negativeRate > 20 ? 'text-destructive' : ''}`}>
                              {agent.negativeRate.toFixed(1)}%
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{agent.negativeCalls} negative calls out of {agent.totalCalls}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Target className="w-3 h-3" />
                        Avg Severity
                      </div>
                      <p className={`font-semibold ${agent.avgSeverity > 3.5 ? 'text-brand-500' : ''}`}>
                        {agent.avgSeverity > 0 ? agent.avgSeverity.toFixed(1) : '-'}
                      </p>
                    </div>

                    <div className="p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <CheckCircle className="w-3 h-3" />
                        Success Rate
                      </div>
                      <p className={`font-semibold ${agent.successRate < 60 ? 'text-destructive' : 'text-success'}`}>
                        {agent.successRate.toFixed(0)}%
                      </p>
                    </div>

                    <div className="p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <HelpCircle className="w-3 h-3" />
                        Avg Duration
                      </div>
                      <p className="font-semibold">
                        {formatDuration(agent.avgDuration)}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar for negative rate */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Negative Call Rate</span>
                      <span>{agent.negativeRate.toFixed(1)}%</span>
                    </div>
                    <Progress 
                      value={Math.min(agent.negativeRate, 100)} 
                      className="h-2"
                    />
                  </div>

                  {/* Top Issues */}
                  {agent.topIssues.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-2">Top Issues:</p>
                      <div className="flex flex-wrap gap-2">
                        {agent.topIssues.map(issue => (
                          <Badge key={issue.category} variant="outline" className="text-xs">
                            {formatIssue(issue.category)} ({issue.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Flags */}
                  {agent.flags.length > 0 && (
                    <div className="pt-3 border-t">
                      <p className="text-xs font-medium text-brand-500 mb-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Performance Flags:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {agent.flags.map((flag, i) => (
                          <Badge key={i} className="bg-brand-500/20 text-brand-400 border-brand-500/30 text-xs">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

function formatIssue(category: string): string {
  const labels: Record<string, string> = {
    pricing_objection: 'Pricing',
    service_complaint: 'Service',
    agent_confusion: 'Confusion',
    long_hold_time: 'Hold Time',
    unresolved_query: 'Unresolved',
    technical_issue: 'Technical',
    miscommunication: 'Miscomm.',
    customer_frustration: 'Frustration',
    wrong_transfer: 'Wrong Transfer',
    information_gap: 'Info Gap',
  };
  return labels[category] || category;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
