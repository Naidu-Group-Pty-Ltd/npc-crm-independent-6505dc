import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, FileText, RefreshCw, Calendar, ChevronDown, ChevronUp, Brain, AlertTriangle, Clock, Eye, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface BriefReport {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  metrics_snapshot: any;
  forecast_data: any;
  content?: string;
  created_at: string;
}

interface WeeklyBriefPanelProps {
  currentBrief: string;
  currentBriefError?: string;
  pastBriefs: BriefReport[];
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  pastBriefsLoading: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadBriefAsMarkdown(report: BriefReport) {
  const content = report.content || '';
  const header = `# ${report.title}\n\nGenerated: ${formatDate(report.created_at)}\nPeriod: ${formatDate(report.period_start)} – ${formatDate(report.period_end)}\n\n---\n\n`;
  const blob = new Blob([header + content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function WeeklyBriefPanel({
  currentBrief, currentBriefError, pastBriefs,
  loading, generating, onGenerate, pastBriefsLoading,
}: WeeklyBriefPanelProps) {
  const [showPastBriefs, setShowPastBriefs] = useState(false);
  const [viewingBrief, setViewingBrief] = useState<BriefReport | null>(null);

  return (
    <>
      <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.82)_60%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </span>
                <span className="truncate">Weekly AI Brief</span>
                <Badge variant="secondary" className="rounded-full border-primary/20 bg-primary/10 text-[10px] text-primary">Phase 3</Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                AI-generated strategic performance report with forecasts
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {pastBriefs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPastBriefs(!showPastBriefs)}
                  className="rounded-xl text-xs hover:bg-primary/10 hover:text-primary"
                >
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  History ({pastBriefs.length})
                  {showPastBriefs ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onGenerate}
                disabled={generating || loading}
                className="rounded-xl border-primary/20 hover:bg-primary/10 hover:text-primary"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                {generating ? 'Generating...' : 'Generate Brief'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Past Briefs History */}
          {showPastBriefs && (
            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/40 p-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Past Reports</h4>
              {pastBriefsLoading ? (
                <div className="flex items-center gap-2 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading history...</span>
                </div>
              ) : pastBriefs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No past briefs found.</p>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {pastBriefs.map((report) => (
                    <div key={report.id} className="flex items-center justify-between gap-2 rounded-2xl border border-border/50 bg-background/55 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <span className="block truncate text-xs font-medium" title={report.title}>{report.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(report.period_start)} – {formatDate(report.period_end)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {report.metrics_snapshot?.total_spend != null && (
                          <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">
                            {formatCurrency(report.metrics_snapshot.total_spend)}
                          </span>
                        )}
                        {report.content ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-xl p-0"
                              onClick={() => setViewingBrief(report)}
                              title="View brief"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 rounded-xl p-0"
                              onClick={() => downloadBriefAsMarkdown(report)}
                              title="Download brief"
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">No content</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Current Brief Content */}
          {loading || generating ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-background/45 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium text-foreground">
                {generating ? 'Generating weekly brief...' : 'Loading...'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Analyzing campaigns, forecasting trends, building recommendations
              </p>
            </div>
          ) : currentBriefError ? (
            <div className="flex items-start gap-3 rounded-2xl border border-brand-500/20 bg-brand-500/10 p-4">
              <AlertTriangle className="h-5 w-5 text-brand-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Brief generation encountered an issue</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">{currentBriefError}</p>
              </div>
            </div>
          ) : currentBrief ? (
            <BriefContent content={currentBrief} />
          ) : (
            <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-12 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">No weekly brief generated yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Click "Generate Brief" to create an AI-powered strategic report
              </p>
              <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/10 hover:text-primary" onClick={onGenerate} disabled={generating}>
                <Brain className="h-3.5 w-3.5 mr-1.5" />
                Generate First Brief
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Past Brief Modal */}
      <Dialog open={!!viewingBrief} onOpenChange={(open) => !open && setViewingBrief(null)}>
        {/* sm:overflow-y-auto is load-bearing: the dialog base sets
            sm:overflow-visible at ≥640px, which clipped the brief at the
            bottom with no scrollbar at all. */}
        <DialogContent className="max-w-3xl w-[calc(100vw-32px)] max-h-[85vh] overflow-y-auto rounded-3xl border-primary/20 bg-card/95 sm:max-w-3xl sm:max-h-[85dvh] sm:overflow-y-auto">
          {viewingBrief && (
            <>
              <DialogHeader>
                <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="truncate" title={viewingBrief.title}>{viewingBrief.title}</span>
                </DialogTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span>{formatDate(viewingBrief.period_start)} – {formatDate(viewingBrief.period_end)}</span>
                  <span>Generated {formatDate(viewingBrief.created_at)}</span>
                  {viewingBrief.metrics_snapshot?.total_spend != null && (
                    <Badge variant="secondary" className="text-[10px]">
                      Spend: {formatCurrency(viewingBrief.metrics_snapshot.total_spend)}
                    </Badge>
                  )}
                  {viewingBrief.metrics_snapshot?.total_leads != null && (
                    <Badge variant="secondary" className="text-[10px]">
                      {viewingBrief.metrics_snapshot.total_leads} leads
                    </Badge>
                  )}
                </div>
              </DialogHeader>
              <div className="mt-2">
                <BriefContent content={viewingBrief.content || ''} />
              </div>
              <div className="flex justify-end pt-2 border-t border-border/50">
                <Button variant="outline" size="sm" onClick={() => downloadBriefAsMarkdown(viewingBrief)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download Markdown
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BriefContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] p-5">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border/50">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI-Generated Strategic Brief</span>
        </div>
        <div className="break-words text-sm leading-relaxed [&>h1]:text-base [&>h1]:font-bold [&>h1]:mt-4 [&>h1]:mb-2 [&>h2]:text-sm [&>h2]:font-bold [&>h2]:mt-4 [&>h2]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-3 [&>h3]:mb-1.5 [&>p]:mb-2 [&>ul]:mb-2 [&>ul]:pl-4 [&>ol]:mb-2 [&>ol]:pl-4 [&>li]:mb-0.5 [&>strong]:font-semibold">
          <ReactMarkdown>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
