import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const OVERRIDE_STEPS = [
  { value: 'property', label: 'Property' },
  { value: 'financials', label: 'Financials' },
  { value: 'income', label: 'Income' },
  { value: 'advanced', label: 'Advanced' },
] as const;

export type OverrideStep = (typeof OVERRIDE_STEPS)[number]['value'];

interface OverrideStepFooterProps {
  current: OverrideStep;
  onNavigate: (step: OverrideStep) => void;
}

/**
 * Sticky step navigation shown at the bottom of every Pre-Generation Overrides
 * tab. Makes the four categories read as a guided sequence rather than four
 * disconnected tabs — each step names the next one explicitly.
 */
export function OverrideStepFooter({ current, onNavigate }: OverrideStepFooterProps) {
  const index = OVERRIDE_STEPS.findIndex((step) => step.value === current);
  const previous = index > 0 ? OVERRIDE_STEPS[index - 1] : null;
  const next = index >= 0 && index < OVERRIDE_STEPS.length - 1 ? OVERRIDE_STEPS[index + 1] : null;

  return (
    <div className="reports-overrides-step-footer sticky bottom-0 z-10 mt-5 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/85 p-3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Step {index + 1} of {OVERRIDE_STEPS.length}
        </span>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {OVERRIDE_STEPS.map((step, i) => (
            <span
              key={step.value}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === index ? 'w-6 bg-primary' : i < index ? 'w-3 bg-primary/50' : 'w-3 bg-border'
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        {previous && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-xl"
            onClick={() => onNavigate(previous.value)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {previous.label}
          </Button>
        )}
        {next ? (
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-xl font-semibold"
            onClick={() => onNavigate(next.value)}
          >
            Next: {next.label}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-primary" />
            All categories reviewed
          </span>
        )}
      </div>
    </div>
  );
}
