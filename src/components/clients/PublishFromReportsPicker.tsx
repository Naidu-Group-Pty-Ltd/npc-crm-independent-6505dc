import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import {
  BarChart3, Building2, CheckCircle2, FileSpreadsheet, FileText,
  Landmark, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  matchesReportSearch,
  publishableReports,
  type PublishVerdict,
  type UnifiedReport,
} from '@/lib/reports/clientReportInventory.pure';

/**
 * Choosing a report the workspace has already produced.
 *
 * The dialog beside this one takes a file off the operator's disk, which is
 * right for a document written somewhere else and wrong for the five formats
 * this product generates itself — those were downloaded and re-uploaded to
 * reach the same portal, and the copy that arrived was no longer the one on
 * the client's file.
 *
 * Three things this list is careful about:
 *
 *   • It shows what publishing WOULD do before it is done. A borrowing
 *     capacity assessment has no PDF until one is rendered, and saying so is
 *     the difference between a considered choice and a spinner.
 *   • It says when the client already has a report, and does not refuse it.
 *     Re-issuing after a correction is legitimate and the operator is the one
 *     who knows.
 *   • A report it cannot publish is not listed at all, rather than listed and
 *     refused on click.
 */

const ICONS: Record<string, typeof FileText> = {
  formara: FileSpreadsheet,
  portfolio: BarChart3,
  borrowing: Landmark,
  property: Building2,
  investment: Building2,
};

const KIND_LABEL: Record<string, string> = {
  formara: 'Client form',
  portfolio: 'Portfolio',
  borrowing: 'Borrowing capacity',
  property: 'Property',
  investment: 'Investment',
};

interface Props {
  reports: UnifiedReport[];
  publishedFiles: Map<string, string | null>;
  selectedId: string | null;
  onSelect: (report: UnifiedReport, verdict: PublishVerdict) => void;
}

export function PublishFromReportsPicker({ reports, publishedFiles, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const candidates = useMemo(
    () => publishableReports(reports, publishedFiles),
    [reports, publishedFiles],
  );

  const visible = useMemo(
    () => candidates.filter(({ report }) => matchesReportSearch(report, query)),
    [candidates, query],
  );

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          Nothing has been generated for this client yet.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Reports made on the Reports tab appear here, ready to publish without re-uploading them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search this client's reports…"
        aria-label="Search this client's reports"
        className="h-9 text-sm"
        iconClassName="left-2.5 h-3.5 w-3.5"
      />

      <div
        role="radiogroup"
        aria-label="Reports ready to publish"
        className="max-h-[19rem] space-y-1.5 overflow-y-auto pr-1"
      >
        {visible.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No report matches “{query}”.
          </p>
        )}

        {visible.map(({ report, verdict }) => {
          const Icon = ICONS[report.type] ?? FileText;
          const selected = selectedId === report.id;
          return (
            <button
              key={`${report.source}-${report.id}`}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(report, verdict)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                selected
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border/70 hover:border-primary/40 hover:bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-md p-1.5',
                  selected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{report.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {KIND_LABEL[report.type] ?? report.type}
                  </Badge>
                  {verdict.alreadyPublished && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                      Already shared
                    </Badge>
                  )}
                  {verdict.readiness === 'on_publish' && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Sparkles className="h-2.5 w-2.5" />
                      Made on publish
                    </Badge>
                  )}
                </span>

                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span>{format(new Date(report.generatedAt), 'dd MMM yyyy')}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDistanceToNow(new Date(report.generatedAt), { addSuffix: true })}</span>
                  {report.propertyAddress && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{report.propertyAddress}</span>
                    </>
                  )}
                </span>

                <span className="mt-0.5 block text-[11px] text-muted-foreground">{verdict.reason}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
