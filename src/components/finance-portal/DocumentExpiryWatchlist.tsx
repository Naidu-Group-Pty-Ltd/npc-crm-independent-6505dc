import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, FileWarning, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function DocumentExpiryWatchlist({ withinDays = 30 }: { withinDays?: number }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['finance-portal-doc-expiring', withinDays],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-document-requirements', {
        operation: 'list_expiring', within_days: withinDays,
      });
      if (error) throw new Error(error.message);
      return (data?.items || []) as any[];
    },
    refetchInterval: 60000,
  });

  const items = data || [];

  const dayTone = (date: string) => {
    const days = Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
    if (days < 0) return { label: `${Math.abs(days)}d expired`, tone: 'bg-destructive/15 text-destructive' };
    if (days <= 7) return { label: `${days}d`, tone: 'bg-destructive/15 text-destructive' };
    if (days <= 14) return { label: `${days}d`, tone: 'bg-brand-500/15 text-brand-500' };
    return { label: `${days}d`, tone: 'bg-muted text-muted-foreground' };
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand-500" />
          Document expiry watchlist
          <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing expiring in the next {withinDays} days.</p>
        )}
        {items.slice(0, 8).map((it) => {
          const t = dayTone(it.soft_expiry_date);
          return (
            <Link
              key={it.id}
              to={`/finance/purchase-files/${it.purchase_file_id}?tab=documents`}
              className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/40 transition-colors"
            >
              <FileWarning className="h-4 w-4 text-brand-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{it.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {it.purchase_files?.title || '—'} · {it.category.replace(/_/g, ' ')}
                </p>
              </div>
              <span className={cn('text-xs px-1.5 py-0.5 rounded shrink-0', t.tone)}>{t.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          );
        })}
        {items.length > 8 && (
          <p className="text-xs text-muted-foreground text-center pt-1">+ {items.length - 8} more</p>
        )}
      </CardContent>
    </Card>
  );
}
