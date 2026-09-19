import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * SuggestionChips — Phase 6 primitive.
 *
 * Renders a row of tappable prompt suggestions above the composer for any AI
 * surface (Agent widget, Report Q&A, Copilot, Chat). Keyboard-accessible,
 * wraps on narrow viewports, and exposes a `variant` for glass or solid.
 */

export interface SuggestionChip {
  id: string;
  label: string;
  /** Optional short helper shown below the label on ≥sm. */
  hint?: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Optional payload sent back to `onSelect`. */
  payload?: unknown;
  disabled?: boolean;
}

export interface SuggestionChipsProps {
  chips: SuggestionChip[];
  onSelect: (chip: SuggestionChip) => void;
  /** Optional label rendered above the strip. */
  heading?: React.ReactNode;
  /** Constrains the strip to a single scrollable row (great for docked chat). */
  scroll?: boolean;
  className?: string;
}

export function SuggestionChips({
  chips,
  onSelect,
  heading,
  scroll = false,
  className,
}: SuggestionChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cn('w-full', className)}>
      {heading && (
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {heading}
        </div>
      )}
      <div
        role="list"
        className={cn(
          'flex gap-1.5',
          scroll
            ? 'flex-nowrap overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'flex-wrap',
        )}
      >
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="listitem"
            disabled={chip.disabled}
            onClick={() => onSelect(chip)}
            className={cn(
              'group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-[var(--motion-fast)]',
              'border-[color:var(--glass-hairline)] [background:var(--glass-tint)] text-foreground/90',
              'hover:border-primary/60 hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'motion-reduce:transition-none',
            )}
          >
            {chip.icon && <span className="text-primary/80">{chip.icon}</span>}
            <span className="truncate font-medium">{chip.label}</span>
            {chip.hint && (
              <span className="hidden text-muted-foreground sm:inline">· {chip.hint}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SuggestionChips;
