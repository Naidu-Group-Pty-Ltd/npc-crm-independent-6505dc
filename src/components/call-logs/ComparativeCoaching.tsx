import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Users, 
  TrendingUp, 
  TrendingDown,
  MessageSquare,
  Clock,
  Target,
  Lightbulb,
  ArrowRight,
  CheckCircle,
  XCircle,
  Play,
  BookOpen,
  Award,
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';

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
  summary: string | null;
  transcript: string | null;
  ai_recommendations: string[] | null;
  negative_sentiment_moment: {
    transcriptSegment: string;
    triggerPhrase: string;
  } | null;
}

interface ComparativeCoachingProps {
  calls: CallLog[];
}

interface CallComparison {
  successfulCall: CallLog;
  unsuccessfulCall: CallLog;
  commonTopic: string;
  learningPoints: string[];
}

export const ComparativeCoaching = ({ calls }: ComparativeCoachingProps) => {
  const [selectedComparison, setSelectedComparison] = useState<CallComparison | null>(null);

  // Group calls by success/failure and find comparable pairs
  const comparisons = useMemo(() => {
    const successfulCalls = calls.filter(c => 
      c.sentiment === 'positive' && 
      c.call_outcome === 'completed' &&
      c.transcript
    );
    
    const unsuccessfulCalls = calls.filter(c => 
      (c.sentiment === 'negative' || c.sentiment === 'mixed') &&
      c.root_cause_category &&
      c.transcript
    );

    const pairs: CallComparison[] = [];
    
    // Match by root cause category
    unsuccessfulCalls.forEach(badCall => {
      // Find a successful call that could be comparable
      const goodCall = successfulCalls.find(g => 
        g.agent_name !== badCall.agent_name && // Different agent for learning
        Math.abs((g.duration_seconds || 0) - (badCall.duration_seconds || 0)) < 300 // Similar duration
      );

      if (goodCall && badCall.root_cause_category) {
        pairs.push({
          successfulCall: goodCall,
          unsuccessfulCall: badCall,
          commonTopic: badCall.root_cause_category,
          learningPoints: generateLearningPoints(goodCall, badCall),
        });
      }
    });

    return pairs.slice(0, 10); // Limit to 10 comparisons
  }, [calls]);

  // Calculate coaching stats
  const coachingStats = useMemo(() => {
    const agentIssues: Record<string, { name: string; issues: number; improved: boolean }> = {};
    
    calls.forEach(call => {
      if (call.agent_id && call.agent_name) {
        if (!agentIssues[call.agent_id]) {
          agentIssues[call.agent_id] = { name: call.agent_name, issues: 0, improved: false };
        }
        if (call.sentiment === 'negative' || call.sentiment === 'mixed') {
          agentIssues[call.agent_id].issues++;
        }
      }
    });

    const agentsNeedingCoaching = Object.values(agentIssues).filter(a => a.issues >= 3);
    const topPerformers = Object.values(agentIssues).filter(a => a.issues === 0);

    return {
      comparisonsAvailable: comparisons.length,
      agentsNeedingCoaching: agentsNeedingCoaching.length,
      topPerformers: topPerformers.length,
    };
  }, [calls, comparisons]);

  // Best practices from successful calls
  const bestPractices = useMemo(() => {
    const practices: { practice: string; frequency: number; examples: string[] }[] = [];
    
    const successfulCalls = calls.filter(c => 
      c.sentiment === 'positive' && c.call_outcome === 'completed'
    );

    // Analyze patterns in successful calls
    const patternCounts: Record<string, { count: number; examples: string[] }> = {};
    
    successfulCalls.forEach(call => {
      if (call.duration_seconds && call.duration_seconds > 60 && call.duration_seconds < 300) {
        const key = 'Optimal call duration (1-5 minutes)';
        if (!patternCounts[key]) patternCounts[key] = { count: 0, examples: [] };
        patternCounts[key].count++;
        if (patternCounts[key].examples.length < 3) {
          patternCounts[key].examples.push(call.agent_name || 'Unknown Agent');
        }
      }
    });

    Object.entries(patternCounts).forEach(([practice, data]) => {
      if (data.count >= 3) {
        practices.push({
          practice,
          frequency: data.count,
          examples: data.examples,
        });
      }
    });

    return practices;
  }, [calls]);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-card to-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-muted">
                <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Comparisons</span>
            </div>
            <p className="text-xl font-bold">{coachingStats.comparisonsAvailable}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-brand-500/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-brand-500/10">
                <Users className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <span className="text-xs text-muted-foreground">Need Coaching</span>
            </div>
            <p className="text-xl font-bold text-brand-500">{coachingStats.agentsNeedingCoaching}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-success/5 to-card">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-success/10">
                <Award className="w-3.5 h-3.5 text-success" />
              </div>
              <span className="text-xs text-muted-foreground">Top Performers</span>
            </div>
            <p className="text-xl font-bold text-success">{coachingStats.topPerformers}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="comparisons" className="w-full">
        <TabsList>
          <TabsTrigger value="comparisons" className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Side-by-Side Comparisons
          </TabsTrigger>
          <TabsTrigger value="practices" className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Best Practices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="comparisons" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Call Comparisons
              </CardTitle>
              <CardDescription>
                Compare successful and unsuccessful calls to identify improvement opportunities
              </CardDescription>
            </CardHeader>
            <CardContent>
              {comparisons.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">No Comparisons Available</p>
                  <p className="text-sm text-muted-foreground">
                    More call data is needed to generate meaningful comparisons.
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {comparisons.map((comparison, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedComparison(comparison)}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <Badge variant="outline" className="text-xs">
                            {formatIssue(comparison.commonTopic)}
                          </Badge>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Compare handling approaches</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                          {/* Unsuccessful Call */}
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="w-4 h-4 text-destructive" />
                              <span className="text-sm font-medium">Needs Improvement</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                              Agent: {comparison.unsuccessfulCall.agent_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Duration: {formatDuration(comparison.unsuccessfulCall.duration_seconds)}
                            </p>
                            {comparison.unsuccessfulCall.negative_sentiment_moment && (
                              <div className="mt-2 p-2 rounded bg-muted/50">
                                <p className="text-xs italic">
                                  "{comparison.unsuccessfulCall.negative_sentiment_moment.triggerPhrase}"
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Successful Call */}
                          <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle className="w-4 h-4 text-success" />
                              <span className="text-sm font-medium">Successful Approach</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                              Agent: {comparison.successfulCall.agent_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Duration: {formatDuration(comparison.successfulCall.duration_seconds)}
                            </p>
                            {comparison.successfulCall.summary && (
                              <div className="mt-2 p-2 rounded bg-muted/50">
                                <p className="text-xs line-clamp-2">
                                  {comparison.successfulCall.summary}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Learning Points Preview */}
                        <div className="mt-3 pt-3 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <Lightbulb className="w-3.5 h-3.5 text-brand-500" />
                            <span className="text-xs font-medium">Key Learning Points:</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {comparison.learningPoints.slice(0, 2).map((point, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {point}
                              </Badge>
                            ))}
                            {comparison.learningPoints.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{comparison.learningPoints.length - 2} more
                              </Badge>
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
        </TabsContent>

        <TabsContent value="practices" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5" />
                Best Practices from Top Performers
              </CardTitle>
              <CardDescription>
                Patterns observed in successful calls that can be applied across the team
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bestPractices.length === 0 ? (
                <div className="text-center py-12">
                  <Award className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">Building Best Practices</p>
                  <p className="text-sm text-muted-foreground">
                    More successful calls are needed to identify consistent patterns.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {bestPractices.map((practice, idx) => (
                    <div key={idx} className="p-4 rounded-lg border bg-success/5 border-success/20">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-full bg-success/10">
                          <CheckCircle className="w-4 h-4 text-success" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium mb-1">{practice.practice}</h4>
                          <p className="text-sm text-muted-foreground mb-2">
                            Observed in {practice.frequency} successful calls
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {practice.examples.map((example, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                <Users className="w-3 h-3 mr-1" />
                                {example}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Comparison Detail Dialog */}
      <Dialog open={!!selectedComparison} onOpenChange={() => setSelectedComparison(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Call Comparison: {selectedComparison && formatIssue(selectedComparison.commonTopic)}
            </DialogTitle>
          </DialogHeader>
          
          {selectedComparison && (
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Unsuccessful Call Detail */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-destructive" />
                    <h3 className="font-semibold">Unsuccessful Call</h3>
                  </div>
                  <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4" />
                      <span>Agent: {selectedComparison.unsuccessfulCall.agent_name || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4" />
                      <span>Duration: {formatDuration(selectedComparison.unsuccessfulCall.duration_seconds)}</span>
                    </div>
                    {selectedComparison.unsuccessfulCall.negative_sentiment_moment && (
                      <div className="p-3 rounded bg-muted">
                        <p className="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Critical Moment:
                        </p>
                        <p className="text-sm italic">
                          "{selectedComparison.unsuccessfulCall.negative_sentiment_moment.transcriptSegment}"
                        </p>
                      </div>
                    )}
                    {selectedComparison.unsuccessfulCall.ai_recommendations && (
                      <div>
                        <p className="text-xs font-medium mb-2">AI Recommendations:</p>
                        <ul className="text-sm space-y-1">
                          {selectedComparison.unsuccessfulCall.ai_recommendations.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ArrowRight className="w-3 h-3 mt-1 shrink-0" />
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Successful Call Detail */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-success" />
                    <h3 className="font-semibold">Successful Call</h3>
                  </div>
                  <div className="p-4 rounded-lg bg-success/5 border border-success/20 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="w-4 h-4" />
                      <span>Agent: {selectedComparison.successfulCall.agent_name || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4" />
                      <span>Duration: {formatDuration(selectedComparison.successfulCall.duration_seconds)}</span>
                    </div>
                    {selectedComparison.successfulCall.summary && (
                      <div className="p-3 rounded bg-muted">
                        <p className="text-xs font-medium text-success mb-1">Summary:</p>
                        <p className="text-sm">{selectedComparison.successfulCall.summary}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Learning Points */}
              <div className="p-4 rounded-lg bg-brand-500/5 border border-brand-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-brand-500" />
                  <h3 className="font-semibold">Learning Points</h3>
                </div>
                <ul className="space-y-2">
                  {selectedComparison.learningPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function generateLearningPoints(successCall: CallLog, failCall: CallLog): string[] {
  const points: string[] = [];

  // Duration comparison
  if (successCall.duration_seconds && failCall.duration_seconds) {
    if (successCall.duration_seconds < failCall.duration_seconds) {
      points.push('Successful call was more concise - focus on efficiency');
    } else if (successCall.duration_seconds > failCall.duration_seconds) {
      points.push('Successful call took more time - patience and thoroughness matter');
    }
  }

  // Based on root cause
  if (failCall.root_cause_category) {
    const suggestions: Record<string, string> = {
      pricing_objection: 'Address value proposition early in the call',
      service_complaint: 'Acknowledge concerns and offer concrete solutions',
      agent_confusion: 'Ensure clear understanding before proceeding',
      long_hold_time: 'Set expectations and provide updates during holds',
      unresolved_query: 'Confirm resolution before ending the call',
      technical_issue: 'Document issues clearly for follow-up',
      miscommunication: 'Use active listening and confirmation techniques',
      customer_frustration: 'Remain calm and empathetic throughout',
      wrong_transfer: 'Verify department needs before transferring',
      information_gap: 'Ensure access to required information before calls',
    };
    if (suggestions[failCall.root_cause_category]) {
      points.push(suggestions[failCall.root_cause_category]);
    }
  }

  // Add generic best practices
  points.push('Review successful call approach for handling similar situations');
  points.push('Practice de-escalation techniques with team members');

  return points;
}

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

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
