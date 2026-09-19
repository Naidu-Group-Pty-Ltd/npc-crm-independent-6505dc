import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  Bell,
  BellOff,
  ArrowUpRight,
  Clock,
  Zap,
  Users,
  Target,
  CheckCircle
} from 'lucide-react';
import { format, subDays, subHours, isAfter } from 'date-fns';

interface CallLog {
  id: string;
  agent_name: string | null;
  sentiment: string | null;
  call_outcome: string | null;
  root_cause_category: string | null;
  escalation_severity: number | null;
  started_at: string | null;
}

interface TrendAlertsProps {
  calls: CallLog[];
}

interface TrendAlert {
  id: string;
  type: 'spike' | 'pattern' | 'threshold' | 'positive';
  severity: 'critical' | 'warning' | 'info' | 'positive';
  title: string;
  description: string;
  metric: string;
  change: number | null;
  timestamp: Date;
  actionable: string;
}

const TREND_THRESHOLDS = {
  NEGATIVE_SPIKE_PERCENT: 50, // 50% increase in negative calls
  HOURLY_NEGATIVE_COUNT: 5, // More than 5 negative calls in an hour
  RECURRING_ISSUE_THRESHOLD: 4, // Same issue type 4+ times in a day
  SEVERITY_AVG_THRESHOLD: 4, // Average severity above 4 in recent calls
  POSITIVE_STREAK: 10, // 10 consecutive positive calls
};

export const TrendAlerts = ({ calls }: TrendAlertsProps) => {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const alerts = useMemo(() => {
    const now = new Date();
    const last24h = subDays(now, 1);
    const last1h = subHours(now, 1);
    const last7d = subDays(now, 7);
    const previous24h = subDays(now, 2);
    
    const recentCalls = calls.filter(c => c.started_at && isAfter(new Date(c.started_at), last24h));
    const lastHourCalls = calls.filter(c => c.started_at && isAfter(new Date(c.started_at), last1h));
    const weekCalls = calls.filter(c => c.started_at && isAfter(new Date(c.started_at), last7d));
    const previousDayCalls = calls.filter(c => 
      c.started_at && 
      isAfter(new Date(c.started_at), previous24h) && 
      !isAfter(new Date(c.started_at), last24h)
    );

    const generatedAlerts: TrendAlert[] = [];

    // 1. Check for negative call spike (comparing today vs yesterday)
    const todayNegative = recentCalls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length;
    const yesterdayNegative = previousDayCalls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length;
    
    if (yesterdayNegative > 0) {
      const percentChange = ((todayNegative - yesterdayNegative) / yesterdayNegative) * 100;
      if (percentChange >= TREND_THRESHOLDS.NEGATIVE_SPIKE_PERCENT) {
        generatedAlerts.push({
          id: 'negative-spike',
          type: 'spike',
          severity: 'critical',
          title: 'Negative Call Spike Detected',
          description: `Negative calls increased by ${percentChange.toFixed(0)}% compared to yesterday`,
          metric: `${todayNegative} negative calls today vs ${yesterdayNegative} yesterday`,
          change: percentChange,
          timestamp: now,
          actionable: 'Review recent negative calls and identify common issues',
        });
      }
    }

    // 2. Check for hourly negative call threshold
    const hourlyNegative = lastHourCalls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length;
    if (hourlyNegative >= TREND_THRESHOLDS.HOURLY_NEGATIVE_COUNT) {
      generatedAlerts.push({
        id: 'hourly-threshold',
        type: 'threshold',
        severity: 'warning',
        title: 'High Negative Calls This Hour',
        description: `${hourlyNegative} negative calls in the last hour`,
        metric: `${hourlyNegative} calls`,
        change: null,
        timestamp: now,
        actionable: 'Consider immediate review of ongoing issues',
      });
    }

    // 3. Check for recurring issue patterns
    const issueCount: Record<string, number> = {};
    recentCalls.forEach(c => {
      if (c.root_cause_category) {
        issueCount[c.root_cause_category] = (issueCount[c.root_cause_category] || 0) + 1;
      }
    });
    
    Object.entries(issueCount).forEach(([category, count]) => {
      if (count >= TREND_THRESHOLDS.RECURRING_ISSUE_THRESHOLD) {
        generatedAlerts.push({
          id: `pattern-${category}`,
          type: 'pattern',
          severity: 'warning',
          title: `Recurring Issue: ${formatIssue(category)}`,
          description: `${count} calls with the same root cause in 24 hours`,
          metric: `${count} occurrences`,
          change: null,
          timestamp: now,
          actionable: `Investigate systemic cause of ${formatIssue(category).toLowerCase()} issues`,
        });
      }
    });

    // 4. Check for high severity average
    const recentWithSeverity = recentCalls.filter(c => c.escalation_severity);
    if (recentWithSeverity.length >= 5) {
      const avgSeverity = recentWithSeverity.reduce((sum, c) => sum + (c.escalation_severity || 0), 0) / recentWithSeverity.length;
      if (avgSeverity >= TREND_THRESHOLDS.SEVERITY_AVG_THRESHOLD) {
        generatedAlerts.push({
          id: 'high-severity',
          type: 'threshold',
          severity: 'critical',
          title: 'High Average Severity',
          description: `Average escalation severity is ${avgSeverity.toFixed(1)} (above threshold of ${TREND_THRESHOLDS.SEVERITY_AVG_THRESHOLD})`,
          metric: `${avgSeverity.toFixed(1)}/5 severity`,
          change: null,
          timestamp: now,
          actionable: 'Prioritize critical escalations and review agent training',
        });
      }
    }

    // 5. Check for positive trends
    const sortedCalls = [...recentCalls].sort((a, b) => 
      new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()
    );
    let positiveStreak = 0;
    for (const call of sortedCalls) {
      if (call.sentiment === 'positive') {
        positiveStreak++;
      } else {
        break;
      }
    }
    if (positiveStreak >= TREND_THRESHOLDS.POSITIVE_STREAK) {
      generatedAlerts.push({
        id: 'positive-streak',
        type: 'positive',
        severity: 'positive',
        title: 'Positive Call Streak!',
        description: `${positiveStreak} consecutive positive sentiment calls`,
        metric: `${positiveStreak} calls`,
        change: null,
        timestamp: now,
        actionable: 'Great performance! Consider sharing best practices',
      });
    }

    // 6. Check week-over-week improvement
    const thisWeekNegativeRate = weekCalls.length > 0 
      ? (weekCalls.filter(c => c.sentiment === 'negative' || c.sentiment === 'mixed').length / weekCalls.length) * 100
      : 0;
    
    const weekTrend = (todayNegative / Math.max(recentCalls.length, 1)) * 100;
    if (thisWeekNegativeRate > 0 && weekTrend < thisWeekNegativeRate - 10) {
      generatedAlerts.push({
        id: 'improving-trend',
        type: 'positive',
        severity: 'positive',
        title: 'Improving Trend',
        description: `Today's negative rate is below the weekly average`,
        metric: `${weekTrend.toFixed(0)}% vs ${thisWeekNegativeRate.toFixed(0)}% weekly`,
        change: weekTrend - thisWeekNegativeRate,
        timestamp: now,
        actionable: 'Keep up the good work!',
      });
    }

    return generatedAlerts.filter(a => !dismissedAlerts.has(a.id));
  }, [calls, dismissedAlerts]);

  const dismissAlert = (alertId: string) => {
    setDismissedAlerts(prev => new Set([...prev, alertId]));
  };

  const getAlertIcon = (alert: TrendAlert) => {
    switch (alert.severity) {
      case 'critical': return <AlertCircle className="w-5 h-5 text-destructive" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-brand-500" />;
      case 'positive': return <CheckCircle className="w-5 h-5 text-success" />;
      default: return <Bell className="w-5 h-5 text-info" />;
    }
  };

  const getAlertBorderColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-destructive/30 bg-destructive/5';
      case 'warning': return 'border-brand-500/30 bg-brand-500/5';
      case 'positive': return 'border-success/30 bg-success/5';
      default: return 'border-info/30 bg-info/5';
    }
  };

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const positiveCount = alerts.filter(a => a.severity === 'positive').length;

  return (
    <div className="space-y-6">
      {/* Alert Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-card to-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-muted">
                <Bell className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Total Alerts</span>
            </div>
            <p className="text-xl font-bold">{alerts.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-destructive/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-destructive/10">
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
              </div>
              <span className="text-xs text-muted-foreground">Critical</span>
            </div>
            <p className="text-xl font-bold text-destructive">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-brand-500/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-brand-500/10">
                <AlertTriangle className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <span className="text-xs text-muted-foreground">Warning</span>
            </div>
            <p className="text-xl font-bold text-brand-500">{warningCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-success/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-success/10">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
              </div>
              <span className="text-xs text-muted-foreground">Positive</span>
            </div>
            <p className="text-xl font-bold text-success">{positiveCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Trend Alerts
          </CardTitle>
          <CardDescription>
            Real-time pattern detection and anomaly alerts based on call data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 mx-auto text-success mb-3" />
              <p className="font-medium">All Clear!</p>
              <p className="text-sm text-muted-foreground">No trend alerts at this time. Everything is running smoothly.</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-lg border ${getAlertBorderColor(alert.severity)}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {getAlertIcon(alert)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium">{alert.title}</h4>
                            {alert.change !== null && (
                              <Badge 
                                variant="outline" 
                                className={alert.change > 0 ? 'text-destructive border-destructive/30' : 'text-success border-success/30'}
                              >
                                {alert.change > 0 ? '+' : ''}{alert.change.toFixed(0)}%
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{alert.description}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Target className="w-3 h-3" />
                              {alert.metric}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {format(alert.timestamp, 'h:mm a')}
                            </span>
                          </div>
                          <div className="mt-3 p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <ArrowUpRight className="w-3 h-3" />
                              <span className="font-medium">Action:</span> {alert.actionable}
                            </p>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => dismissAlert(alert.id)}
                      >
                        <BellOff className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

function formatIssue(category: string): string {
  const labels: Record<string, string> = {
    pricing_objection: 'Pricing Objection',
    service_complaint: 'Service Complaint',
    agent_confusion: 'Agent Confusion',
    long_hold_time: 'Long Hold Time',
    unresolved_query: 'Unresolved Query',
    technical_issue: 'Technical Issue',
    miscommunication: 'Miscommunication',
    customer_frustration: 'Customer Frustration',
    wrong_transfer: 'Wrong Transfer',
    information_gap: 'Information Gap',
  };
  return labels[category] || category;
}
