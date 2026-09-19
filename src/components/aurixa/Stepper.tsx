import * as React from 'react';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Stepper — Phase 5 primitive.
 *
 * Progress rail for multi-step forms (report generation, client intake,
 * PF creation, AML case open). Horizontal on ≥md, vertical on <md.
 *
 * Keyboard: focusable step buttons expose `aria-current="step"` and support
 * completed → in-progress → upcoming states. Optional `onStepSelect` allows
 * jumping to previously completed steps (never to future ones).
 */

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
  /** Optional icon override. Defaults to Circle / Check. */
  icon?: React.ReactNode;
  /** Set true when the step has passed validation. */
  complete?: boolean;
  /** Set true when the step is currently blocked (validation error). */
  error?: boolean;
  /** Set true when the step is optional/skippable. */
  optional?: boolean;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Index of the currently active step. */
  activeIndex: number;
  /** If provided, users can click a completed step to jump back. */
  onStepSelect?: (index: number, step: StepperStep) => void;
  /** Forces vertical rail regardless of viewport (for narrow drawers). */
  orientation?: 'auto' | 'horizontal' | 'vertical';
  className?: string;
}

export function Stepper({
  steps,
  activeIndex,
  onStepSelect,
  orientation = 'auto',
  className,
}: StepperProps) {
  const isVerticalForced = orientation === 'vertical';
  const isHorizontalForced = orientation === 'horizontal';

  return (
    <ol
      className={cn(
        'flex w-full gap-2',
        isVerticalForced
          ? 'flex-col'
          : isHorizontalForced
            ? 'flex-row items-stretch'
            : 'flex-col md:flex-row md:items-stretch',
        className,
      )}
      aria-label="Progress"
    >
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isComplete = step.complete ?? index < activeIndex;
        const isError = !!step.error;
        const canSelect = !!onStepSelect && (isComplete || index < activeIndex);
        const isLast = index === steps.length - 1;

        const tone = isError
          ? 'border-destructive/50 text-destructive'
          : isActive
            ? 'border-primary text-foreground'
            : isComplete
              ? 'border-primary/60 text-foreground'
              : 'border-[color:var(--glass-hairline)] text-muted-foreground';

        const indicatorTone = isError
          ? 'bg-destructive/15 text-destructive ring-destructive/40'
          : isActive
            ? 'bg-primary text-primary-foreground ring-primary/40'
            : isComplete
              ? 'bg-primary/15 text-primary ring-primary/30'
              : 'bg-muted text-muted-foreground ring-[color:var(--glass-hairline)]';

        return (
          <li
            key={step.id}
            className={cn('relative flex flex-1 min-w-0', isVerticalForced ? '' : 'md:flex-row')}
          >
            <button
              type="button"
              onClick={canSelect ? () => onStepSelect?.(index, step) : undefined}
              disabled={!canSelect}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'group flex w-full items-start gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 text-left transition-colors duration-[var(--motion-fast)]',
                tone,
                canSelect &&
                  'hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
                !canSelect && 'cursor-default',
                '[background:var(--glass-tint)]',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
                  indicatorTone,
                )}
                aria-hidden="true"
              >
                {step.icon ? (
                  step.icon
                ) : isComplete && !isError ? (
                  <Check className="h-4 w-4" />
                ) : isActive ? (
                  <Circle className="h-3 w-3 fill-current" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{step.label}</span>
                  {step.optional && (
                    <span className="rounded-full border border-[color:var(--glass-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Optional
                    </span>
                  )}
                </span>
                {step.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {step.description}
                  </span>
                )}
              </span>
            </button>
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-1 my-1 hidden self-center',
                  isVerticalForced
                    ? ''
                    : 'md:block md:h-px md:w-4 md:flex-none',
                  isComplete
                    ? 'md:bg-primary/60'
                    : 'md:bg-[color:var(--glass-hairline)]',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default Stepper;
