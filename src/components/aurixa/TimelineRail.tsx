import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * TimelineRail — Phase 4 primitive.
 *
 * Vertical event rail for AML Chronological Timeline, Deal history, PF audit
 * trail, and Report Q&A citations. Renders:
 *   - A gold rail (semantic `--primary`) with node dots per event.
 *   - Glass event cards keyed on event id.
 *   - Optional filter chip strip (source: system / user / integration / audit).
 *   - Keyboard-first: ↑/↓ moves focus between events; Home/End jump to ends.
 *
 * Consumers own the data shape; this primitive only renders + navigates.
 */
export type TimelineEventTone = 'default' | 'success' | 'warning' | 'destructive' | 'info';

export interface TimelineEvent {
  id: string;
  /** Short label (e.g. "Case opened", "Doc uploaded"). */
  title: React.ReactNode;
  /** Longer body, optional. */
  description?: React.ReactNode;
  /** Category — used both for filter chips and node tint. */
  category: string;
  /** Semantic tone for the node dot. */
  tone?: TimelineEventTone;
  /** Timestamp (already formatted for display). */
  timestamp: React.ReactNode;
  /** Optional actor (user, integration name, system). */
  actor?: React.ReactNode;
  /** Optional right-aligned metadata (badge, link). */
  meta?: React.ReactNode;
  /** Optional icon rendered inside the node dot. */
  icon?: React.ReactNode;
}

export interface TimelineFilter {
  key: string;
  label: React.ReactNode;
  count?: number;
}

export interface TimelineRailProps {
  events: TimelineEvent[];
  /** Filter chip strip. When omitted, no filters render. */
  filters?: TimelineFilter[];
  /** Currently-active filter key. Pass `null` for "all". */
  activeFilter?: string | null;
  onFilterChange?: (key: string | null) => void;
  /** Optional event handler when a card is activated. */
  onEventSelect?: (event: TimelineEvent) => void;
  /** Empty-state slot when the filtered list is empty. */
  emptyState?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

const toneNodeClass: Record<TimelineEventTone, string> = {
  default: 'bg-primary text-primary-foreground ring-primary/30',
  success: 'bg-success text-success-foreground ring-success/30',
  warning: 'bg-warning text-warning-foreground ring-warning/30',
  destructive: 'bg-destructive text-destructive-foreground ring-destructive/30',
  info: 'bg-accent text-accent-foreground ring-accent/40',
};

export const TimelineRail = React.forwardRef<HTMLDivElement, TimelineRailProps>(
  (
    {
      events,
      filters,
      activeFilter = null,
      onFilterChange,
      onEventSelect,
      emptyState,
      className,
      ariaLabel = 'Event timeline',
    },
    ref,
  ) => {
    const listRef = React.useRef<HTMLOListElement | null>(null);

    const filtered = React.useMemo(() => {
      if (!activeFilter) return events;
      return events.filter((e) => e.category === activeFilter);
    }, [events, activeFilter]);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLOListElement>) => {
      const root = listRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>('[data-timeline-event="true"]'),
      );
      if (items.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = current ? items.indexOf(current) : -1;
      let next = idx;
      switch (e.key) {
        case 'ArrowDown':
          next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1);
          break;
        case 'ArrowUp':
          next = idx < 0 ? items.length - 1 : Math.max(0, idx - 1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = items.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      items[next]?.focus();
    }, []);

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-3', className)}
        aria-label={ariaLabel}
        role="region"
      >
        {filters && filters.length > 0 && (
          <div role="tablist" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
            <FilterChip
              active={!activeFilter}
              onClick={() => onFilterChange?.(null)}
              label="All"
              count={events.length}
            />
            {filters.map((f) => (
              <FilterChip
                key={f.key}
                active={activeFilter === f.key}
                onClick={() => onFilterChange?.(f.key)}
                label={f.label}
                count={f.count}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-[var(--radius-xl)] border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            {emptyState ?? 'No events to display.'}
          </div>
        ) : (
          <ol
            ref={listRef}
            onKeyDown={handleKeyDown}
            className="relative ml-2 flex flex-col gap-3 border-l border-primary/40 pl-6"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[-1px] top-0 h-full w-px bg-gradient-to-b from-primary/60 via-primary/25 to-transparent"
            />
            {filtered.map((event) => {
              const tone: TimelineEventTone = event.tone ?? 'default';
              return (
                <li key={event.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-[calc(1.5rem+0.5rem)] top-3 inline-flex h-4 w-4 items-center justify-center rounded-full ring-4',
                      toneNodeClass[tone],
                    )}
                  >
                    {event.icon}
                  </span>
                  <button
                    type="button"
                    data-timeline-event="true"
                    onClick={() => onEventSelect?.(event)}
                    className={cn(
                      'group/timeline-event flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] px-3 py-2.5 text-left',
                      '[background:var(--glass-tint)] backdrop-blur shadow-[var(--elevation-1)]',
                      'transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
                      'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--elevation-2)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                        {event.title}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {event.timestamp}
                      </span>
                    </div>
                    {event.description && (
                      <p className="line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
                        {event.description}
                      </p>
                    )}
                    {(event.actor || event.meta) && (
                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                        <span className="min-w-0 truncate">{event.actor}</span>
                        {event.meta}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  },
);

TimelineRail.displayName = 'TimelineRail';

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count?: number;
}

function FilterChip({ active, onClick, label, count }: FilterChipProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          className={cn(
            'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
            active ? 'bg-primary/20 text-foreground' : 'bg-muted/70 text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default TimelineRail;
