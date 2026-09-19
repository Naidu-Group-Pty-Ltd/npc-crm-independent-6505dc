/**
 * Batch 4 #19 — AI File Summary Card.
 * Always-fresh AI brief of a Purchase File: headline, status, outstanding docs,
 * risks, next best action. Cached in `ai_pf_summaries`; broker can regenerate.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, RefreshCw, AlertTriangle, FileText, Target } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const FN = 'finance-portal-ai-copilot';

type Summary = {
  headline: string;
  status_line: string;
  outstanding_docs?: string[];
  key_risks?: string[];
  next_best_action: string;
  settlement_countdown_days?: number;
};

export function AiFileSummaryCard({ purchaseFileId }: { purchaseFileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction(FN, { action: 'list_summary', purchase_file_id: purchaseFileId });
    if (!error && data?.summary) {
      setSummary(data.summary.summary as Summary);
      setGeneratedAt(data.summary.generated_at);
    }
    setLoading(false);
  };

  const regenerate = async () => {
    setRefreshing(true);
    const { data, error } = await invokeFinanceFunction(FN, { action: 'summarize_pf', purchase_file_id: purchaseFileId });
    if (error) toast.error(error.message || 'Failed to regenerate summary');
    else {
      setSummary(data.summary);
      setGeneratedAt(new Date().toISOString());
      toast.success('Summary refreshed');
    }
    setRefreshing(false);
  };

  useEffect(() => { load(); }, [purchaseFileId]);

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Intelligent File Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            {generatedAt && (
              <span className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={regenerate} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-1/2" /></div>
        ) : !summary ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No summary yet for this file.</p>
            <Button size="sm" onClick={regenerate} disabled={refreshing}>
              {refreshing ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Generate
            </Button>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold leading-snug">{summary.headline}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{summary.status_line}</p>
            </div>
            {summary.settlement_countdown_days != null && (
              <Badge variant="outline" className="text-xs">
                Settlement in {summary.settlement_countdown_days} days
              </Badge>
            )}
            {!!summary.outstanding_docs?.length && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                  <FileText className="h-3 w-3" /> Outstanding documents
                </div>
                <ul className="text-xs space-y-0.5 list-disc list-inside marker:text-muted-foreground">
                  {summary.outstanding_docs.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {!!summary.key_risks?.length && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-warning mb-1">
                  <AlertTriangle className="h-3 w-3" /> Watch-outs
                </div>
                <ul className="text-xs space-y-0.5 list-disc list-inside marker:text-warning/70">
                  {summary.key_risks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs flex gap-2">
              <Target className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <div><strong className="text-foreground">Next best action:</strong> {summary.next_best_action}</div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
