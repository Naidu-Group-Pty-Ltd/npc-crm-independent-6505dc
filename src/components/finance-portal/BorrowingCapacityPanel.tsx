import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, TrendingUp, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useBrand } from '@/branding/useBrand';

interface Props {
  clientId: string;
}

interface Assessment {
  id: string;
  borrowing_capacity: number;
  serviceability_band: string | null;
  monthly_surplus: number | null;
  dti_ratio: number | null;
  stress_tested_capacity: number | null;
  gross_annual_income: number | null;
  shaded_annual_income: number | null;
  living_expenses_monthly: number | null;
  existing_commitments_monthly: number | null;
  interest_rate_used: number | null;
  buffer_rate: number | null;
  assessment_rate: number | null;
  loan_term_years: number | null;
  proposed_loan_amount: number | null;
  proposed_lvr: number | null;
  lmi_amount: number | null;
  net_purchase_capacity: number | null;
  recommendations: any;
  warnings: string[] | null;
  created_at: string;
}

const fmtAUD = (n: any) =>
  n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(n));
const fmtPct = (n: any, digits = 2) => (n == null ? '—' : `${Number(n).toFixed(digits)}%`);

const bandStyles: Record<string, string> = {
  green: 'bg-success/10 text-success dark:text-success border-success/20',
  amber: 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20',
  red: 'bg-destructive/10 text-destructive border-destructive/20',
};

export function BorrowingCapacityPanel({ clientId }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'the team';

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-portal-bc', clientId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'get_borrowing_capacity',
        client_id: clientId,
      });
      if (error) throw new Error(error.message);
      return data as { latest: Assessment | null; history: Assessment[]; permission: { view: boolean } };
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    const msg = (error as Error).message;
    const denied = /no view permission/i.test(msg);
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground opacity-50 mb-3" />
          <p className="text-sm text-destructive">{denied ? 'Access to borrowing capacity is restricted for this client.' : msg}</p>
        </CardContent>
      </Card>
    );
  }

  const latest = data?.latest;

  if (!latest) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">
            No borrowing capacity assessment has been calculated for this client yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Once {brandName} runs an assessment it will appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  const band = (latest.serviceability_band || 'red').toLowerCase();
  const bandClass = bandStyles[band] || bandStyles.red;
  const recommendations = Array.isArray(latest.recommendations) ? latest.recommendations : [];
  const warnings = latest.warnings || [];

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Borrowing Capacity
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Latest assessment · {format(new Date(latest.created_at), 'd MMM yyyy, h:mm a')}
              </CardDescription>
            </div>
            <Badge variant="outline" className={cn('uppercase tracking-wide', bandClass)}>
              {band} · serviceability
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-gradient-to-br from-primary/5 to-transparent p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Maximum borrowing</p>
            <p className="text-3xl font-bold mt-1">{fmtAUD(latest.borrowing_capacity)}</p>
            {latest.net_purchase_capacity != null && (
              <p className="text-xs text-muted-foreground mt-2">
                Net purchase capacity {fmtAUD(latest.net_purchase_capacity)}
                {latest.lmi_amount ? ` · incl. est. LMI ${fmtAUD(latest.lmi_amount)}` : ''}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Monthly surplus" value={fmtAUD(latest.monthly_surplus)} />
            <Stat label="DTI ratio" value={latest.dti_ratio != null ? `${Number(latest.dti_ratio).toFixed(2)}x` : '—'} />
            <Stat label="Stress-tested" value={fmtAUD(latest.stress_tested_capacity)} />
            <Stat label="Loan term" value={latest.loan_term_years ? `${latest.loan_term_years} yrs` : '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Inputs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Inputs used</CardTitle>
          <CardDescription className="text-xs">Snapshot of the figures modelled.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Gross annual income" value={fmtAUD(latest.gross_annual_income)} />
            <Row label="Shaded annual income" value={fmtAUD(latest.shaded_annual_income)} />
            <Row label="Living expenses (monthly)" value={fmtAUD(latest.living_expenses_monthly)} />
            <Row label="Existing commitments (monthly)" value={fmtAUD(latest.existing_commitments_monthly)} />
            <Row label="Interest rate used" value={fmtPct(latest.interest_rate_used)} />
            <Row label="Buffer rate (APRA)" value={fmtPct(latest.buffer_rate)} />
            <Row label="Assessment rate" value={fmtPct(latest.assessment_rate)} />
            <Row label="Proposed loan amount" value={fmtAUD(latest.proposed_loan_amount)} />
            <Row label="Proposed LVR" value={fmtPct(latest.proposed_lvr)} />
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-brand-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-brand-600" /> Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-2"><span className="text-brand-600">•</span><span>{w}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" /> Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {recommendations.map((r: any, i: number) => (
                <li key={i} className="flex gap-2">
                  <span className="text-success">•</span>
                  <span>{typeof r === 'string' ? r : (r?.message || r?.text || JSON.stringify(r))}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Read-only view. Borrowing capacity assessments are calculated using APRA-compliant
          serviceability rules. Contact your account manager to request a re-assessment or to update inputs.
        </span>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-1">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
