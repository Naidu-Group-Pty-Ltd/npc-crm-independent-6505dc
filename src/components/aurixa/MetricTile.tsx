import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';

/**
 * MetricTile — Phase 2 primitive.
 *
 * Single KPI card with icon, value, optional delta, and description.
 * Uses semantic tokens only. Supports a tone accent for warning/success
 * states and a compact variant for dense grids.
 */
export type MetricTileTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface MetricTileDelta {
  /** Numeric or preformatted delta label (e.g. "+12%"). */
  value: React.ReactNode;
  /** Direction — controls the arrow icon and tone. */
  direction?: 'up' | 'down' | 'flat';
  /** Optional caption alongside the delta (e.g. "vs last week"). */
  caption?: React.ReactNode;
}

export interface MetricTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  value: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: MetricTileTone;
  delta?: MetricTileDelta;
  compact?: boolean;
  loading?: boolean;
}

const toneRing: Record<MetricTileTone, string> = {
  default: 'border-[color:var(--glass-hairline)]',
  success: 'border-[color:hsl(var(--success)/0.45)]',
  warning: 'border-[color:hsl(var(--warning,38_92%_50%)/0.45)]',
  danger: 'border-[color:hsl(var(--destructive)/0.45)]',
  info: 'border-[color:hsl(var(--dashboard-primary-strong)/0.45)]',
};

const toneIconBg: Record<MetricTileTone, string> = {
  default: 'bg-[color:hsl(var(--aurixa-glass-bg)/0.6)] text-foreground',
  success: 'bg-[color:hsl(var(--success)/0.14)] text-[color:hsl(var(--success))]',
  warning: 'bg-[color:hsl(var(--warning,38_92%_50%)/0.14)] text-[color:hsl(var(--warning,38_92%_50%))]',
  danger: 'bg-[color:hsl(var(--destructive)/0.14)] text-[color:hsl(var(--destructive))]',
  info: 'bg-[color:hsl(var(--dashboard-primary-strong)/0.14)] text-[color:hsl(var(--dashboard-primary-strong))]',
};

const deltaTone: Record<NonNullable<MetricTileDelta['direction']>, string> = {
  up: 'text-[color:hsl(var(--success))]',
  down: 'text-[color:hsl(var(--destructive))]',
  flat: 'text-muted-foreground',
};

const DeltaIcon: Record<NonNullable<MetricTileDelta['direction']>, typeof ArrowUpRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
};

export const MetricTile = React.forwardRef<HTMLDivElement, MetricTileProps>(
  (
    { title, value, description, icon, tone = 'default', delta, compact = false, loading = false, className, ...props },
    ref
  ) => {
    const direction = delta?.direction ?? 'flat';
    const DirIcon = DeltaIcon[direction];

    return (
      <GlassCard
        ref={ref}
        elevation={1}
        interactive
        className={cn('flex min-w-0 flex-col gap-3', toneRing[tone], compact && 'p-4', className)}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          {icon && (
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)]',
                toneIconBg[tone]
              )}
              aria-hidden="true"
            >
              {icon}
            </div>
          )}
        </div>
        <div
          className={cn(
            'min-w-0 break-words font-semibold tracking-[-0.045em] text-foreground',
            compact ? 'text-2xl' : 'text-3xl min-[420px]:text-[2.1rem] sm:text-[2.35rem]'
          )}
        >
          {loading ? <span className="inline-block h-8 w-24 animate-pulse rounded-md bg-muted" /> : value}
        </div>
        {(description || delta) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {delta && (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', deltaTone[direction])}>
                <DirIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{delta.value}</span>
                {delta.caption && <span className="text-muted-foreground">· {delta.caption}</span>}
              </span>
            )}
            {description && <p className="text-[0.78rem] leading-5 text-muted-foreground">{description}</p>}
          </div>
        )}
      </GlassCard>
    );
  }
);

MetricTile.displayName = 'MetricTile';

export default MetricTile;
