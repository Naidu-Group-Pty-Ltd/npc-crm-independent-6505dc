import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { REPORT_TYPE_CONFIG, type ReportType } from '@/lib/reports/reportVariants';

export function ReportTypeBadge({ type = 'other', className }: { type?: ReportType; className?: string }) {
  const config = REPORT_TYPE_CONFIG[type];
  return <Badge variant="outline" className={cn('gap-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2', config.className, className)}>{config.label}</Badge>;
}
