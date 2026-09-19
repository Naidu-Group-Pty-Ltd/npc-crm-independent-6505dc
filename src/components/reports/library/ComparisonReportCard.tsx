import { format } from 'date-fns';
import { Archive, ArchiveRestore, Calendar, Camera, Compass, Crown, DollarSign, Eye, FileText, Gauge, MapPin, Scale, Target, Trophy, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { ComparisonDownloadButton } from '@/components/reports/ComparisonDownloadButton';
import { describeComparisonType, type ComparisonTypeKey } from './comparisonTypeDescriptor.pure';
import type { ComparisonAnalysis } from './types';

interface ComparisonReportCardProps {
  comparison: ComparisonAnalysis & { is_archived?: boolean };
  generatorLabel: (id?: string | null) => string;
  onView: (comparison: ComparisonAnalysis) => void;
  onToggleArchive: (comparisonId: string, archive: boolean) => void;
}

/** One icon per comparison family; the untyped fallback keeps the scales. */
const TYPE_ICONS: Record<ComparisonTypeKey, typeof Scale> = {
  compass: Compass,
  briefing: FileText,
  snapshot: Camera,
  financial: DollarSign,
  strategic: Target,
};

export function ComparisonReportCard({ comparison, generatorLabel, onView, onToggleArchive }: ComparisonReportCardProps) {
  const topRanked = comparison.rankings?.[0]?.address || (comparison.rankings?.[0]?.propertyNumber ? `Property #${comparison.rankings[0].propertyNumber}` : 'Not ranked');
  const states = comparison.property_states && comparison.property_states.length > 0
    ? comparison.property_states.join(', ')
    : 'No states listed';
  // Which report family this row compares — "Compass Comparison", "Briefing
  // Comparison", "Snapshot Comparison", … The label carries the identity; the
  // tint only reinforces it, so nothing depends on colour alone.
  const type = describeComparisonType(comparison.comparison_type);
  const TypeIcon = type.key ? TYPE_ICONS[type.key] : Scale;

  return (
    <Card className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10 dark:bg-background/70">
      <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-success/10 blur-3xl opacity-0 transition-opacity group-hover:opacity-100" />

      <CardHeader className="relative space-y-4 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <Badge variant="secondary" title={type.blurb} className={`gap-1 text-xs ${type.badgeClassName}`}>
            <TypeIcon className="h-3 w-3" />
            {type.label}
          </Badge>
          <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{format(new Date(comparison.created_at), "MMM dd, yyyy · h:mm a")}</span>
          </div>

        </div>

        <div className="space-y-2">
          <h3 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-foreground">
            {comparison.report_title || `${comparison.property_count} Property Comparison`}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              Created by {generatorLabel(comparison.created_by)}
            </span>
            {comparison.analysis_depth && (
              <Badge variant="outline" className="gap-1 text-[10px] font-normal capitalize">
                <Gauge className="h-3 w-3" />
                {comparison.analysis_depth} depth
              </Badge>
            )}
            {comparison.investor_profile && (
              <Badge variant="outline" className="text-[10px] font-normal capitalize">
                {comparison.investor_profile} investor
              </Badge>
            )}
          </div>
          {comparison.executive_summary ? (
            <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{comparison.executive_summary}</p>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">No executive summary available yet.</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="relative space-y-4 px-4 pb-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <MetricTile label="Properties" value={comparison.property_count} icon={MapPin} />
          <MetricTile label="States" value={states} icon={Crown} />
          <MetricTile label="Top Ranked" value={topRanked} icon={Trophy} />
        </div>
      </CardContent>

      <CardFooter className="relative flex gap-2 border-t border-border/60 bg-muted/20 p-4">
        <Button variant="default" size="sm" onClick={() => onView(comparison)} className="flex-1 gap-1.5 rounded-xl">
          <Eye className="h-3.5 w-3.5" />
          View Analysis
        </Button>
        {/*
          The download this card has never had. Every saved comparison shows here,
          and until now the only way to get a PDF of one was to open the viewer —
          which fires a metered AI call before it will show you a button. The
          second item in this menu opens that viewer, and says what it costs.
        */}
        <ComparisonDownloadButton
          appearance="menu"
          variant="outline"
          size="sm"
          className="rounded-xl px-3"
          comparisonId={comparison.id}
          onOpenLegacy={() => onView(comparison)}
          triggerLabel="Download this comparison"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onToggleArchive(comparison.id, !comparison.is_archived)}
          title={comparison.is_archived ? 'Restore comparison' : 'Archive comparison'}
          className="gap-1.5 rounded-xl px-3"
        >
          {comparison.is_archived ? <ArchiveRestore className="h-3.5 w-3.5 text-success" /> : <Archive className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{comparison.is_archived ? 'Restore' : 'Archive'}</span>
        </Button>
      </CardFooter>
    </Card>
  );
}

function MetricTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof MapPin }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-background/65 p-3 shadow-inner shadow-sm dark:shadow-black/5">
      <div className="mb-2 flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</span>
        <Icon className="h-3.5 w-3.5 text-success/80 dark:text-success/80" />
      </div>
      <div className="truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
