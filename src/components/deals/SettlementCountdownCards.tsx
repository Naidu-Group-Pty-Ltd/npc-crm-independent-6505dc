import { useMemo } from 'react';
import { differenceInDays, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Clock, CalendarDays, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { stageDisplayOf } from '@/lib/deals/dealJourney.pure';

interface Props {
  deals: DealWithClient[];
  onDealClick?: (deal: DealWithClient) => void;
}

export function SettlementCountdownCards({ deals, onDealClick }: Props) {
  const upcoming = useMemo(() => {
    const now = new Date();
    return deals
      // A settlement marked complete on the deal is settled, not counting down.
      .filter(d => d.settlement_date && !d.critical_date_completions?.settlement_date)
      .map(d => ({
        deal: d,
        daysUntil: differenceInDays(new Date(d.settlement_date!), now),
      }))
      .filter(d => d.daysUntil >= -7) // include up to 7 days overdue
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 8);
  }, [deals]);

  const getBucket = (days: number) => {
    if (days < 0) return { label: 'OVERDUE', color: 'bg-destructive/10 border-destructive/30 text-destructive', ring: 'ring-destructive/20' };
    if (days <= 7) return { label: '7 DAYS', color: 'bg-destructive/10 border-destructive/30 text-destructive', ring: 'ring-destructive/20' };
    if (days <= 14) return { label: '14 DAYS', color: 'bg-brand-500/10 border-brand-500/30 text-brand-600', ring: 'ring-brand-500/20' };
    if (days <= 30) return { label: '30 DAYS', color: 'bg-info/10 border-info/30 text-info', ring: 'ring-info/20' };
    return { label: `${days}d`, color: 'bg-muted border-border text-muted-foreground', ring: '' };
  };

  if (upcoming.length === 0) return null;

  return (
    <Card className="overflow-hidden border-brand-200/15 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(24,24,27,0.86))] shadow-[0_18px_46px_rgba(0,0,0,0.22)]">
      <CardHeader className="pb-2 pt-3 px-3 sm:px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" />
          Settlement Countdown
          <Badge variant="outline" className="text-[10px] ml-auto">{upcoming.length} upcoming</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 sm:px-4 pb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {upcoming.map(({ deal, daysUntil }) => {
            const bucket = getBucket(daysUntil);
            return (
              <div
                key={deal.id}
                className={cn(
                  'rounded-lg border p-2.5 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/45 hover:shadow-[0_14px_30px_rgba(0,0,0,0.22),0_0_18px_rgba(245,158,11,0.14)]',
                  bucket.color,
                  onDealClick && 'hover:ring-2 ' + bucket.ring
                )}
                onClick={() => onDealClick?.(deal)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold truncate max-w-[120px]">{deal.client_name}</span>
                  <span className={cn('text-[10px] font-bold', daysUntil < 0 ? 'text-destructive' : '')}>
                    {daysUntil < 0 ? (
                      <span className="flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />{Math.abs(daysUntil)}d late</span>
                    ) : daysUntil === 0 ? 'TODAY' : `${daysUntil}d`}
                  </span>
                </div>
                <p className="text-[10px] opacity-80 truncate">{deal.property_address || stageDisplayOf(deal)}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] opacity-70">
                    <CalendarDays className="h-3 w-3 inline mr-0.5" />
                    {format(new Date(deal.settlement_date!), 'dd MMM yyyy')}
                  </span>
                  {deal.total_contract_price && (
                    <span className="text-[10px] font-mono opacity-80">
                      ${(deal.total_contract_price / 1000).toFixed(0)}k
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
