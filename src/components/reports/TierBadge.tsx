import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { REPORT_TYPE_CONFIG, type ReportVariant } from '@/lib/reports/reportVariants';

export type ReportTier = ReportVariant;
interface TierBadgeProps { tier: ReportTier; className?: string; showIcon?: boolean; size?: 'sm' | 'md' | 'lg'; }

/** Legacy API retained while consuming the shared canonical report-type configuration. */
export const TIER_INFO = Object.fromEntries((Object.keys(REPORT_TYPE_CONFIG) as Array<keyof typeof REPORT_TYPE_CONFIG>).filter((tier): tier is ReportTier => tier !== 'other').map(tier => [tier, {
  name: REPORT_TYPE_CONFIG[tier].label,
  shortName: REPORT_TYPE_CONFIG[tier].label,
  description: `${REPORT_TYPE_CONFIG[tier].label} report`,
  pages: tier === 'compass' ? '~40' : tier === 'snapshot' ? '4-5' : '~20',
  icon: REPORT_TYPE_CONFIG[tier].icon,
  color: REPORT_TYPE_CONFIG[tier].className,
  badgeVariant: 'outline' as const,
}])) as Record<ReportTier, { name: string; shortName: string; description: string; pages: string; icon: typeof REPORT_TYPE_CONFIG.compass.icon; color: string; badgeVariant: 'outline' }>;

export function TierBadge({ tier, className, showIcon = true, size = 'md' }: TierBadgeProps) {
  const info = TIER_INFO[tier]; const Icon = info.icon;
  const sizeClasses = { sm: 'text-xs py-0.5 px-1.5', md: 'text-xs py-1 px-2', lg: 'text-sm py-1.5 px-3 font-medium' };
  const iconSizes = { sm: 'h-3 w-3', md: 'h-3 w-3', lg: 'h-4 w-4' };
  return <Badge variant="outline" className={cn(info.color, 'gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2', sizeClasses[size], className)}>{showIcon && <Icon className={iconSizes[size]} />}{info.shortName}</Badge>;
}
export function getTierDisplayName(tier: ReportTier): string { return TIER_INFO[tier]?.name || 'Other'; }
export function getTierPages(tier: ReportTier): string { return TIER_INFO[tier]?.pages || 'N/A'; }
