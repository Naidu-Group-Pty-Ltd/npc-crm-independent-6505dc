/**
 * Choose what data fills the preview: the sample engagement, or one of your
 * own past reports.
 *
 * ## Why real data is offered at all
 *
 * Sample data proves the *design*. It cannot tell an adviser how the template
 * handles their own numbers — a suburb name that runs two lines, a portfolio
 * with three holdings rather than five, a report where the market section was
 * never filled in. Rendering a real historical report answers that, and it is
 * the difference between "this looks nice" and "this works for my files".
 *
 * ## Every production format, through its own adapter
 *
 * This picker was hard-wired to `investment_reports` — one hook, one shim —
 * for as long as the adapter interface had no way to list. So a Borrowing
 * Capacity template's card said "production ready" while its preview could
 * only ever show sample data, for all nine formats but one. The adapter is
 * now the whole surface: `listRecentReports` fills the picker from the
 * format's own table, and `buildBindingContext` loads the chosen report —
 * the identical call the production route makes, so what the preview shows
 * is what a render would bind.
 *
 * ## Why sample data stays the default
 *
 * A real report populates only the namespaces its adapter emits. The
 * catalogue's templates also bind paths that a sparse row legitimately leaves
 * empty — 742 of 775 clients hold nothing financial — so a real-data preview
 * is legitimately patchy. Opening on it would make every template look
 * broken. So: sample by default, real on request, and the gap reported rather
 * than hidden.
 *
 * Nothing here widens access. Every adapter loads through the same table
 * reads (or, for investment, the same edge function) as the production render
 * path, under the caller's own session. A user who cannot read a table simply
 * sees no reports to choose from.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, TriangleAlert } from 'lucide-react';
import { getAdapter, type ReportListing } from '@/lib/reportTemplate/adapters';
import { SAMPLE_REPORT_DATA } from '@/lib/templateLibrary/sampleReportData';

export const SAMPLE_SOURCE = 'sample';

interface Props {
  /** The template's report type, which decides whether an adapter exists. */
  reportType: string | null;
  /** Bindings the template references, used to report real-data coverage. */
  requiredBindings: string[];
  /** Receives the data the preview should render with. */
  onData: (data: Record<string, unknown>, sourceLabel: string) => void;
}

function coverage(data: Record<string, unknown>, bindings: string[]): number {
  if (bindings.length === 0) return 1;
  const read = (path: string) => path.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), data,
  );
  const filled = bindings.filter((b) => {
    const v = read(b);
    return v !== undefined && v !== null && v !== '';
  }).length;
  return filled / bindings.length;
}

/** "12 Aug 2026", or nothing a bad timestamp could turn into "Invalid Date". */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TemplateDataSource({ reportType, requiredBindings, onData }: Props) {
  const [source, setSource] = useState<string>(SAMPLE_SOURCE);
  const [reports, setReports] = useState<ReportListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [realCoverage, setRealCoverage] = useState<number | null>(null);

  const adapter = getAdapter(reportType);
  const adapterExists = !!adapter?.supportsProduction;

  // Load the picker's options once, and only for templates that could use
  // them. An adapter without a lister degrades to sample-only rather than
  // hiding the control's honesty about what the preview shows.
  useEffect(() => {
    if (!adapterExists || reports !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await adapter?.listRecentReports?.({ limit: 20 });
        if (!cancelled) setReports(rows ?? []);
      } catch {
        if (!cancelled) setReports([]);
      }
    })();
    return () => { cancelled = true; };
  }, [adapterExists, reports, adapter]);

  const choose = useCallback(async (next: string) => {
    setSource(next);
    setProblem(null);
    setRealCoverage(null);

    if (next === SAMPLE_SOURCE) {
      onData(SAMPLE_REPORT_DATA, 'sample data');
      return;
    }

    setLoading(true);
    try {
      // The identical call the production route makes for this format, so the
      // preview binds what a render would bind.
      const ctx = await adapter?.buildBindingContext({ reportId: next });
      if (!ctx?.data) {
        // Say which of the two it is: no permission, or nothing stored.
        setProblem('That report could not be loaded, or holds no data this template can use.');
        setSource(SAMPLE_SOURCE);
        onData(SAMPLE_REPORT_DATA, 'sample data');
        return;
      }
      const label = reports?.find((r) => r.id === next)?.label ?? 'your report';
      setRealCoverage(coverage(ctx.data as Record<string, unknown>, requiredBindings));
      onData(ctx.data as Record<string, unknown>, label);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That report could not be loaded.');
      setSource(SAMPLE_SOURCE);
      onData(SAMPLE_REPORT_DATA, 'sample data');
    } finally {
      setLoading(false);
    }
  }, [adapter, onData, reports, requiredBindings]);

  if (!adapterExists) return null;

  const missingPct = realCoverage === null ? null : Math.round((1 - realCoverage) * 100);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select value={source} onValueChange={choose} disabled={loading}>
        <SelectTrigger className="h-8 w-[13.5rem] text-xs" aria-label="Data used in this preview">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAMPLE_SOURCE}>Sample data</SelectItem>
          {(reports ?? []).map((r) => {
            const when = shortDate(r.savedAt);
            return (
              <SelectItem key={r.id} value={r.id} className="max-w-[22rem]">
                <span className="truncate">
                  {r.label}
                  {/* The date is what tells two assessments of one client
                      apart, so it rides every row rather than only ambiguous
                      ones. */}
                  {when && <span className="text-muted-foreground"> · {when}</span>}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}

      {problem && (
        <span className="flex items-center gap-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {problem}
        </span>
      )}

      {/* The honest bit: a real report rarely fills a whole template, and the
          reader should know that the gaps are missing data, not a broken
          template. */}
      {missingPct !== null && missingPct > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {missingPct}% of this template&apos;s fields are empty in that report
          <Button
            variant="link"
            size="sm"
            className="h-auto px-1.5 py-0 text-[11px]"
            onClick={() => choose(SAMPLE_SOURCE)}
          >
            Back to sample
          </Button>
        </span>
      )}
    </div>
  );
}
