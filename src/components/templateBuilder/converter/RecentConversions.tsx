/**
 * Earlier conversions, with a way back into each one.
 *
 * This exists because a conversion used to be write-only. The PDF goes to a
 * private bucket the browser has no access to, so once the page reloaded the
 * document was unreachable — the row and the file both became data nobody could
 * get at. "Where does the output go?" had no good answer.
 *
 * Every listing re-signs its links server-side, so a conversion from last week
 * opens as readily as the one made a minute ago.
 */
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2,
  ExternalLink,
  FileWarning,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  listConversions,
  RECENT_CONVERSIONS_QUERY_KEY,
} from '@/lib/reports/converted/requestTemplateConversion';
import {
  type ConversionTone,
  describeConversionRow,
} from '@/lib/reports/converted/conversionRows.pure';

interface Props {
  /** Rendered as a section heading. Omit inside an accordion that already has one. */
  heading?: string;
  limit?: number;
}

/** The glyph for a tone. Success, failure and in-flight read differently. */
function ToneGlyph({ tone }: { tone: ConversionTone }) {
  if (tone === 'success') return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />;
  if (tone === 'danger') return <FileWarning className="h-4 w-4 shrink-0 text-destructive" aria-hidden />;
  if (tone === 'info') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />;
  return <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/** A timestamp, or nothing. An unparseable date should print no date. */
function relativeTime(iso: string): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '';
  return formatDistanceToNow(at, { addSuffix: true });
}

export function RecentConversions({ heading = 'Earlier conversions', limit = 10 }: Props) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [...RECENT_CONVERSIONS_QUERY_KEY, limit],
    queryFn: async () => (await listConversions(limit)).conversions,
  });

  const conversions = data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {heading && <h3 className="text-sm font-medium">{heading}</h3>}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-xs"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching
            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : error ? (
        // Announced: this arrives after the page has settled, so a screen
        // reader would otherwise never learn the list failed to load.
        <p className="text-sm text-destructive" role="status" aria-live="polite">
          Earlier conversions could not be loaded. {(error as Error).message}
        </p>
      ) : conversions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing converted yet. A converted PDF is kept here so you can reopen it later.
        </p>
      ) : (
        <ul className="space-y-2">
          {conversions.map((row) => {
            const view = describeConversionRow(row);
            const when = relativeTime(row.createdAt);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <ToneGlyph tone={view.tone} />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs" title={view.title}>{view.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {view.statusLabel}{when ? ` · ${when}` : ''}
                    </p>
                    {view.chips.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {view.chips.map((chip) => (
                          <li key={chip}>
                            <Badge variant="outline" className="text-[10px]">{chip}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {view.error && (
                      <p className="mt-1 truncate text-xs text-destructive" title={view.error}>
                        {view.error}
                      </p>
                    )}
                  </div>
                </div>

                {/* Only when there is genuinely a link. An Open button that
                    404s is worse than no Open button. */}
                {view.canOpen && (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <a href={row.url ?? undefined} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Open
                      <span className="sr-only"> {view.title}</span>
                    </a>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
