/**
 * Batch 4 #22 — AI Loan App Pre-fill.
 * Compiles a structured application sheet (applicants, liabilities, property, gaps)
 * by mining the PF's classified documents.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClipboardList, Loader2, Download, Sparkles } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';

export function AiLoanAppPrefillCard({ purchaseFileId }: { purchaseFileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const { data: res, error } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'prefill_loan_app', purchase_file_id: purchaseFileId });
    if (error) toast.error(error.message || 'Failed');
    else setData(res.prefill?.extracted ?? null);
    setLoading(false);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `loan-app-prefill-${purchaseFileId}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" /> Loan Application Pre-fill
          </CardTitle>
          <div className="flex items-center gap-2">
            {data && <Button size="sm" variant="ghost" onClick={download}><Download className="h-3.5 w-3.5 mr-1.5" />Export</Button>}
            <Button size="sm" variant="outline" onClick={run} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {data ? 'Re-extract' : 'Extract from docs'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground">Pulls applicants, liabilities, and property details out of the classified documents into a structured sheet.</p>
        ) : (
          <div className="space-y-3 text-xs">
            {data.applicants?.length > 0 && (
              <Section title="Applicants">
                {data.applicants.map((a: any, i: number) => (
                  <KvRow key={i} kv={a} />
                ))}
              </Section>
            )}
            {data.property && (
              <Section title="Property"><KvRow kv={data.property} /></Section>
            )}
            {data.liabilities?.length > 0 && (
              <Section title="Liabilities">
                {data.liabilities.map((l: any, i: number) => <KvRow key={i} kv={l} />)}
              </Section>
            )}
            {data.gaps?.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5">
                <div className="text-xs font-medium text-warning mb-1">Missing inputs</div>
                <ul className="list-disc list-inside text-xs space-y-0.5">{data.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function KvRow({ kv }: { kv: Record<string, any> }) {
  return (
    <div className="rounded-md bg-muted/30 p-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
      {Object.entries(kv).map(([k, v]) => v == null || (typeof v === 'object' && !Array.isArray(v)) ? null : (
        <div key={k} className="contents">
          <div className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</div>
          <div className="font-medium truncate">{Array.isArray(v) ? v.join(', ') : String(v)}</div>
        </div>
      ))}
    </div>
  );
}
