/**
 * PDF Extraction V3 · E11 — virtualized page navigator.
 *
 * A windowed list of compact page summaries with filters, search and status
 * badges. Supports 25- and 80-page documents without rendering every row (a
 * deterministic scroll-window renders only the visible slice + overscan above a
 * threshold; small lists render fully). Keyboard: Up/Down move selection, Enter
 * opens, "d" jumps to the next page with a hard defect, "u" to the next
 * unreviewed page. No private page text is searched from the list.
 */
import { useMemo, useRef, useState, useCallback } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PdfPageReviewSummaryV1, PageOutputStrategy } from '@/lib/reportTemplate/pdfImport/review';
import { pageStrategyLabel, pageScreenReaderSummary } from '@/lib/reportTemplate/pdfImport/review/statusLanguage';
import { toneToBadgeVariant } from './reviewTone';

export type NavigatorFilter =
  | 'all' | 'needs-review' | 'hard-defects' | 'native' | 'mixed' | 'raster-only'
  | 'blocked' | 'repaired' | 'provider-assisted' | 'unscored' | 'cache-replay';

const FILTERS: Array<{ id: NavigatorFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'hard-defects', label: 'Hard defects' },
  { id: 'native', label: 'Native' },
  { id: 'mixed', label: 'Mixed' },
  { id: 'raster-only', label: 'Raster-only' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'repaired', label: 'Repaired' },
  { id: 'provider-assisted', label: 'Provider-assisted' },
  { id: 'unscored', label: 'Unscored' },
  { id: 'cache-replay', label: 'Cache replay' },
];

function matchesFilter(p: PdfPageReviewSummaryV1, filter: NavigatorFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'needs-review': return p.manualReviewRequired;
    case 'hard-defects': return p.hardDefectCount > 0;
    case 'native': return p.pageStrategy === 'native';
    case 'mixed': return p.pageStrategy === 'mixed';
    case 'raster-only': return p.pageStrategy === 'raster-only';
    case 'blocked': return p.pageStrategy === 'blocked';
    case 'repaired': return p.repaired;
    case 'provider-assisted': return p.providerAssisted;
    case 'unscored': return p.score === null;
    case 'cache-replay': return p.cacheReplayed === true;
    default: return true;
  }
}

/** Safe search over page number / service class / region type only (no private text). */
function matchesSearch(p: PdfPageReviewSummaryV1, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (String(p.pageNumber) === needle || String(p.pageNumber).includes(needle)) return true;
  if ((p.serviceClass ?? '').toLowerCase().includes(needle)) return true;
  return p.regionTypes.some((t) => t.toLowerCase().includes(needle));
}

interface Props {
  pages: PdfPageReviewSummaryV1[];
  selectedPageNumber: number | null;
  onSelect: (pageNumber: number) => void;
}

export function PdfPageNavigator({ pages, selectedPageNumber, onSelect }: Props) {
  const [filter, setFilter] = useState<NavigatorFilter>('all');
  const [query, setQuery] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => pages.filter((p) => matchesFilter(p, filter) && matchesSearch(p, query)),
    [pages, filter, query],
  );

  // Windowed rendering: only large lists window (small lists render fully). A
  // deterministic slice from scrollTop + a fixed row height keeps large documents
  // from mounting every row, and behaves identically under jsdom and a browser.
  const ROW_H = 52;
  const OVERSCAN = 8;
  const DEFAULT_VIEWPORT_H = 600;
  const VIRTUALIZE_THRESHOLD = 30;
  const virtualized = visible.length > VIRTUALIZE_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(DEFAULT_VIEWPORT_H);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    const h = e.currentTarget.clientHeight;
    if (h > 0) setViewportH(h);
  }, []);

  const startIdx = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const endIdx = virtualized ? Math.min(visible.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN) : visible.length;
  const windowSlice = virtualized ? visible.slice(startIdx, endIdx) : visible;

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((p) => p.pageNumber === selectedPageNumber);
    if (e.key === 'ArrowDown') { e.preventDefault(); onSelect(visible[Math.min(visible.length - 1, idx + 1)].pageNumber); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onSelect(visible[Math.max(0, idx - 1)].pageNumber); }
    else if (e.key.toLowerCase() === 'd') {
      const next = visible.slice(idx + 1).find((p) => p.hardDefectCount > 0) ?? visible.find((p) => p.hardDefectCount > 0);
      if (next) { e.preventDefault(); onSelect(next.pageNumber); }
    } else if (e.key.toLowerCase() === 'u') {
      const next = visible.slice(idx + 1).find((p) => p.manualReviewRequired) ?? visible.find((p) => p.manualReviewRequired);
      if (next) { e.preventDefault(); onSelect(next.pageNumber); }
    }
  }, [visible, selectedPageNumber, onSelect]);

  return (
    <div className="flex h-full flex-col gap-2" data-testid="pdf-review-page-list">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Page #, service class, region type"
        aria-label="Search pages by number, service class or region type"
        className="h-8 text-xs"
        data-testid="pdf-review-page-search"
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Page filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
              filter === f.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground">{visible.length} of {pages.length} pages</div>
      <div
        ref={parentRef}
        role="listbox"
        aria-label="Pages"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {virtualized ? (
          <div style={{ height: `${visible.length * ROW_H}px`, position: 'relative', width: '100%' }}>
            {windowSlice.map((p, i) => (
              <PageRow
                key={p.pageId}
                p={p}
                selected={p.pageNumber === selectedPageNumber}
                onSelect={onSelect}
                style={{ position: 'absolute', left: 0, top: 0, height: `${ROW_H}px`, transform: `translateY(${(startIdx + i) * ROW_H}px)` }}
              />
            ))}
          </div>
        ) : (
          windowSlice.map((p) => (
            <PageRow key={p.pageId} p={p} selected={p.pageNumber === selectedPageNumber} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}

function PageRow({ p, selected, onSelect, style }: {
  p: PdfPageReviewSummaryV1;
  selected: boolean;
  onSelect: (pageNumber: number) => void;
  style?: React.CSSProperties;
}) {
  const strat = pageStrategyLabel(p.pageStrategy);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={pageScreenReaderSummary(p.pageNumber, p.pageStrategy, p.hardDefectCount, p.manualReviewRequired)}
      onClick={() => onSelect(p.pageNumber)}
      data-testid={`pdf-review-page-${p.pageNumber}`}
      className={cn(
        'flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-xs',
        selected ? 'bg-accent' : 'hover:bg-muted/50',
      )}
      style={style}
    >
      <span className="w-8 shrink-0 font-mono text-[11px] text-muted-foreground">p{p.pageNumber}</span>
      <Badge variant={toneToBadgeVariant(strat.tone)} className="shrink-0 px-1 py-0 text-[9px]">{p.pageStrategy}</Badge>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {p.score === null ? '—' : `${Math.round(p.score * 100)}%`}
      </span>
      <span className="flex flex-1 items-center justify-end gap-1">
        {p.hardDefectCount > 0 && (
          <Badge variant="destructive" className="gap-0.5 px-1 py-0 text-[9px]">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />{p.hardDefectCount}
          </Badge>
        )}
        {p.cacheReplayed === true && <RotateCcw className="h-3 w-3 text-muted-foreground" aria-label="Cache replay" />}
        {p.manualReviewRequired && <span className="h-2 w-2 rounded-full bg-[hsl(var(--warning))]" aria-label="Review required" />}
      </span>
    </button>
  );
}
