import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase, ArrowRight, Plus, CalendarClock, Wallet, AlertTriangle, Building2,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export function ClientPurchaseFilesPanel({ clientId }: { clientId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['finance-portal-purchase-files-for-client', clientId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'list_files_for_client',
        client_id: clientId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!clientId,
  });

  const files = data?.files || [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
            <Briefcase className="h-5 w-5" />
          </div>
          <p className="font-medium text-foreground">No purchase files yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Open a Deal Room for this client when they're ready to start an acquisition.
          </p>
          <Button asChild size="sm" className="mt-4 gap-2">
            <Link to="/finance/purchase-files">
              <Plus className="h-4 w-4" /> Go to Purchase Files
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((f: any) => {
        const next = (f.purchase_file_critical_dates || [])
          .filter((d: any) => d.due_date && d.status !== 'completed')
          .sort((a: any, b: any) => (a.due_date || '').localeCompare(b.due_date || ''))[0];
        const days = next ? Math.round((new Date(next.due_date).getTime() - Date.now()) / 86400000) : null;
        const deadlineTone = days != null && days <= 2
          ? 'bg-destructive/10 text-destructive border-destructive/20'
          : days != null && days <= 7
            ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20'
            : 'bg-muted text-muted-foreground';
        const riskTone = f.risk_level === 'high'
          ? 'bg-destructive/10 text-destructive border-destructive/20'
          : f.risk_level === 'medium'
            ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20'
            : '';
        return (
          <Link
            key={f.id}
            to={`/finance/purchase-files/${f.id}`}
            className="group block"
          >
            <Card className="border hover:border-primary/30 hover:shadow-md transition-all">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Briefcase className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-foreground truncate">{f.title || 'Purchase file'}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{(f.status || 'active').replace(/_/g, ' ')}</Badge>
                      {f.finance_status && (
                        <Badge variant="outline" className="text-[10px] capitalize">{f.finance_status.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                    {f.property_address && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">{f.property_address}</span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.lender && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{f.lender}</Badge>
                      )}
                      {f.max_approved_budget != null && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-muted-foreground">
                          <Wallet className="h-2.5 w-2.5" />
                          ${Number(f.max_approved_budget).toLocaleString('en-AU')}
                        </Badge>
                      )}
                      {f.risk_level && (
                        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 capitalize gap-1', riskTone)}>
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {f.risk_level}
                        </Badge>
                      )}
                      {next && (
                        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1', deadlineTone)}>
                          <CalendarClock className="h-2.5 w-2.5" />
                          {String(next.date_type).replace(/_/g, ' ')} ·{' '}
                          {format(new Date(next.due_date), 'd MMM')}
                          {days != null && (
                            <span>· {days < 0 ? `${-days}d overdue` : `${days}d`}</span>
                          )}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
