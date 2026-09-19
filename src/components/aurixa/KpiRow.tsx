import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * KpiRow — Phase 2 primitive.
 *
 * Responsive grid wrapper for `MetricTile` / `KPICard`. Defaults to a
 * fluid `auto-fit` grid so callers rarely need to override columns.
 * Semantic tokens only; no colour or font hardcoding.
 */
export interface KpiRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Minimum tile width used by the auto-fit grid (in rem). Defaults to 15. */
  minTileRem?: number;
  /** Force a specific column count instead of auto-fit. */
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Gap size preset. */
  density?: 'cozy' | 'comfy';
}

const densityGap: Record<NonNullable<KpiRowProps['density']>, string> = {
  cozy: 'gap-3 md:gap-4',
  comfy: 'gap-4 md:gap-5',
};

const columnClass: Record<NonNullable<KpiRowProps['columns']>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 min-[520px]:grid-cols-2',
  3: 'grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 min-[520px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5',
  6: 'grid-cols-1 min-[520px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
};

export const KpiRow = React.forwardRef<HTMLDivElement, KpiRowProps>(
  ({ minTileRem = 15, columns, density = 'comfy', className, style, children, ...props }, ref) => {
    const isAutoFit = !columns;
    const mergedStyle: React.CSSProperties = isAutoFit
      ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minTileRem}rem), 1fr))`, ...style }
      : style ?? {};

    return (
      <div
        ref={ref}
        className={cn(
          'grid min-w-0 animate-fade-in',
          densityGap[density],
          !isAutoFit && columns && columnClass[columns],
          className
        )}
        style={mergedStyle}
        {...props}
      >
        {children}
      </div>
    );
  }
);

KpiRow.displayName = 'KpiRow';

export default KpiRow;
