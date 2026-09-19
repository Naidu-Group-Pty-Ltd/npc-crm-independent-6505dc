/**
 * ReportCostBadge — shows the per-report credit cost pulled from the
 * Mission Control pricing catalog. Drop next to a report-type picker:
 *   <ReportCostBadge slug="full-property-report" />
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Coins } from 'lucide-react';
import { getReportCreditCost } from '@/lib/missionControlCatalog';
import { cn } from '@/lib/utils';

interface Props {
  slug: string;
  className?: string;
  /** Fallback to show while loading / when catalog has no entry. */
  fallback?: number | null;
}

export function ReportCostBadge({ slug, className, fallback = null }: Props) {
  const [cost, setCost] = useState<number | null>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getReportCreditCost(slug).then((c) => {
      if (!alive) return;
      setCost(c ?? fallback);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [slug, fallback]);

  if (loading && cost == null) return null;
  if (cost == null) return null;

  return (
    <Badge variant="secondary" className={cn('gap-1', className)}>
      <Coins className="h-3 w-3" />
      {cost} {cost === 1 ? 'credit' : 'credits'}
    </Badge>
  );
}
