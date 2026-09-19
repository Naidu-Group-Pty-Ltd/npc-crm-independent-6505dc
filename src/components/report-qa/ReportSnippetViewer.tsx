import { useEffect, useMemo, useRef } from 'react';
import { FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { DocumentCitation } from './Citations';

interface ReportSnippetViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportName: string | null;
  reportContent: string | null;
  citation: DocumentCitation | null;
}

/**
 * Escape user-supplied text for safe interpolation inside a RegExp.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pulls the page-scoped excerpt out of a full report's extracted text.
 * Chunks were tagged with `[Page N]` markers during ingestion, so we
 * split on those markers and return only the cited page when known.
 */
function getPageScopedContent(
  content: string,
  page: number | null | undefined,
): { body: string; pageLabel: string | null } {
  if (!content) return { body: '', pageLabel: null };
  if (!page) return { body: content, pageLabel: null };

  const marker = new RegExp(`\\[Page\\s+${page}\\]`, 'i');
  const match = content.match(marker);
  if (!match || match.index == null) {
    return { body: content, pageLabel: `Page ${page}` };
  }

  const start = match.index;
  const rest = content.slice(start + match[0].length);
  const nextMarker = rest.match(/\[Page\s+\d+\]/i);
  const body = nextMarker
    ? rest.slice(0, nextMarker.index ?? rest.length)
    : rest;

  return { body: body.trim(), pageLabel: `Page ${page}` };
}

/**
 * Splits `body` around the snippet so we can render the highlight with
 * a stable ref for auto-scroll. Falls back to the longest contiguous
 * window of the snippet if an exact match isn't present.
 */
function locateSnippet(body: string, snippet?: string) {
  if (!snippet) return { before: body, hit: '', after: '' };

  const trimmed = snippet.trim();
  if (!trimmed) return { before: body, hit: '', after: '' };

  const tryMatch = (needle: string) => {
    const re = new RegExp(escapeRegex(needle), 'i');
    const m = body.match(re);
    if (!m || m.index == null) return null;
    return {
      before: body.slice(0, m.index),
      hit: body.slice(m.index, m.index + m[0].length),
      after: body.slice(m.index + m[0].length),
    };
  };

  const exact = tryMatch(trimmed);
  if (exact) return exact;

  // Fall back: try progressively shorter prefixes of the snippet so we
  // still highlight something close to the source paragraph.
  const words = trimmed.split(/\s+/);
  for (let len = Math.min(words.length, 12); len >= 4; len--) {
    const candidate = words.slice(0, len).join(' ');
    const hit = tryMatch(candidate);
    if (hit) return hit;
  }

  return { before: body, hit: '', after: '' };
}

export function ReportSnippetViewer({
  open,
  onOpenChange,
  reportName,
  reportContent,
  citation,
}: ReportSnippetViewerProps) {
  const highlightRef = useRef<HTMLSpanElement>(null);

  const { body, pageLabel } = useMemo(
    () => getPageScopedContent(reportContent ?? '', citation?.page_number ?? null),
    [reportContent, citation?.page_number],
  );

  const { before, hit, after } = useMemo(
    () => locateSnippet(body, citation?.snippet),
    [body, citation?.snippet],
  );

  // Scroll the highlighted span into view after the dialog paints.
  useEffect(() => {
    if (!open || !hit) return;
    const id = window.setTimeout(() => {
      highlightRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    return () => window.clearTimeout(id);
  }, [open, hit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <span className="truncate">{reportName ?? 'Report'}</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {pageLabel && <Badge variant="secondary">{pageLabel}</Badge>}
              {citation?.paragraph_index != null && (
                <Badge variant="secondary">¶ {citation.paragraph_index}</Badge>
              )}
              {typeof citation?.similarity === 'number' && (
                <Badge variant="outline">
                  relevance {(citation.similarity * 100).toFixed(0)}%
                </Badge>
              )}
              {!hit && citation?.snippet && (
                <span className="text-xs text-muted-foreground">
                  Exact snippet not found — showing closest section.
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 rounded-md border bg-muted/30">
          <div className="p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
            {body ? (
              <>
                <span className="opacity-80">{before}</span>
                {hit && (
                  <span
                    ref={highlightRef}
                    className="bg-primary/25 text-foreground rounded px-1 py-0.5 ring-1 ring-primary/40"
                  >
                    {hit}
                  </span>
                )}
                <span className="opacity-80">{after}</span>
              </>
            ) : (
              <span className="text-muted-foreground italic">
                No extracted text available for this report.
              </span>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
