import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDown, ArrowUp, Loader2, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import type { AssessmentListRow } from '@/hooks/useCiAssessments';

/**
 * Cross-assessment portfolio view.
 *
 * Reads the denormalised headline figures already stored on each assessment
 * rather than re-running the engine per row — the list page must stay fast,
 * and these numbers are exactly what the last calculation produced.
 */
export function PortfolioImpactTab({
  rows, loading,
}: {
  rows: AssessmentListRow[];
  loading: boolean;
}) {
  const navigate = useNavigate();

  const live = useMemo(
    () => rows.filter((row) => !row.archived_at && row.maximum_indicative_loan != null),
    [rows],
  );

  const totals = useMemo(() => {
    const requested = live.reduce((sum, row) => sum + (row.requested_loan ?? 0), 0);
    const capacity = live.reduce((sum, row) => sum + (row.maximum_indicative_loan ?? 0), 0);
    const lvrRows = live.filter((row) => (row.proposed_lvr ?? 0) > 0);
    const dscrRows = live.filter((row) => (row.proposed_dscr ?? 0) > 0);
    return {
      requested,
      capacity,
      headroom: capacity - requested,
      averageLvr: lvrRows.length ? lvrRows.reduce((sum, row) => sum + (row.proposed_lvr ?? 0), 0) / lvrRows.length : 0,
      averageDscr: dscrRows.length ? dscrRows.reduce((sum, row) => sum + (row.proposed_dscr ?? 0), 0) / dscrRows.length : 0,
    };
  }, [live]);

  const constraintCounts = useMemo(() => {
    const counts = new Map<string, number>();
    live.forEach((row) => {
      const key = row.binding_constraint ?? 'Not calculated';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [live]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading portfolio position…
      </div>
    );
  }

  if (!live.length) {
    return (
      <div className="ci-inline-empty">
        <div className="ci-inline-empty-copy">
          <p className="ci-inline-empty-title">No calculated assessments yet</p>
          <p className="ci-inline-empty-body">
            Run a calculation on an assessment to see how the proposed transactions sit against each
            other and where capacity is being constrained.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="ci-metric-strip">
        <div className="ci-metric-tile">
          <p className="ci-metric-label">Total requested</p>
          <p className="ci-metric-value">{formatMoney(toCents(totals.requested), { compact: true })}</p>
        </div>
        <div className="ci-metric-tile">
          <p className="ci-metric-label">Total indicative capacity</p>
          <p className="ci-metric-value">{formatMoney(toCents(totals.capacity), { compact: true })}</p>
        </div>
        <div className={cn('ci-metric-tile', totals.headroom < 0 && 'ci-metric-tile-alert')}>
          <p className="ci-metric-label">{totals.headroom >= 0 ? 'Aggregate headroom' : 'Aggregate shortfall'}</p>
          <p className="ci-metric-value">{formatMoney(toCents(Math.abs(totals.headroom)), { compact: true })}</p>
        </div>
        <div className="ci-metric-tile">
          <p className="ci-metric-label">Average LVR</p>
          <p className="ci-metric-value">{formatRatioPercent(totals.averageLvr)}</p>
        </div>
        <div className="ci-metric-tile">
          <p className="ci-metric-label">Average DSCR</p>
          <p className="ci-metric-value">{formatMultiple(totals.averageDscr)}</p>
        </div>
      </dl>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Where capacity is constrained</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The binding constraint on each calculated assessment. A cluster on one constraint usually
          points at an assumption worth revisiting rather than a run of unrelated deals.
        </p>
        <ul className="mt-3 space-y-1.5">
          {constraintCounts.map(([constraint, count]) => (
            <li key={constraint} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground">{constraint}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {count} assessment{count === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="ci-table-wrap" role="region" aria-label="Assessment capacity comparison" tabIndex={0}>
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Assessment</TableHead>
              <TableHead className="text-right">Requested</TableHead>
              <TableHead className="text-right">Capacity</TableHead>
              <TableHead className="text-right">Headroom</TableHead>
              <TableHead className="text-right">LVR</TableHead>
              <TableHead className="text-right">DSCR</TableHead>
              <TableHead>Binding constraint</TableHead>
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {live.map((row) => {
              const headroom = (row.maximum_indicative_loan ?? 0) - (row.requested_loan ?? 0);
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium text-foreground">{row.title}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(toCents(row.requested_loan ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(toCents(row.maximum_indicative_loan ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className={cn('inline-flex items-center gap-1', headroom > 0 ? 'ci-delta-up' : headroom < 0 ? 'ci-delta-down' : 'text-muted-foreground')}>
                      {headroom > 0
                        ? <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        : headroom < 0
                          ? <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          : <Minus className="h-3 w-3" aria-hidden="true" />}
                      <span className="sr-only">{headroom >= 0 ? 'Headroom of' : 'Shortfall of'}</span>
                      {formatMoney(toCents(Math.abs(headroom)))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.proposed_lvr ? formatRatioPercent(row.proposed_lvr) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.proposed_dscr ? formatMultiple(row.proposed_dscr) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.binding_constraint ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => navigate(`/commercial/assessments/${row.id}?step=results`)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
