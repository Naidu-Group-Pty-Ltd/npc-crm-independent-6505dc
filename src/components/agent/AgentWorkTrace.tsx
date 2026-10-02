/**
 * AgentWorkTrace — Aurixa's working, shown while it works and folded after.
 *
 * While a reply is being prepared the steps are listed live, each with the
 * area of the business it touches; the running one carries a small orbit.
 * When the reply lands the list folds into one quiet line ("Worked for 6s ·
 * 3 steps") that opens again on a click, so the history of how an answer was
 * reached is one tap away and never in the way.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { domainIcon } from './domainIcon';
import { traceSummary, type WorkTrace } from '@/lib/agent/workTrace.pure';

interface AgentWorkTraceProps {
  trace: WorkTrace;
  /** The reply is still being prepared. */
  live: boolean;
  /** Words have started arriving, so the work has turned into writing. */
  writing?: boolean;
}

export function AgentWorkTrace({ trace, live, writing = false }: AgentWorkTraceProps) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);

  // Tick the elapsed clock only while live.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [live]);

  if (!live && trace.steps.length === 0) return null;
  const expanded = live || open;

  return (
    <div className="aurixa-trace" data-live={live ? 'true' : 'false'}>
      {live ? (
        <div className="aurixa-trace__summary flex w-full items-center gap-2 text-[11.5px] text-muted-foreground" role="status">
          <span className="aurixa-trace__pulse" aria-hidden />
          <span className="truncate">
            {writing && !trace.steps.some((s) => s.status === 'running') ? 'Writing it up' : 'Working on it'}
          </span>
          {trace.steps.length > 0 && (
            <span className="tabular-nums text-muted-foreground/70">· {traceSummary(trace).replace(/^Worked for /, '')}</span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="aurixa-trace__summary group flex w-full items-center gap-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          <span className="aurixa-trace__pulse" aria-hidden />
          <span className="truncate">{traceSummary(trace)}</span>
          <ChevronDown
            className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      )}

      {expanded && trace.steps.length > 0 && (
        <ol className="aurixa-trace__steps mt-1.5 space-y-1" aria-live={live ? 'polite' : undefined}>
          {trace.steps.map((step) => {
            const Icon = domainIcon(step.domain);
            const running = step.status === 'running';
            return (
              <li key={step.key} className="aurixa-trace__step flex items-center gap-2 text-[12px]" data-status={step.status}>
                <span className="aurixa-trace__node flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                  {running ? <Icon className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
                </span>
                <span className={cn('min-w-0 truncate', running ? 'text-foreground' : 'text-muted-foreground')}>
                  {running ? `${step.label}…` : step.doneLabel}
                </span>
                {step.count > 1 && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                    ×{step.count}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
