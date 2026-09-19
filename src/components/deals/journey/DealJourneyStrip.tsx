import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JourneyPhaseState } from '@/lib/deals/dealJourney.pure';

/**
 * The journey, drawn once. This strip renders the SAME phase states on the
 * admin deal view and in the client portal — the two audiences read one
 * geometry, so "where is this deal" can never be two different pictures.
 * Semantic tokens only: it sits on the dark admin shell and the portal's
 * soft panels without either owning it.
 */
export function DealJourneyStrip({
  phases,
  className,
}: {
  phases: JourneyPhaseState[];
  className?: string;
}) {
  if (phases.length === 0) return null;

  return (
    <ol className={cn('flex flex-wrap items-center gap-y-1.5', className)} aria-label="Deal journey">
      {phases.map((entry, idx) => {
        const { phase, state, total, done } = entry;
        const title = total > 0
          ? `${phase.label} — ${done}/${total} step${total === 1 ? '' : 's'} done. ${phase.blurb}`
          : `${phase.label} — ${phase.blurb}`;
        return (
          <li key={phase.id} className="flex min-w-0 items-center">
            {idx > 0 && (
              <ChevronRight aria-hidden className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
            <span
              title={title}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium leading-none',
                state === 'done' && 'border-success/30 bg-success/10 text-success',
                state === 'current' && 'border-primary/50 bg-primary/10 font-semibold text-foreground ring-1 ring-primary/25',
                state === 'upcoming' && 'border-border/60 bg-muted/30 text-muted-foreground',
              )}
            >
              {state === 'done' ? (
                <Check aria-hidden className="h-3 w-3 shrink-0" />
              ) : (
                <span aria-hidden className={cn('shrink-0 text-xs leading-none', state === 'upcoming' && 'opacity-60')}>
                  {phase.icon}
                </span>
              )}
              <span className="truncate">{phase.label}</span>
              <span className="sr-only">
                {state === 'done' ? ' — complete' : state === 'current' ? ' — current phase' : ' — upcoming'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
