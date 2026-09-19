import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Sun, AlertTriangle, Clock, CalendarClock, ShieldAlert, ArrowRight, Sparkles } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { motion } from 'framer-motion';
import { smartCapitalize } from '@/lib/nameUtils';
import { cn } from '@/lib/utils';

type Bucket = 'breaching' | 'stale' | 'settling' | 'at_risk';
const BUCKET_META: Record<Bucket, { label: string; icon: any; tone: string }> = {
  breaching: { label: 'Breaching in next 24h', icon: AlertTriangle, tone: 'text-destructive border-destructive/30 bg-destructive/5' },
  stale:     { label: 'No partner action 72h+', icon: Clock,        tone: 'text-brand-500 border-brand-500/30 bg-brand-500/5' },
  settling:  { label: 'Settling this week',     icon: CalendarClock, tone: 'text-success border-success/30 bg-success/5' },
  at_risk:   { label: 'Flagged at risk',        icon: ShieldAlert,  tone: 'text-destructive border-destructive/30 bg-destructive/5' },
};

function Row({ file }: { file: any }) {
  const clientName = smartCapitalize(
    `${file.clients?.primary_first_name || ''} ${file.clients?.primary_surname || ''}`.trim()
  ) || 'Client';
  const lastAction = file.last_partner_action_at || file.updated_at;
  return (
    <Link
      to={`/finance/purchase-files/${file.id}`}
      className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors border border-transparent hover:border-border"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {clientName}
          <span className="text-muted-foreground font-normal"> · {file.title}</span>
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {file.property_address || '—'}
          {file.lender && <span> · {file.lender}</span>}
          {lastAction && <span> · {formatDistanceToNowStrict(new Date(lastAction))} since action</span>}
        </div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

export function TodayPanel() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['finance-portal-today'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', { operation: 'list_today' });
      if (error) throw new Error(error.message);
      return data;
    },
    refetchInterval: 60_000,
  });

  const buckets = data?.buckets || { breaching: [], stale: [], settling: [], at_risk: [] };
  const total = (Object.keys(buckets) as Bucket[]).reduce((n, k) => n + (buckets[k]?.length || 0), 0);

  if (isLoading) {
    return (
      <Card className="border overflow-hidden">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Sun className="h-4 w-4 text-primary" /> Today</CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-40 w-full" /></CardContent>
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border-primary/30 overflow-hidden bg-gradient-to-br from-primary/[0.04] via-card to-card">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Sun className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-base">Today</CardTitle>
              <CardDescription className="text-xs">
                Files waiting on you, ordered by urgency
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="tabular-nums">
            {total} {total === 1 ? 'item' : 'items'}
          </Badge>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <div className="py-10 text-center">
              <Sparkles className="h-7 w-7 mx-auto text-success mb-2" />
              <p className="text-sm font-medium">You're clear for today</p>
              <p className="text-xs text-muted-foreground mt-1">
                Nothing breaching SLA, stale, settling this week or flagged at risk.
              </p>
              <Button variant="ghost" size="sm" asChild className="mt-3 text-xs">
                <Link to="/finance/purchase-files">Browse all files <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(['breaching', 'at_risk', 'stale', 'settling'] as Bucket[]).map(key => {
                const items = buckets[key] || [];
                if (items.length === 0) return null;
                const meta = BUCKET_META[key];
                const Icon = meta.icon;
                return (
                  <div key={key} className={cn('rounded-xl border p-3', meta.tone)}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </div>
                      <Badge variant="outline" className="text-[10px] tabular-nums bg-background/50">{items.length}</Badge>
                    </div>
                    <div className="space-y-0.5">
                      {items.slice(0, 4).map((f: any) => <Row key={f.id} file={f} />)}
                      {items.length > 4 && (
                        <div className="text-[10px] text-muted-foreground text-center pt-1">+{items.length - 4} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
