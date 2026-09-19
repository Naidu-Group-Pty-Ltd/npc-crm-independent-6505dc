import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * BulkActionBar — Phase 3 primitive.
 *
 * Floating, semantic-token-based selection bar. Slides up from the bottom
 * when `count > 0`. Respects `prefers-reduced-motion` via `motion-safe:`.
 *
 * Consumers keep their existing selection state — this primitive just
 * renders the surface consistently across list pages.
 */
export interface BulkActionBarProps {
  count: number;
  label?: string; // e.g. "selected" (default), or "listings selected"
  onClear: () => void;
  children?: React.ReactNode; // action buttons
  helper?: React.ReactNode; // optional secondary text below actions
  className?: string;
  anchor?: 'bottom' | 'inline';
}

export function BulkActionBar({
  count,
  label = 'selected',
  onClear,
  children,
  helper,
  className,
  anchor = 'bottom',
}: BulkActionBarProps) {
  if (count <= 0) return null;

  const wrapperPosition =
    anchor === 'bottom'
      ? 'fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0'
      : 'w-full';

  return (
    <div className={cn(wrapperPosition, className)} role="region" aria-label="Bulk actions">
      <div className="pointer-events-auto flex w-full max-w-4xl flex-col gap-2 rounded-2xl border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--card)/0.9)] p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-primary/15 px-2 text-sm font-semibold text-primary"
              aria-live="polite"
            >
              {count}
            </span>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>

          {children && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{children}</div>}

          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="ml-auto h-8 gap-1.5 text-muted-foreground hover:text-foreground sm:ml-0"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
        {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      </div>
    </div>
  );
}

export default BulkActionBar;
