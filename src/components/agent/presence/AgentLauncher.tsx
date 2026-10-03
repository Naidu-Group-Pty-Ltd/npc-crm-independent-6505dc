/**
 * AgentLauncher — the closed state of Aurixa, which is no longer asleep.
 *
 * A closed chat widget used to be a button and nothing else, so work the
 * agent was still doing — a reply streaming in after the panel was shut — was
 * invisible until it was opened again. The launcher is the presence at rest,
 * and it grows into a capsule that says what Aurixa is doing ("Checking your
 * calendar…"), that it needs a go-ahead, or that a reply is ready. It shrinks
 * back to the orb when there is nothing to say.
 *
 * Position, stacking and the unread badge are exactly the old button's, so
 * nothing about where it sits or what it counts changes.
 */
import { AurixaPresence } from './AurixaPresence';
import type { Presence } from '@/lib/agent/presence.pure';
import { cn } from '@/lib/utils';
import '../aurixa.css';

export interface AgentLauncherProps {
  presence: Presence;
  /** Say the status in the capsule (the agent is busy, waiting or done). */
  expanded: boolean;
  badge: number;
  shortcut: string;
  onOpen: () => void;
}

export function AgentLauncher({ presence, expanded, badge, shortcut, onOpen }: AgentLauncherProps) {
  const tone = presence.mood === 'attention' ? 'attention' : presence.mood === 'done' ? 'done' : 'default';
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        data-expanded={expanded ? 'true' : 'false'}
        data-tone={tone}
        className="aurixa-launcher group fixed bottom-[5.5rem] right-4 z-[55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 md:bottom-6 md:right-6 md:z-40"
        aria-label={expanded ? `Open Aurixa — ${presence.status}` : 'Open Aurixa'}
        title={`Ask Aurixa (${shortcut})`}
      >
        <AurixaPresence mood={presence.mood} size={46} />
        <span className="aurixa-launcher__label flex flex-col items-start text-left leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Aurixa</span>
          <span
            className={cn(
              'aurixa-launcher__status max-w-[15rem] text-[13px] font-medium',
              tone === 'attention' ? 'text-brand' : 'text-foreground',
            )}
          >
            {presence.status}
          </span>
        </span>
        {badge > 0 && (
          <span className="absolute left-9 -top-0.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border border-background bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground shadow-[0_0_0_2px_hsl(var(--background))]">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {expanded ? presence.status : ''}
      </span>
    </>
  );
}
