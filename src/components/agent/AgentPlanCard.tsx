/**
 * AgentPlanCard — the plan Aurixa set itself, ticked off as it works.
 *
 * The work trace says what Aurixa DID; the plan says what it MEANS to do, so a
 * long request reads as a short checklist being worked through rather than a
 * pause. The rail across the top is the plan at a glance — one segment per
 * step, filling as each is done — and is the only motion on the card.
 *
 * Two rules. **A step is only shown running while the answer is.** A finished
 * answer whose model left a step marked active draws it as outstanding, not as
 * a spinner nobody will ever stop. And **a finished plan folds** into one line,
 * like the trace above it, unless something on it was left undone — then it
 * stays open, because what is outstanding is the point.
 */
import { useState } from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { planProgress, type AgentPlan } from '@/lib/agent/protocol';
import './aurixa.css';

interface AgentPlanCardProps {
  plan: AgentPlan;
  /** The answer is still being prepared. */
  live: boolean;
}

export function AgentPlanCard({ plan, live }: AgentPlanCardProps) {
  const progress = planProgress(plan);
  const [open, setOpen] = useState(false);
  const foldable = !live && progress.settled;
  const folded = foldable && !open;
  const title = plan.title || 'Plan';

  return (
    <section className="aurixa-plan" data-live={live ? 'true' : 'false'} aria-label={title}>
      <div className="aurixa-plan__rail" aria-hidden>
        {plan.steps.map((step, i) => (
          <span
            key={i}
            className="aurixa-plan__segment"
            data-status={step.status === 'active' && !live ? 'pending' : step.status}
          />
        ))}
      </div>

      {(() => {
        const head = (
          <>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {foldable ? `Finished · ${progress.total} ${progress.total === 1 ? 'step' : 'steps'}` : `${progress.done} of ${progress.total}`}
            </span>
          </>
        );
        return foldable ? (
          <button
            type="button"
            className="aurixa-plan__head flex w-full items-center gap-2 text-left"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={!folded}
          >
            {head}
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200', !folded && 'rotate-180')} aria-hidden />
          </button>
        ) : (
          <div className="aurixa-plan__head flex w-full items-center gap-2">{head}</div>
        );
      })()}

      {!folded && (
        <ol className="aurixa-plan__steps mt-1.5 space-y-1" aria-live={live ? 'polite' : undefined}>
          {plan.steps.map((step, i) => {
            const status = step.status === 'active' && !live ? 'pending' : step.status;
            return (
              <li key={`${i}-${step.label}`} className="aurixa-plan__step flex items-start gap-2 text-[12px]" data-status={status}>
                <span className="aurixa-plan__node mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
                  {status === 'done' && <Check className="h-2.5 w-2.5" aria-hidden />}
                  {status === 'skipped' && <Minus className="h-2.5 w-2.5" aria-hidden />}
                </span>
                <span className="aurixa-plan__label min-w-0 leading-snug">
                  {step.label}
                  <span className="sr-only">
                    {status === 'done' ? ' (done)' : status === 'skipped' ? ' (skipped)' : status === 'active' ? ' (in progress)' : ' (to do)'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
