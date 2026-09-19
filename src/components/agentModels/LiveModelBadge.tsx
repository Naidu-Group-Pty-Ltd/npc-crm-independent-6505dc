/**
 * Live badge showing which model currently powers a given agent slot.
 * Reads from `useAgentModel(agentKey)` — updates in realtime whenever the
 * Model Hub changes the assignment.
 *
 * Purely presentational. Wrap in a link/button at the call site if you
 * want it to be interactive (e.g. open ModelUpgradeButton).
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentModel, subscribeAgentPulse, getAgentPulse } from '@/hooks/useAgentModels';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';


export type LiveModelBadgeProps = {
  agentKey: string;
  /** Show slot label (e.g. "Primary") ahead of the model name. */
  showSlot?: boolean;
  /** Compact chip vs. default pill. */
  size?: 'sm' | 'md';
  /** Optional override for wrapper classes. */
  className?: string;
};

export function LiveModelBadge({
  agentKey,
  showSlot = false,
  size = 'md',
  className,
}: LiveModelBadgeProps) {
  const { assignment, display, slotLabel, surfaceLabel } = useAgentModel(agentKey);
  const slotDisplay = slotLabel === 'Primary' && surfaceLabel ? surfaceLabel : slotLabel;

  const loading = !assignment && display.raw === '';

  // Pulse: brief glow when the Model Hub repoints this agent_key at runtime.
  const [pulsed, setPulsed] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeAgentPulse(() => {
      const ts = getAgentPulse(agentKey);
      if (!ts) return;
      if (Date.now() - ts > 2000) return;
      setPulsed(true);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => setPulsed(false), 2000);
    });
    return () => {
      unsub();
      if (timeout) clearTimeout(timeout);
    };
  }, [agentKey]);


  const dot = (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: display.accent }}
    />
  );

  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 backdrop-blur-sm font-medium text-foreground/90 transition-all duration-500',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        pulsed && 'ring-2 ring-offset-1 ring-offset-background scale-[1.03]',
        className,
      )}
      style={{
        borderColor: `${display.accent}55`,
        boxShadow: pulsed ? `0 0 0 3px ${display.accent}33` : undefined,
        ['--tw-ring-color' as any]: pulsed ? display.accent : undefined,
      }}
    >

      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : (
        dot
      )}
      {showSlot && (
        <span className="text-muted-foreground uppercase tracking-wide text-[10px]">
          {slotDisplay}
        </span>
      )}

      <span className="truncate max-w-[180px]">
        {loading ? 'Loading…' : display.shortLabel}
      </span>
    </span>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <div className="space-y-1">
            <div className="font-semibold">{display.longLabel}</div>
            <div className="text-muted-foreground">
              Slot: <span className="text-foreground">{slotLabel}</span>
            </div>
            {assignment && (
              <>
                <div className="text-muted-foreground">
                  Route: <span className="text-foreground">{assignment.route}</span>
                </div>
                {assignment.fallback_chain?.length > 0 && (
                  <div className="text-muted-foreground">
                    Fallbacks:{' '}
                    <span className="text-foreground">
                      {assignment.fallback_chain.map((f) => f.model_id).join(' → ')}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="pt-1 text-[10px] text-muted-foreground">
              Change in Model Hub → auto-syncs everywhere.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
