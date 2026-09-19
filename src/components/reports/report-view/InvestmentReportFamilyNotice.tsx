/**
 * "Is this document still true to its parent?" — answered on the page, with
 * the repair one click away.
 *
 * A sub-report is a projection of the Compass base at a moment in time, and
 * nothing ever compared the two moments (audit F10): a parent regenerated —
 * or its overrides recalculated — and every Financial, Strategic, Briefing
 * and Snapshot kept presenting the old numbers with nothing on screen to say
 * so. Staleness is DERIVED server-side at read (subReportFamily.pure.ts) and
 * rendered here only when something is actually stale — a clean family shows
 * nothing, because a warning that cries on every page teaches people to
 * ignore the real one.
 *
 * Refresh regenerates only children that already EXIST — a refresh is not an
 * invitation to mint documents nobody asked for. Financial/Strategic refresh
 * through the deterministic fork (free); Briefing/Snapshot re-condense
 * through the model, which costs a generation — the button says how many
 * reports it touches.
 */
import { useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getReportVariantLabel } from '@/lib/reports/reportVariants';
import { generateSubReport, type ReportFamily, type SubReportVariant } from '@/lib/reports/subReports';

interface Props {
  family: ReportFamily | null;
  /** The report the page is showing. */
  currentReportId: string;
  /** Called after a refresh so the page can reload the fresh content. */
  onRefreshed: () => void | Promise<void>;
}

export function InvestmentReportFamilyNotice({ family, currentReportId, onRefreshed }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  if (!family || !family.parentId) return null;

  const viewingParent = family.parentId === currentReportId;
  const currentChild = family.children.find((c) => c.id === currentReportId);
  const staleHere = viewingParent ? family.staleChildren : currentChild?.stale ? [currentChild] : [];
  if (!staleHere.length) return null;

  const refreshTargets = staleHere.filter((c): c is typeof c & { variant: SubReportVariant } => c.variant !== null);
  const labels = refreshTargets.map((c) => getReportVariantLabel(c.variant));

  const handleRefresh = async () => {
    if (refreshing || !refreshTargets.length) return;
    setRefreshing(true);
    const failed: string[] = [];
    for (const child of refreshTargets) {
      try {
        await generateSubReport(family.parentId!, child.variant);
      } catch (err) {
        console.error(`Failed to refresh ${child.variant} report`, err);
        failed.push(getReportVariantLabel(child.variant));
      }
    }
    setRefreshing(false);
    if (failed.length) {
      toast.error(`Could not refresh: ${failed.join(', ')}`, {
        description: 'The existing reports were not changed. Please retry.',
      });
    } else {
      toast.success(refreshTargets.length > 1
        ? `${refreshTargets.length} sub-reports refreshed from the latest Compass data`
        : `${labels[0]} report refreshed from the latest Compass data`);
    }
    if (failed.length < refreshTargets.length) await onRefreshed();
  };

  return (
    <Alert className="border-warning/40 bg-warning/10">
      <TriangleAlert className="h-4 w-4 text-warning" />
      <AlertTitle>
        {viewingParent
          ? `${staleHere.length > 1 ? `${staleHere.length} sub-reports are` : `The ${labels[0]} report is`} older than this Compass report`
          : 'The Compass report this was generated from has changed'}
      </AlertTitle>
      <AlertDescription className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <span>
          {viewingParent
            ? `${labels.join(', ')} still ${staleHere.length > 1 ? 'present' : 'presents'} the data from before the last update. Refresh to bring ${staleHere.length > 1 ? 'them' : 'it'} in line.`
            : 'This document still presents the data from before that update. Refresh it to reflect the latest report.'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 bg-background/70"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing
            ? 'Refreshing…'
            : viewingParent && refreshTargets.length > 1
              ? `Refresh ${refreshTargets.length} sub-reports`
              : 'Refresh from latest data'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
