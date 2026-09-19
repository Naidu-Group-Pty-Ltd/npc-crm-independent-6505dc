/**
 * Depth control for Ask Aurixa.
 *
 * Depth is the single dial trading turnaround for breadth: it sets how many
 * search queries are planned, how many updates reach the model and how long the
 * answer may run. Leaving it on Auto lets the endpoint infer depth from the
 * question, which is right most of the time — the explicit modes exist for when
 * the user knows they want a one-line fact or a full dossier.
 *
 * Semantic design tokens only (see FRONTEND_TOOLING.md).
 */
import { Gauge, Layers, Telescope, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketQADepth } from '@/types/marketUpdates';

export type DepthChoice = MarketQADepth | 'auto';

const OPTIONS: Array<{ id: DepthChoice; label: string; hint: string; icon: typeof Zap }> = [
  { id: 'auto', label: 'Auto', hint: 'Match the depth to the question', icon: Gauge },
  { id: 'brief', label: 'Quick', hint: 'Direct answer from the closest sources', icon: Zap },
  { id: 'standard', label: 'Standard', hint: 'Analysis across related coverage', icon: Layers },
  { id: 'deep', label: 'Deep dive', hint: 'Full dossier across the widest source set', icon: Telescope },
];

export function MarketQADepthSelector({ value, onChange, disabled }: { value: DepthChoice; onChange: (value: DepthChoice) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Research depth">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Depth</span>
      {OPTIONS.map(({ id, label, hint, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              active
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />{label}
          </button>
        );
      })}
    </div>
  );
}
