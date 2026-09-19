import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  AlertTriangle,
  Clock,
  MessageSquare,
  Target,
  Zap,
  ChevronRight,
  User,
  Phone,
  AlertCircle,
  TrendingDown,
  Lightbulb,
  Play
} from 'lucide-react';
import { format } from 'date-fns';

interface NegativeSentimentMoment {
  timestamp: number | null;
  transcriptSegment: string;
  triggerPhrase: string;
}

interface CallLog {
  id: string;
  agent_name: string | null;
  phone_number: string | null;
  customer_name: string | null;
  sentiment: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  root_cause_category: string | null;
  escalation_severity: number | null;
  negative_sentiment_moment: NegativeSentimentMoment | null;
  ai_recommendations: string[] | null;
  recording_url: string | null;
}

interface CriticalMomentDetectionProps {
  calls: CallLog[];
}

const ROOT_CAUSE_LABELS: Record<string, { label: string; color: string }> = {
  pricing_objection: { label: 'Pricing Objection', color: 'text-brand-500' },
  service_complaint: { label: 'Service Complaint', color: 'text-destructive' },
  agent_confusion: { label: 'Agent Confusion', color: 'text-warning' },
  long_hold_time: { label: 'Long Hold Time', color: 'text-brand-500' },
  unresolved_query: { label: 'Unresolved Query', color: 'text-accent' },
  technical_issue: { label: 'Technical Issue', color: 'text-info' },
  miscommunication: { label: 'Miscommunication', color: 'text-accent' },
  customer_frustration: { label: 'Customer Frustration', color: 'text-destructive' },
  wrong_transfer: { label: 'Wrong Transfer', color: 'text-accent' },
  information_gap: { label: 'Information Gap', color: 'text-info' },
};

export const CriticalMomentDetection = ({ calls }: CriticalMomentDetectionProps) => {
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);

  // Filter calls with detected critical moments
  const callsWithCriticalMoments = useMemo(() => {
    return calls
      .filter(c => c.negative_sentiment_moment?.triggerPhrase)
      .sort((a, b) => {
        // Sort by severity first, then by date
        if ((b.escalation_severity || 0) !== (a.escalation_severity || 0)) {
          return (b.escalation_severity || 0) - (a.escalation_severity || 0);
        }
        return new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime();
      });
  }, [calls]);

  // Analyze trigger phrase patterns
  const triggerPatterns = useMemo(() => {
    const patterns: Record<string, { count: number; examples: string[]; severity: number[] }> = {};
    
    callsWithCriticalMoments.forEach(call => {
      if (call.root_cause_category) {
        if (!patterns[call.root_cause_category]) {
          patterns[call.root_cause_category] = { count: 0, examples: [], severity: [] };
        }
        patterns[call.root_cause_category].count++;
        if (call.negative_sentiment_moment?.triggerPhrase && patterns[call.root_cause_category].examples.length < 3) {
          patterns[call.root_cause_category].examples.push(call.negative_sentiment_moment.triggerPhrase);
        }
        if (call.escalation_severity) {
          patterns[call.root_cause_category].severity.push(call.escalation_severity);
        }
      }
    });

    return Object.entries(patterns)
      .map(([category, data]) => ({
        category,
        count: data.count,
        examples: data.examples,
        avgSeverity: data.severity.length > 0 
          ? data.severity.reduce((a, b) => a + b, 0) / data.severity.length 
          : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [callsWithCriticalMoments]);

  const stats = useMemo(() => {
    const total = callsWithCriticalMoments.length;
    const critical = callsWithCriticalMoments.filter(c => (c.escalation_severity || 0) >= 4).length;
    const avgSeverity = total > 0
      ? callsWithCriticalMoments.reduce((sum, c) => sum + (c.escalation_severity || 0), 0) / total
      : 0;
    return { total, critical, avgSeverity };
  }, [callsWithCriticalMoments]);

  const getSeverityColor = (severity: number | null) => {
    if (!severity) return 'bg-muted';
    if (severity <= 2) return 'bg-brand-500';
    if (severity <= 3) return 'bg-warning';
    if (severity <= 4) return 'bg-destructive';
    return 'bg-destructive';
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-card to-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-muted">
                <Zap className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Detected Moments</span>
            </div>
            <p className="text-xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-destructive/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-destructive/10">
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
              </div>
              <span className="text-xs text-muted-foreground">Critical (4-5)</span>
            </div>
            <p className="text-xl font-bold text-destructive">{stats.critical}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-brand-500/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-brand-500/10">
                <Target className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <span className="text-xs text-muted-foreground">Avg Severity</span>
            </div>
            <p className="text-xl font-bold text-brand-500">{stats.avgSeverity.toFixed(1)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Trigger Pattern Analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="w-4 h-4" />
            Trigger Pattern Analysis
          </CardTitle>
          <CardDescription className="text-xs">
            Common patterns in phrases that trigger negative sentiment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {triggerPatterns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No patterns detected yet
            </p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {triggerPatterns.slice(0, 6).map(pattern => {
                const config = ROOT_CAUSE_LABELS[pattern.category];
                return (
                  <div key={pattern.category} className="p-3 rounded-lg border bg-card">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-medium ${config?.color || ''}`}>
                        {config?.label || pattern.category}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {pattern.count} calls
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {pattern.examples.slice(0, 2).map((example, i) => (
                        <p key={i} className="text-xs text-muted-foreground italic truncate">
                          "{example}"
                        </p>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Target className="w-3 h-3" />
                        Avg severity: {pattern.avgSeverity.toFixed(1)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Critical Moments Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Critical Moments Timeline
          </CardTitle>
          <CardDescription>
            Pinpointed moments where calls turned negative with exact trigger phrases
          </CardDescription>
        </CardHeader>
        <CardContent>
          {callsWithCriticalMoments.length === 0 ? (
            <div className="text-center py-12">
              <Zap className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No Critical Moments Detected</p>
              <p className="text-sm text-muted-foreground">
                Critical moment detection will appear here as negative calls are analyzed.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {callsWithCriticalMoments.map(call => (
                  <div
                    key={call.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedCall(call)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium truncate">
                            {call.customer_name || call.phone_number || 'Unknown Caller'}
                          </span>
                          {call.escalation_severity && (
                            <Badge className={`${getSeverityColor(call.escalation_severity)} text-foreground dark:text-white text-xs`}>
                              Severity {call.escalation_severity}
                            </Badge>
                          )}
                        </div>

                        {/* Critical Moment Highlight */}
                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                            <span className="text-xs font-medium text-destructive">Trigger Phrase:</span>
                          </div>
                          <p className="text-sm italic">
                            "{call.negative_sentiment_moment?.triggerPhrase}"
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {call.agent_name || 'Unknown Agent'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {call.started_at ? format(new Date(call.started_at), 'MMM d, h:mm a') : '-'}
                          </span>
                          {call.root_cause_category && (
                            <Badge variant="outline" className="text-xs">
                              {ROOT_CAUSE_LABELS[call.root_cause_category]?.label || call.root_cause_category}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Call Detail Dialog */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-hidden sm:w-auto sm:max-h-[90vh] sm:overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-destructive" />
              Critical Moment Analysis
            </DialogTitle>
          </DialogHeader>

          {selectedCall && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
              <div className="space-y-6 pb-2">

              {/* Call Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Customer</p>
                  <p className="font-medium">{selectedCall.customer_name || selectedCall.phone_number || 'Unknown'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Agent</p>
                  <p className="font-medium">{selectedCall.agent_name || 'Unknown'}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Date & Time</p>
                  <p className="font-medium">
                    {selectedCall.started_at ? format(new Date(selectedCall.started_at), 'MMM d, yyyy h:mm a') : '-'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="font-medium">{formatDuration(selectedCall.duration_seconds)}</p>
                </div>
              </div>

              {/* Critical Moment */}
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  <h3 className="font-semibold text-destructive">Critical Moment Detected</h3>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Trigger Phrase:</p>
                    <p className="text-sm font-medium bg-destructive/20 p-2 rounded">
                      "{selectedCall.negative_sentiment_moment?.triggerPhrase}"
                    </p>
                  </div>
                  
                  {selectedCall.negative_sentiment_moment?.transcriptSegment && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Context:</p>
                      <p className="text-sm italic bg-muted p-2 rounded">
                        "{selectedCall.negative_sentiment_moment.transcriptSegment}"
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Root Cause & Severity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground mb-1">Root Cause</p>
                  {selectedCall.root_cause_category ? (
                    <Badge className={ROOT_CAUSE_LABELS[selectedCall.root_cause_category]?.color}>
                      {ROOT_CAUSE_LABELS[selectedCall.root_cause_category]?.label || selectedCall.root_cause_category}
                    </Badge>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not identified</p>
                  )}
                </div>
                <div className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground mb-1">Escalation Severity</p>
                  <Badge className={`${getSeverityColor(selectedCall.escalation_severity)} text-foreground dark:text-white`}>
                    {selectedCall.escalation_severity ? `Level ${selectedCall.escalation_severity}/5` : 'Not rated'}
                  </Badge>
                </div>
              </div>

              {/* AI Recommendations */}
              {selectedCall.ai_recommendations && selectedCall.ai_recommendations.length > 0 && (
                <div className="p-4 rounded-lg bg-brand-500/10 border border-brand-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-5 h-5 text-brand-500" />
                    <h3 className="font-semibold">AI Recommendations</h3>
                  </div>
                  <ul className="space-y-2">
                    {selectedCall.ai_recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <ChevronRight className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recording */}
              {selectedCall.recording_url && (
                <Button variant="outline" className="w-full gap-2" asChild>
                  <a href={selectedCall.recording_url} target="_blank" rel="noopener noreferrer">
                    <Play className="w-4 h-4" />
                    Listen to Recording
                  </a>
                </Button>
              )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


    </div>
  );
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
