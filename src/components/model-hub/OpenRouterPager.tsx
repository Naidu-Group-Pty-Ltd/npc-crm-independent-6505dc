import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number | 'all';
  onPage: (p: number) => void;
  onPageSize: (s: number | 'all') => void;
}

function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('gap');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('gap');
  out.push(total);
  return out;
}

const SIZES: (number | 'all')[] = [24, 48, 96, 'all'];

export function OpenRouterPager({ page, pageCount, total, pageSize, onPage, onPageSize }: Props) {
  const [jump, setJump] = useState('');
  const window = useMemo(() => pageWindow(page, pageCount), [page, pageCount]);

  return (
    <div className="flex flex-col items-center justify-between gap-3 rounded-[20px] border border-border/40 bg-background/40 p-3 sm:flex-row">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {pageSize === 'all' ? (
            <>Showing all <span className="font-mono text-foreground">{total}</span> models</>
          ) : (
            <>Page <span className="font-mono text-foreground">{page}</span> of <span className="font-mono text-foreground">{pageCount}</span> · <span className="font-mono text-foreground">{total}</span> total</>
          )}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          {SIZES.map((s) => (
            <button
              key={String(s)}
              type="button"
              onClick={() => onPageSize(s)}
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors',
                pageSize === s ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary'
              )}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      {pageSize !== 'all' && pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {window.map((w, i) =>
            w === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <button
                key={w}
                type="button"
                onClick={() => onPage(w)}
                className={cn(
                  'h-8 min-w-8 rounded-full px-2 font-mono text-xs transition-colors',
                  w === page ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                )}
              >
                {w}
              </button>
            )
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page === pageCount} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>

          {pageCount > 10 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(jump);
                if (Number.isFinite(n) && n >= 1 && n <= pageCount) { onPage(Math.floor(n)); setJump(''); }
              }}
              className="ml-2 flex items-center gap-1"
            >
              <Input
                value={jump}
                onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Go to…"
                className="h-8 w-20 text-center font-mono text-xs"
                aria-label="Jump to page"
              />
            </form>
          )}
        </div>
      )}
    </div>
  );
}
