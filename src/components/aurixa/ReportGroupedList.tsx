import * as React from 'react';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';
import { ChevronDown } from 'lucide-react';

/**
 * ReportGroupedList — Phase 7 primitive.
 *
 * Grouped index primitive for the Generated Reports page. Accepts a
 * `groupBy` value plus a `groups` array of `{ key, label, items }` and
 * renders collapsible glass sections with counts and inline slots for
 * per-item rendering. Purely presentational — no data fetching.
 */
export interface ReportGroupedListGroup<T> {
  key: string;
  label: React.ReactNode;
  count?: number;
  meta?: React.ReactNode;
  items: T[];
}

export interface ReportGroupedListProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  groups: ReportGroupedListGroup<T>[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Groups collapsed by default. Defaults to false. */
  defaultCollapsed?: boolean;
  /** Called when a group is toggled. */
  onToggle?: (key: string, open: boolean) => void;
  /** Empty state when no groups (or all empty). */
  emptyState?: React.ReactNode;
}

export function ReportGroupedList<T>({
  groups,
  renderItem,
  defaultCollapsed = false,
  onToggle,
  emptyState,
  className,
  ...props
}: ReportGroupedListProps<T>) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach((g) => {
      initial[g.key] = defaultCollapsed;
    });
    return initial;
  });

  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={cn('space-y-4', className)} {...props}>
      {nonEmpty.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false;
        const count = group.count ?? group.items.length;
        return (
          <GlassCard key={group.key} flush className="overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const next = !isCollapsed;
                setCollapsed((prev) => ({ ...prev, [group.key]: next }));
                onToggle?.(group.key, !next);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors',
                'hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
              aria-expanded={!isCollapsed}
            >
              <div className="flex min-w-0 items-center gap-3">
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    isCollapsed && '-rotate-90'
                  )}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{group.label}</div>
                  {group.meta && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{group.meta}</div>
                  )}
                </div>
              </div>
              <span className="rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.4)] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {count}
              </span>
            </button>
            {!isCollapsed && (
              <div className="border-t border-[color:var(--glass-hairline)] px-2 py-2">
                <ul className="divide-y divide-[color:var(--glass-hairline)]">
                  {group.items.map((item, i) => (
                    <li key={i} className="px-3 py-2">
                      {renderItem(item, i)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassCard>
        );
      })}
    </div>
  );
}

export default ReportGroupedList;
