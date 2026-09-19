/**
 * Batch 4 #23 — AI Lender Recommender.
 * Suggests top 3 lenders for the borrower profile, with rationale + watch-outs.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Building2, AlertTriangle, Loader2 } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';

type Rec = { lender: string; score: number; rationale: string; watchouts?: string[] };

export function AiLenderRecommenderCard({ purchaseFileId }: { purchaseFileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'recommend_lenders', purchase_file_id: purchaseFileId });
    if (error) toast.error(error.message || 'Failed');
    else {
      setRecs(data.recommendation?.recommendations ?? []);
      setNote(data.recommendation?.rationale ?? null);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Lender Recommender
          </CardTitle>
          <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {recs ? 'Refresh' : 'Suggest lenders'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!recs ? (
          <p className="text-sm text-muted-foreground">Compare top-fit lenders based on the borrower profile and live lender data.</p>
        ) : recs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lender matched the criteria with sufficient confidence.</p>
        ) : (
          <>
            {recs.map((r, i) => (
              <div key={i} className="rounded-xl border border-border/60 p-3 bg-card/50">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-semibold text-sm">{r.lender}</div>
                  <Badge variant="outline">{Math.round(r.score)} / 100</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{r.rationale}</p>
                {!!r.watchouts?.length && (
                  <div className="mt-2 text-[11px] text-warning inline-flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{r.watchouts.join(' • ')}</span>
                  </div>
                )}
              </div>
            ))}
            {note && <p className="text-xs italic text-muted-foreground">{note}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
