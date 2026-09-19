import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Landmark, Scale, ChevronRight } from 'lucide-react';
import { usePortalLendersData } from '@/hooks/usePortalData';
import { cn } from '@/lib/utils';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent, PortalPanelHeader, PortalPanelTitle } from '@/components/portal/PortalSurface';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pre_assessment: 'Pre-Assessment',
  submitted: 'Submitted',
  conditional_approval: 'Conditional Approval',
  unconditional_approval: 'Approved',
  loan_docs_issued: 'Loan Docs Issued',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const STATUS_VARIANT: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pre_assessment: 'bg-primary/10 text-primary',
  submitted: 'bg-warning/15 text-warning',
  conditional_approval: 'bg-primary/10 text-primary',
  unconditional_approval: 'bg-primary/15 text-primary',
  loan_docs_issued: 'bg-primary/20 text-primary',
  settled: 'bg-success/15 text-success',
  declined: 'bg-destructive/10 text-destructive',
  withdrawn: 'bg-muted text-muted-foreground',
};

const PIPELINE = [
  'draft','pre_assessment','submitted','conditional_approval',
  'unconditional_approval','loan_docs_issued','settled',
];

export default function PortalLenders() {
  const { data, isLoading } = usePortalLendersData();
  const submissions: any[] = data?.lenderSubmissions ?? [];
  const comparisons: any[] = data?.lenderComparisons ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Landmark className="h-6 w-6 text-primary" /> Your Lender Submissions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track your loan applications and view lender comparisons your broker has shared.
        </p>
      </div>

      <PortalPanel className="overflow-hidden">
        <PortalPanelHeader className="pb-3">
          <PortalPanelTitle className="text-base">Loan applications</PortalPanelTitle>
          <CardDescription>Read-only view of your submissions across lenders.</CardDescription>
        </PortalPanelHeader>
        <PortalPanelContent className="p-0">
          {submissions.length === 0 ? (
            <PortalEmptyState
              className="rounded-none border-0 shadow-none"
              icon={<Landmark className="h-8 w-8" />}
              title="No active submissions yet"
              description="Your broker will share loan application progress here as each lender submission moves forward."
            />
          ) : (
            <div className="divide-y divide-border">
              {submissions.map(s => {
                const idx = PIPELINE.indexOf(s.status);
                return (
                  <div key={s.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{s.lender_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.product_name || '—'}
                          {s.loan_amount ? ` · $${Number(s.loan_amount).toLocaleString('en-AU')}` : ''}
                          {s.interest_rate ? ` · ${Number(s.interest_rate).toFixed(2)}%` : ''}
                        </div>
                      </div>
                      <Badge className={cn("text-[10px]", STATUS_VARIANT[s.status])}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </div>
                    {idx >= 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {PIPELINE.map((st, i) => (
                          <div key={st} className="flex items-center gap-1">
                            <div className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-medium",
                              i <= idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            )}>
                              {STATUS_LABEL[st]}
                            </div>
                            {i < PIPELINE.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </PortalPanelContent>
      </PortalPanel>

      <PortalPanel className="overflow-hidden">
        <PortalPanelHeader className="pb-3">
          <PortalPanelTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" /> Lender comparisons
          </PortalPanelTitle>
          <CardDescription>Comparison snapshots your broker has shared with you.</CardDescription>
        </PortalPanelHeader>
        <PortalPanelContent className="p-0">
          {comparisons.length === 0 ? (
            <PortalEmptyState
              className="rounded-none border-0 shadow-none"
              icon={<Scale className="h-8 w-8" />}
              title="No comparisons shared yet"
              description="Comparison snapshots from your broker will appear here when they are ready for review."
            />
          ) : (
            <div className="divide-y divide-border">
              {comparisons.map(sheet => (
                <div key={sheet.id} className="p-4 space-y-2">
                  <div className="font-medium text-sm">{sheet.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Shared {new Date(sheet.created_at).toLocaleDateString('en-AU')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(sheet.rate_snapshot as any[]).map((r, i) => (
                      <Badge key={i} variant="outline" className={cn("text-[10px] tabular-nums",
                        i === 0 && "border-primary/50 text-primary"
                      )}>
                        {r.lender_name}{r.lowest_rate ? ` · ${Number(r.lowest_rate).toFixed(2)}%` : ''}
                      </Badge>
                    ))}
                  </div>
                  {sheet.notes && (
                    <div className="text-xs text-muted-foreground italic">{sheet.notes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </PortalPanelContent>
      </PortalPanel>
    </div>
  );
}
