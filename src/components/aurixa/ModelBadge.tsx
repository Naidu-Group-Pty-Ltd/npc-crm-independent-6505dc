import * as React from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ModelBadge — Phase 6 primitive.
 *
 * Persistent chip surfaced in every AI surface header showing the current
 * model binding (sourced from the Model Hub). Consumers pass the display
 * name and optional provider tag; changes should be reflected in real time
 * via the caller's binding subscription.
 */

export interface ModelBadgeProps {
  /** Human-readable model name, e.g. "Gemini 3.6 Flash". */
  model: string;
  /** Optional provider tag ("Google", "OpenAI", "OpenRouter"). */
  provider?: string;
  /** Optional short binding context ("Report Q&A", "Copilot"). */
  binding?: string;
  /** Optional click handler — e.g. open Model Hub. */
  onClick?: () => void;
  /** Whether the binding is currently syncing/changing. */
  syncing?: boolean;
  className?: string;
}

export function ModelBadge({
  model,
  provider,
  binding,
  onClick,
  syncing = false,
  className,
}: ModelBadgeProps) {
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={binding ? `${binding} · ${model}${provider ? ` (${provider})` : ''}` : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        'border-[color:var(--glass-hairline)] [background:var(--glass-tint)] text-foreground/90',
        onClick && 'transition-colors hover:border-primary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
        'motion-reduce:transition-none',
        className,
      )}
    >
      <Cpu className={cn('h-3.5 w-3.5 text-primary', syncing && 'animate-pulse motion-reduce:animate-none')} aria-hidden="true" />
      {binding && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{binding}</span>
      )}
      <span className="truncate">{model}</span>
      {provider && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {provider}
        </span>
      )}
    </Wrapper>
  );
}

export default ModelBadge;
