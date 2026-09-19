import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, Brain, AlertTriangle, ExternalLink, Globe, ArrowUp, ArrowDown, Minus, Calendar } from 'lucide-react';
import { EnhancedResearchRenderer, createMarkdownComponents } from './EnhancedResearchRenderer';
import { MarketIntelligenceExportButton } from './MarketIntelligenceExportButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MarketEvent {
  date: string;
  event: string;
  category: 'interest_rate' | 'economic' | 'housing' | 'regulatory' | 'seasonal';
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
  relevance_score: number;
}

interface MarketCorrelationPanelProps {
  marketEvents: MarketEvent[];
  perplexityResearch: string;
  citations: string[];
  aiAnalysis: string;
  aiError?: string;
  loading: boolean;
}

const CATEGORY_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  interest_rate: { label: 'Interest Rate', emoji: '🏦', color: 'bg-info/10 text-info dark:text-info border-info/30' },
  economic: { label: 'Economic', emoji: '📊', color: 'bg-accent/10 text-accent dark:text-accent border-accent/30' },
  housing: { label: 'Housing', emoji: '🏠', color: 'bg-success/10 text-success dark:text-success border-success/30' },
  regulatory: { label: 'Regulatory', emoji: '⚖️', color: 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/30' },
  seasonal: { label: 'Seasonal', emoji: '📅', color: 'bg-info/10 text-info dark:text-info border-info/30' },
};

const REPORT_TYPE_OPTIONS = [
  { value: 'market_pulse', label: 'Market Pulse' },
  { value: 'full', label: 'Full Report' },
  { value: 'finance_update', label: 'Finance & Lending' },
  { value: 'strategy_insight', label: 'Strategy Insight' },
  { value: 'hotspot_deep_dive', label: 'Hotspot Deep Dive' },
  { value: 'myth_busting', label: 'Myth Busting' },
] as const;

type MarketCorrelationReportType = (typeof REPORT_TYPE_OPTIONS)[number]['value'];

function ImpactIcon({ impact }: { impact: string }) {
  if (impact === 'positive') return <ArrowUp className="h-3.5 w-3.5 text-success" />;
  if (impact === 'negative') return <ArrowDown className="h-3.5 w-3.5 text-destructive" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isUpcoming(dateStr: string) {
  return new Date(dateStr) > new Date();
}

export function MarketCorrelationPanel({ marketEvents, perplexityResearch, citations, aiAnalysis, aiError, loading }: MarketCorrelationPanelProps) {
  const markdownComponents = useMemo(() => createMarkdownComponents(), []);
  const [selectedReportType, setSelectedReportType] = useState<MarketCorrelationReportType>('market_pulse');

  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </span>
            <span className="truncate">Market Correlation</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Analyzing market conditions...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!marketEvents?.length && !aiAnalysis && !perplexityResearch) return null;

  const recentEvents = marketEvents.filter(e => !isUpcoming(e.date)).slice(0, 8);
  const upcomingEvents = marketEvents.filter(e => isUpcoming(e.date)).slice(0, 5);

  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Activity className="h-5 w-5 text-primary" />
              </span>
              <span className="truncate">Market Correlation & Intelligence</span>
              <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">Phase 4</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              How macro events impact your ad performance
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="w-full sm:w-[180px]">
              <Select value={selectedReportType} onValueChange={(value) => setSelectedReportType(value as MarketCorrelationReportType)}>
                <SelectTrigger className="h-9 rounded-xl text-xs">
                  <SelectValue placeholder="Select report type" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <MarketIntelligenceExportButton
              reportType={selectedReportType}
              reportContext="market_correlation"
              correlationData={{
                aiAnalysis,
                perplexityResearch,
                citations,
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* AI Correlation Analysis */}
        {aiAnalysis && (
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI Market Correlation</span>
            </div>
            <div className="prose-override">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{aiAnalysis}</ReactMarkdown>
            </div>
          </div>
        )}

        {aiError && (
          <div className="flex items-start gap-2 rounded-2xl border border-brand-500/20 bg-brand-500/5 p-3">
            <AlertTriangle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
            <p className="text-xs text-brand-600 dark:text-brand-400">{aiError}</p>
          </div>
        )}

        {/* Timeline: Recent + Upcoming Events */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Events */}
          {recentEvents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Recent Events
              </h4>
              <div className="space-y-2">
                {recentEvents.map((event, i) => {
                  const catConfig = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.economic;
                  return (
                    <div key={i} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/45 p-3 transition-colors hover:border-primary/25 hover:bg-primary/[0.04]">
                      <div className="mt-0.5">
                        <ImpactIcon impact={event.impact} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{event.event}</span>
                          <Badge variant="outline" className={`rounded-full px-1.5 py-0 text-[9px] ${catConfig.color}`}>
                            {catConfig.emoji} {catConfig.label}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{event.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/70">{formatDate(event.date)}</span>
                          {event.relevance_score >= 70 && (
                            <Badge variant="outline" className="rounded-full border-primary/30 px-1 py-0 text-[9px] text-primary">
                              High Relevance
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming Events */}
          {upcomingEvents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Upcoming Events to Watch
              </h4>
              <div className="space-y-2">
                {upcomingEvents.map((event, i) => {
                  const catConfig = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.economic;
                  return (
                    <div key={i} className="flex items-start gap-3 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] p-3">
                      <div className="mt-0.5">
                        <ImpactIcon impact={event.impact} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{event.event}</span>
                          <Badge variant="outline" className={`rounded-full px-1.5 py-0 text-[9px] ${catConfig.color}`}>
                            {catConfig.emoji} {catConfig.label}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{event.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-medium text-primary">{formatDate(event.date)}</span>
                          <Badge variant="outline" className="rounded-full border-primary/40 bg-primary/5 px-1 py-0 text-[9px] text-primary">
                            Upcoming
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Perplexity Research */}
        {perplexityResearch && (
          <EnhancedResearchRenderer
            content={perplexityResearch}
            citations={citations}
            title="View Full Market Intelligence Report"
          />
        )}
      </CardContent>
    </Card>
  );
}
