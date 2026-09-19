import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * KanbanColumn — Phase 4 primitive.
 *
 * A column shell for Deal Pipeline / Finance Pipeline / AML case boards.
 *
 * Displays:
 *   - Title + optional stage description
 *   - Count chip + optional weighted-value chip
 *   - Optional WIP limit; when count exceeds the limit, the column border
 *     glows warning (semantic tokens, no raw palette)
 *   - Children slot for the card list (usually a virtualised list)
 *   - Optional footer slot for column-level actions (add card, load more)
 *
 * Drop targets and DnD wiring are the consumer's responsibility — this
 * primitive only renders the shell. Consumers can forward drag handlers
 * through the standard div props.
 */
export type KanbanColumnTone = 'default' | 'success' | 'warning' | 'destructive';

export interface KanbanColumnProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Number of cards currently in the column. */
  count: number;
  /** Optional aggregate value chip (e.g. weighted commission, TCV). */
  weightedValue?: React.ReactNode;
  /** Soft cap; if `count > wipLimit`, the column glows warning. */
  wipLimit?: number;
  /** Accent tone (drives header dot + border glow). */
  tone?: KanbanColumnTone;
  /** Column is a live drag-hover target. */
  isDropTarget?: boolean;
  /** Slot rendered above the card list (filters, sort). */
  headerSlot?: React.ReactNode;
  /** Slot rendered below the card list (add-card CTA, "load more"). */
  footerSlot?: React.ReactNode;
  /** When true, the column body becomes a scroll container. */
  scrollable?: boolean;
}

const toneDot: Record<KanbanColumnTone, string> = {
  default: 'bg-muted-foreground/60',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

export const KanbanColumn = React.forwardRef<HTMLDivElement, KanbanColumnProps>(
  (
    {
      title,
      description,
      count,
      weightedValue,
      wipLimit,
      tone = 'default',
      isDropTarget = false,
      headerSlot,
      footerSlot,
      scrollable = true,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const overLimit = typeof wipLimit === 'number' && count > wipLimit;

    return (
      <section
        ref={ref}
        aria-label={typeof title === 'string' ? title : undefined}
        data-drop-target={isDropTarget ? 'true' : undefined}
        data-over-limit={overLimit ? 'true' : undefined}
        className={cn(
          'group/kanban-column flex w-[320px] shrink-0 flex-col rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)]',
          '[background:var(--glass-tint)] backdrop-blur-md shadow-[var(--elevation-1)]',
          'transition-[box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
          isDropTarget && 'border-primary/60 shadow-[var(--elevation-2)] ring-1 ring-primary/40',
          overLimit && 'border-warning/60 shadow-[0_0_0_1px_hsl(var(--warning)/0.35),var(--elevation-1)]',
          'motion-reduce:transition-none',
          className,
        )}
        {...props}
      >
        <header className="flex flex-col gap-1.5 border-b border-[color:var(--glass-hairline)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-full', toneDot[tone])}
            />
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            <span
              aria-label={`${count} items`}
              className={cn(
                'inline-flex min-w-[1.75rem] items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                overLimit
                  ? 'border-warning/50 bg-warning/10 text-warning'
                  : 'border-border/70 bg-muted/60 text-muted-foreground',
              )}
            >
              {count}
              {typeof wipLimit === 'number' && (
                <span className="ml-0.5 text-muted-foreground/70">/{wipLimit}</span>
              )}
            </span>
          </div>
          {(description || weightedValue) && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              {description ? <span className="min-w-0 truncate">{description}</span> : <span />}
              {weightedValue && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 font-semibold tabular-nums text-foreground">
                  {weightedValue}
                </span>
              )}
            </div>
          )}
          {headerSlot}
        </header>

        <div
          className={cn(
            'flex flex-1 flex-col gap-2 p-3',
            scrollable && 'max-h-[calc(100vh-18rem)] overflow-y-auto',
          )}
          role="list"
        >
          {children}
        </div>

        {footerSlot && (
          <footer className="border-t border-[color:var(--glass-hairline)] px-3 py-2">
            {footerSlot}
          </footer>
        )}
      </section>
    );
  },
);

KanbanColumn.displayName = 'KanbanColumn';

export default KanbanColumn;
