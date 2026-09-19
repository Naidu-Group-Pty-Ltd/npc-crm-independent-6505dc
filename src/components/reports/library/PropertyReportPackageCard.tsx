import { useId, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, MapPin, Package } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ReportTypeBadge } from '@/components/reports/ReportTypeBadge';
import { InvestmentReportCard } from './InvestmentReportCard';
import type { InvestmentReport } from './types';
import { normalizeReportVariant, REPORT_VARIANT_ORDER, resolveInvestmentReportType, type ReportVariant } from '@/lib/reports/reportVariants';
import type { ReportTier } from '@/components/reports/TierBadge';
import { Button } from '@/components/ui/button';
import { resolveInvestmentGrade } from '@/components/reports/report-view/utils';
import { InvestmentGradeSummary } from './InvestmentGradeSummary';
import { resolveReportAddress } from '@/lib/reports/reportAddress';

type Props = Omit<React.ComponentProps<typeof InvestmentReportCard>, 'report' | 'isSelected' | 'generatingTier' | 'comparisonSelectable' | 'activeComparisonType'> & { reports: InvestmentReport[]; isSelected: (id: string) => boolean; generatingTier: { reportId: string; tier: ReportTier } | null; activeComparisonType: ReportVariant | null; canSelectReport: (report: Pick<InvestmentReport, 'id' | 'report_tier'>) => boolean; onTogglePackageArchive?: (reports: InvestmentReport[]) => void };

export function PropertyReportPackageCard({ reports, isSelected, generatingTier, activeComparisonType, canSelectReport, onTogglePackageArchive, ...cardProps }: Props) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const ordered = [...reports].sort((a, b) => REPORT_VARIANT_ORDER.indexOf(normalizeReportVariant(a)) - REPORT_VARIANT_ORDER.indexOf(normalizeReportVariant(b)) || +new Date(b.created_at) - +new Date(a.created_at));
  const availableVariants = REPORT_VARIANT_ORDER.filter((variant) => ordered.some((report) => resolveInvestmentReportType(report) === variant));
  const latest = ordered.reduce((newest, item) => new Date(item.created_at) > new Date(newest.created_at) ? item : newest, ordered[0]);
  const fullAddress = resolveReportAddress(latest);
  const packageArchived = ordered.length > 0 && ordered.every(report => report.is_archived === true);
  const resolvedGrade = resolveInvestmentGrade(ordered as any);
  const toggle = () => setOpen(value => !value);
  const onHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  };

  return <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 hover:border-primary/60 hover:bg-card hover:shadow-md hover:shadow-primary/10 dark:bg-background/70">
    <CardHeader
      className="cursor-pointer p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-controls={contentId}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${ordered.length} reports for ${fullAddress}`}
      onClick={toggle}
      onKeyDown={onHeaderKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="shrink-0 rounded-xl border border-border/60 bg-primary/5 p-2 text-primary"><MapPin className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-lg font-semibold leading-snug" title={fullAddress}>{fullAddress}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Latest {format(new Date(latest.created_at), 'PPp')} · {latest.status || 'completed'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${availableVariants.length} available report types`}>{availableVariants.map(variant => <ReportTypeBadge key={variant} type={variant} />)}</div>
            <InvestmentGradeSummary grade={resolvedGrade} variant="compact" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
        {cardProps.canEditReports && onTogglePackageArchive && <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10 hover:text-primary" aria-label={`${packageArchived ? 'Restore' : 'Archive'} property package ${fullAddress}`} onClick={(event) => { event.stopPropagation(); onTogglePackageArchive(ordered); }}><span className="sr-only">{packageArchived ? 'Restore property package' : 'Archive property package'}</span>{packageArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button>}
        <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-sm font-medium" aria-hidden="true">
          <Package className="h-4 w-4" />{ordered.length}
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </div>
        </div>
      </div>
    </CardHeader>
    <div id={contentId} className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="overflow-hidden">
        <CardContent className="border-t border-border/60 bg-muted/15 p-4"><div className="grid gap-4">{ordered.map(report => <InvestmentReportCard key={report.id} {...cardProps} report={report} siblingReports={ordered} isSelected={isSelected(report.id)} comparisonSelectable={canSelectReport(report)} activeComparisonType={activeComparisonType} generatingTier={generatingTier?.reportId === report.id ? generatingTier.tier : null} />)}</div></CardContent>
      </div>
    </div>
  </Card>;
}
