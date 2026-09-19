import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSearch, Link2, ArrowRight } from 'lucide-react';
import type { DealWithClient } from '@/hooks/useAllDeals';

const FINANCE_STATUS_TONE: Record<string, string> = {
  at_risk: 'border-destructive/40 bg-destructive/5 text-destructive',
  unconditional_approval: 'border-success/40 bg-success/5 text-success',
  settled: 'border-success/40 bg-success/5 text-success',
  ready_for_settlement: 'border-success/40 bg-success/5 text-success',
};

function statusLabel(s?: string | null) {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function LinkedFinanceFilesPanel({ deals }: { deals: DealWithClient[] }) {
  const navigate = useNavigate();

  const linked = useMemo(() => deals.filter(d => d.financeFile), [deals]);
  const unlinked = useMemo(() => deals.filter(d => !d.financeFile), [deals]);

  return (
    <Card className="overflow-hidden rounded-[1.35rem] border-brand-200/15 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.065),rgba(24,24,27,0.88)_44%,rgba(0,0,0,0.70))] shadow-[0_22px_60px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <CardHeader className="space-y-4 border-b border-brand-100/10 px-4 pb-4 pt-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-brand-200/25 bg-brand-300/10 p-2.5 text-brand-100 shadow-[0_0_24px_rgba(245,158,11,0.14)]">
            <Link2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Finance coordination
            </p>
            <CardTitle className="mt-1 text-base font-semibold tracking-tight">
              Linked Finance Files
            </CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Purchase File coverage for active deals, with finance portal hand-offs kept visible for follow-up.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row">
            <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 px-2.5 py-1 text-success dark:text-success">
              <CheckCircle2 className="h-3 w-3" />
              {linked.length} linked
            </Badge>
            <Badge variant="outline" className="gap-1 border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-brand-700 dark:text-brand-300">
              <AlertTriangle className="h-3 w-3" />
              {unlinked.length} unlinked
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="rounded-[1rem] border border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(255,255,255,0.035))] p-3 shadow-inner">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg bg-brand-500/15 p-1.5 text-brand-700 dark:text-brand-300">
              <FileSearch className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {unlinked.length > 0 ? 'Finance linking attention required' : 'Finance file coverage is fully linked'}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {linked.length === 0
                  ? 'No deals are linked to a finance Purchase File yet. Open a deal in Command Centre and link it from the finance portal Deal Room.'
                  : unlinked.length > 0
                    ? 'Unlinked deals remain in the workflow queue so the team can coordinate Purchase File setup without losing visibility.'
                    : 'Every deal in this view is connected to a finance Purchase File and ready for portal review.'}
              </p>
            </div>
          </div>
        </div>

        {linked.length > 0 && (
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {linked.map(d => {
              const pf = d.financeFile!;
              const tone = FINANCE_STATUS_TONE[pf.finance_status || ''] || 'border-border/80 bg-background/70';
              return (
                <div key={d.id} className={`group flex items-center justify-between gap-3 rounded-[1rem] border p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/40 hover:bg-white/[0.07] ${tone}`}>
                  <div className="min-w-0">
                    <p className="font-semibold truncate text-foreground">{d.client_name}</p>
                    <p className="mt-1 text-muted-foreground truncate">
                      {pf.lender || 'No lender'} · {pf.settlement_date || 'No settlement date'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] capitalize bg-background/60">{statusLabel(pf.finance_status)}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs hover:bg-background/80"
                      onClick={() => navigate(`/finance/purchase-files/${pf.id}`)}
                    >
                      Open <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" /><ExternalLink className="ml-1 h-3 w-3 opacity-70" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
