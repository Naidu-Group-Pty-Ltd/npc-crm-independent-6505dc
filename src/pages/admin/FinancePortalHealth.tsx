/**
 * Finance Portal — Tri-Portal Health Sweep (Chunk 15)
 *
 * Superadmin diagnostics page surfacing drift, orphan, staleness,
 * portal-readiness and audit-chain integrity across Internal,
 * Finance, and Client portals.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, AlertCircle,
  Activity, Link as LinkIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

type Severity = 'ok' | 'notice' | 'warn' | 'critical';
type Check = { key: string; label: string; count: number; severity: Severity };
type Overview = {
  generated_at: string;
  checks: Check[];
  audit_chain_sample: {
    sampled: number;
    results: Array<{ purchase_file_id: string; title: string; status: 'ok'|'broken_chain'|'no_events'; count: number }>;
  };
};

const SEVERITY_CLASS: Record<Severity, string> = {
  ok:       'border-success/25 bg-success-light/70 text-success',
  notice:   'border-[hsl(var(--info)/0.24)] bg-[hsl(var(--info-light)/0.72)] text-[hsl(var(--info))]',
  warn:     'border-warning/30 bg-warning-light/70 text-warning',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

const SEVERITY_ICON: Record<Severity, any> = {
  ok: CheckCircle2, notice: Activity, warn: AlertCircle, critical: AlertTriangle,
};

export default function FinancePortalHealth() {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-tri-portal-health', {
        operation: 'overview',
      });
      if (error) throw new Error(error.message);
      setOverview(data as Overview);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to run health sweep');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const worstSeverity: Severity = (() => {
    if (!overview) return 'ok';
    const order: Severity[] = ['critical', 'warn', 'notice', 'ok'];
    for (const s of order) if (overview.checks.some(c => c.severity === s && c.count > 0)) return s;
    return 'ok';
  })();

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 p-4 md:p-6">
      <DashboardThemeFrame variant="hero" as="header" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('rounded-2xl p-3 border shadow-sm', SEVERITY_CLASS[worstSeverity])}>
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tri-Portal Health Sweep</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Read-only diagnostics across Internal, Finance Partner, and Client portals.
              {overview && <> Last sweep: {new Date(overview.generated_at).toLocaleString('en-AU')}</>}
            </p>
          </div>
        </div>
        <Button onClick={refresh} disabled={loading} size="sm" aria-label="Run tri-portal health sweep" className="gap-2 rounded-xl">
          <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
          Run sweep
        </Button>
      </DashboardThemeFrame>

      {loading && !overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : !overview ? (
        <DashboardThemeFrame variant="section">
          <Card className="border-0 bg-transparent shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Press <strong>Run sweep</strong> to start.
          </CardContent>
        </Card>
        </DashboardThemeFrame>
      ) : (
        <>
          {/* Check cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {overview.checks.map(c => {
              const Icon = SEVERITY_ICON[c.severity];
              return (
                <DashboardThemeFrame key={c.key} variant="premiumCard">
                <Card className={cn('border-0 bg-transparent shadow-none', c.count > 0 && 'ring-1 ring-inset', c.count > 0 && SEVERITY_CLASS[c.severity])}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {c.label}
                        </p>
                        <p className="text-3xl font-semibold mt-1">{c.count}</p>
                      </div>
                      <Icon className="h-5 w-5 shrink-0" />
                    </div>
                    <Badge variant="outline" className={cn('mt-2 border text-[10px] uppercase', SEVERITY_CLASS[c.severity])}>
                      {c.severity}
                    </Badge>
                  </CardContent>
                </Card>
                </DashboardThemeFrame>
              );
            })}
          </div>

          {/* Audit chain sample */}
          <DashboardThemeFrame variant="section" className="p-0">
          <Card className="border-0 bg-transparent shadow-none">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
              <CardTitle className="text-base flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />Audit chain integrity (sample {overview.audit_chain_sample.sampled} PFs)
              </CardTitle>
              <CardDescription>
                Verifies prev_hash → row_hash linkage. Use the PF-level Audit tab for full SHA-256 recompute.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[760px]" aria-label="Audit chain integrity sample">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Purchase file</TableHead>
                    <TableHead className="w-28 text-right">Events</TableHead>
                    <TableHead className="w-32 text-right">Status</TableHead>
                    <TableHead className="w-20 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.audit_chain_sample.results.map(r => {
                    const sev: Severity = r.status === 'broken_chain' ? 'critical' : r.status === 'no_events' ? 'notice' : 'ok';
                    return (
                      <TableRow key={r.purchase_file_id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="font-medium truncate">{r.title}</TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={cn('border', SEVERITY_CLASS[sev])}>
                            {r.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="ghost" className="rounded-xl focus-visible:ring-primary/40">
                            <Link to={`/finance/purchase-files/${r.purchase_file_id}`}>Open</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
          </DashboardThemeFrame>
        </>
      )}
    </DashboardThemeFrame>
  );
}
