import * as React from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * KanbanCard — Phase 4 primitive.
 *
 * Card shell for pipeline boards (deals, purchase files, AML cases).
 *
 * Layout slots (all optional except `title`):
 *   - `dragHandleProps` — spread onto the isolated drag handle to reduce
 *     accidental drags on the card body.
 *   - `chips`           — lender/status/category pills rendered under title.
 *   - `daysInStage`     — numeric days badge; also drives the micro-bar.
 *   - `daysInStageMax`  — soft cap for the micro-bar (default 30 days).
 *   - `risk`            — 'low' | 'medium' | 'high' — surfaces as a right pill.
 *   - `assignee`        — { name, initials, avatarUrl? } — avatar + tooltip.
 *   - `meta`            — key/value strip under body (amount, date, agency).
 *
 * All colours flow through semantic tokens. No raw palette usage.
 */
export type KanbanCardRisk = 'low' | 'medium' | 'high';

export interface KanbanCardAssignee {
  name: string;
  initials?: string;
  avatarUrl?: string | null;
}

export interface KanbanCardMetaEntry {
  label: string;
  value: React.ReactNode;
}

export interface KanbanCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onSelect'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode;
  daysInStage?: number;
  daysInStageMax?: number;
  risk?: KanbanCardRisk;
  assignee?: KanbanCardAssignee | null;
  meta?: KanbanCardMetaEntry[];
  /** Props to spread on the drag handle affordance. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  /** Called when the card body (not the drag handle) is activated. */
  onSelect?: () => void;
  /** Renders a subtle selected-state ring. */
  isSelected?: boolean;
}

const riskLabel: Record<KanbanCardRisk, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

const riskPillClass: Record<KanbanCardRisk, string> = {
  low: 'border-success/40 bg-success/10 text-success',
  medium: 'border-warning/40 bg-warning/10 text-warning',
  high: 'border-destructive/40 bg-destructive/10 text-destructive',
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

export const KanbanCard = React.forwardRef<HTMLDivElement, KanbanCardProps>(
  (
    {
      title,
      subtitle,
      chips,
      daysInStage,
      daysInStageMax = 30,
      risk,
      assignee,
      meta,
      dragHandleProps,
      onSelect,
      isSelected = false,
      className,
      ...props
    },
    ref,
  ) => {
    const microBarPct =
      typeof daysInStage === 'number'
        ? Math.min(100, Math.max(4, (daysInStage / Math.max(1, daysInStageMax)) * 100))
        : 0;
    const microBarTone =
      typeof daysInStage === 'number'
        ? daysInStage >= daysInStageMax
          ? 'bg-destructive'
          : daysInStage >= daysInStageMax * 0.66
            ? 'bg-warning'
            : 'bg-primary'
        : 'bg-muted-foreground/40';

    return (
      <div
        ref={ref}
        role="listitem"
        data-selected={isSelected ? 'true' : undefined}
        className={cn(
          'group/kanban-card relative flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)]',
          '[background:var(--glass-tint)] backdrop-blur px-3 py-2.5 shadow-[var(--elevation-1)]',
          'transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
          'hover:-translate-y-0.5 hover:shadow-[var(--elevation-2)] hover:border-primary/40',
          isSelected && 'border-primary/60 ring-1 ring-primary/40',
          'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label="Drag card"
            tabIndex={0}
            {...dragHandleProps}
            className={cn(
              'mt-0.5 inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'active:cursor-grabbing',
              dragHandleProps?.className,
            )}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <span className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-foreground">
              {title}
            </span>
            {subtitle && (
              <span className="line-clamp-1 text-[11px] text-muted-foreground">{subtitle}</span>
            )}
          </button>

          {risk && (
            <span
              aria-label={riskLabel[risk]}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                riskPillClass[risk],
              )}
            >
              {risk}
            </span>
          )}
        </div>

        {chips && <div className="flex flex-wrap items-center gap-1.5 pl-7">{chips}</div>}

        {typeof daysInStage === 'number' && (
          <div className="flex items-center gap-2 pl-7">
            <div
              role="progressbar"
              aria-label="Days in stage"
              aria-valuenow={daysInStage}
              aria-valuemin={0}
              aria-valuemax={daysInStageMax}
              className="h-1 flex-1 overflow-hidden rounded-full bg-muted/60"
            >
              <div
                className={cn('h-full rounded-full transition-[width] duration-[var(--motion-base)]', microBarTone)}
                style={{ width: `${microBarPct}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
              {daysInStage}d
            </span>
          </div>
        )}

        {(meta?.length || assignee) && (
          <div className="flex items-center justify-between gap-2 pl-7 pt-1">
            {meta && meta.length > 0 ? (
              <dl className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {meta.map((entry) => (
                  <div key={entry.label} className="inline-flex min-w-0 items-center gap-1">
                    <dt className="uppercase tracking-[0.06em] text-muted-foreground/70">
                      {entry.label}
                    </dt>
                    <dd className="min-w-0 truncate font-semibold text-foreground">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span />
            )}
            {assignee && (
              <span
                title={assignee.name}
                aria-label={`Assigned to ${assignee.name}`}
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted text-[10px] font-semibold text-foreground',
                )}
              >
                {assignee.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assignee.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  assignee.initials ?? initialsFor(assignee.name)
                )}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
);

KanbanCard.displayName = 'KanbanCard';

export default KanbanCard;
