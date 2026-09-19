import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Globe, Brain, AlertTriangle, ExternalLink, TrendingUp, TrendingDown, Minus, Award, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell, Legend } from 'recharts';
import { EnhancedResearchRenderer, createMarkdownComponents } from './EnhancedResearchRenderer';

interface BenchmarkData {
  metric: string;
  your_value: number;
  industry_avg: number;
  industry_top_quartile: number;
  percentile_rank: number;
  verdict: 'excellent' | 'above_average' | 'average' | 'below_average' | 'poor';
  insight: string;
}

interface BenchmarksPanelProps {
  benchmarks: BenchmarkData[];
  perplexityResearch: string;
  citations: string[];
  aiAnalysis: string;
  aiError?: string;
  rawBenchmarks?: any;
  loading: boolean;
}

const VERDICT_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  excellent: { label: 'Excellent', color: 'text-success dark:text-success', bgColor: 'bg-success/10', borderColor: 'border-success/30' },
  above_average: { label: 'Above Avg', color: 'text-info dark:text-info', bgColor: 'bg-info/10', borderColor: 'border-info/30' },
  average: { label: 'Average', color: 'text-muted-foreground', bgColor: 'bg-muted/30', borderColor: 'border-border' },
  below_average: { label: 'Below Avg', color: 'text-brand-600 dark:text-brand-400', bgColor: 'bg-brand-500/10', borderColor: 'border-brand-500/30' },
  poor: { label: 'Poor', color: 'text-destructive dark:text-destructive', bgColor: 'bg-destructive/10', borderColor: 'border-destructive/30' },
};

function formatMetricValue(metric: string, value: number): string {
  if (metric === 'CTR') return `${value.toFixed(2)}%`;
  return `$${value.toFixed(2)}`;
}

function PercentileBar({ percentile }: { percentile: number }) {
  const color = percentile >= 75 ? 'bg-success' : percentile >= 50 ? 'bg-info' : percentile >= 25 ? 'bg-brand-500' : 'bg-destructive';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${percentile}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{percentile}th</span>
    </div>
  );
}

export function BenchmarksPanel({ benchmarks, perplexityResearch, citations, aiAnalysis, aiError, rawBenchmarks, loading }: BenchmarksPanelProps) {
  const markdownComponents = useMemo(() => createMarkdownComponents(), []);

  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </span>
            <span className="truncate">Industry Benchmarks</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Researching industry benchmarks...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!benchmarks || benchmarks.length === 0) return null;

  // Chart data
  const chartData = benchmarks.map(b => ({
    metric: b.metric,
    yours: b.your_value,
    industry: b.industry_avg,
    topQuartile: b.industry_top_quartile,
  }));

  // Overall score
  const avgPercentile = Math.round(benchmarks.reduce((s, b) => s + b.percentile_rank, 0) / benchmarks.length);
  const overallVerdict = avgPercentile >= 75 ? 'excellent' : avgPercentile >= 55 ? 'above_average' : avgPercentile >= 35 ? 'average' : avgPercentile >= 20 ? 'below_average' : 'poor';
  const overallConfig = VERDICT_CONFIG[overallVerdict];

  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </span>
              <span className="truncate">Industry Benchmarks</span>
              <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">Phase 4</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Your performance vs. Australian property investment ad benchmarks
              {rawBenchmarks?.data_period && (
                <span className="ml-1 text-[10px]">· {rawBenchmarks.data_period}</span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${overallConfig.borderColor} ${overallConfig.color} ${overallConfig.bgColor} gap-1 rounded-full px-2.5 py-1 text-xs`}>
              <Award className="h-3 w-3" />
              {avgPercentile}th Percentile · {overallConfig.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Benchmark Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {benchmarks.map((b) => {
            const config = VERDICT_CONFIG[b.verdict];
            return (
              <div key={b.metric} className={`min-w-0 rounded-2xl border ${config.borderColor} ${config.bgColor} p-4 shadow-sm`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">{b.metric}</span>
                  <Badge variant="outline" className={`rounded-full text-[10px] ${config.borderColor} ${config.color}`}>
                    {config.label}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2.5">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Yours</p>
                    <p className="text-sm font-bold font-mono text-foreground">{formatMetricValue(b.metric, b.your_value)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Industry Avg</p>
                    <p className="text-sm font-mono text-muted-foreground">{formatMetricValue(b.metric, b.industry_avg)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Top 25%</p>
                    <p className="text-sm font-mono text-muted-foreground">{formatMetricValue(b.metric, b.industry_top_quartile)}</p>
                  </div>
                </div>
                <PercentileBar percentile={b.percentile_rank} />
                <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">{b.insight}</p>
              </div>
            );
          })}
        </div>

        {/* AI Strategic Analysis */}
        {aiAnalysis && (
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI Competitive Analysis</span>
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

        {/* Perplexity Research + Citations */}
        {perplexityResearch && (
          <EnhancedResearchRenderer
            content={perplexityResearch}
            citations={citations}
            title="View Real-Time Market Research"
          />
        )}
      </CardContent>
    </Card>
  );
}
