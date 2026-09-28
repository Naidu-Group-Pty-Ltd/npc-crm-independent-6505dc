import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

import {
  advisorProgressView,
  type AdvisorProgressState,
} from '@/lib/advisorProgress.pure';

/**
 * What the Strategy Advisor is doing, while it does it.
 *
 * It replaced one spinning circle, which could not tell a broker a slow answer
 * from a stalled one. It draws the stage the server last reported, the time
 * since the request was sent, and, while the model is working, one fact at a
 * time from the brief it was handed. The words are in
 * `_shared/advisorProgress.pure.ts`.
 *
 * Only the stage headline is announced to a screen reader. The timer and the
 * rotating fact change every second or so, and announcing them would talk
 * over everything else.
 */
export function AdvisorProgressBubble({
  progress,
  facts,
}: {
  progress: AdvisorProgressState;
  facts: readonly string[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const view = advisorProgressView(progress, now, facts);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-lg bg-muted px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2.5">
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p role="status" className="font-medium text-foreground">
                {view.headline}
              </p>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
                {view.elapsed}
              </span>
            </div>

            {view.detail && (
              <p className="mt-0.5 text-xs text-muted-foreground">{view.detail}</p>
            )}

            {view.briefLine && (
              <p
                key={view.briefLine}
                className="mt-1.5 text-xs text-muted-foreground animate-in fade-in duration-500 motion-reduce:animate-none"
              >
                <span className="mr-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
                  In the brief
                </span>
                {view.briefLine}
              </p>
            )}

            {view.patienceNote && (
              <p className="mt-1 text-xs text-muted-foreground">{view.patienceNote}</p>
            )}

            <ol className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" aria-label="Progress">
              {view.steps.map((step) => (
                <li
                  key={step.stage}
                  className={`flex items-center gap-1 ${
                    step.state === 'active'
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {step.state === 'done' ? (
                    <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden="true" />
                  ) : step.state === 'active' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Circle className="h-3 w-3 opacity-50" aria-hidden="true" />
                  )}
                  <span>{step.label}</span>
                  <span className="sr-only">
                    {step.state === 'done' ? ' (done)' : step.state === 'active' ? ' (in progress)' : ' (to come)'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
