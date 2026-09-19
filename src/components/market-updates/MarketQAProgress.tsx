/**
 * Live research progress for a Market Q&A turn.
 *
 * A deeper answer takes longer to assemble, and an undifferentiated "Thinking…"
 * spinner makes that read as a hang. The endpoint emits a stage event as each
 * phase of the pipeline starts, so the wait shows what is actually happening —
 * which queries were planned, how many updates were retrieved, from how many
 * sources.
 *
 * Semantic design tokens only (see FRONTEND_TOOLING.md).
 */
import { Brain, CheckCircle2, Layers, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketQAStage } from '@/types/marketUpdates';

const ORDER: Array<MarketQAStage['stage']> = ['planning', 'searching', 'reading', 'analysing'];

const ICONS: Record<MarketQAStage['stage'], typeof Search> = {
  planning: Brain,
  searching: Search,
  reading: Layers,
  analysing: Brain,
};

export function MarketQAProgress({ stage, className }: { stage: MarketQAStage | null; className?: string }) {
  const currentIndex = stage ? ORDER.indexOf(stage.stage) : -1;
  const Icon = stage ? ICONS[stage.stage] : Loader2;

  return (
    <div className={cn('rounded-lg border border-border/60 bg-background/70 p-2.5', className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs text-foreground">
        <Icon className={cn('h-3.5 w-3.5 text-primary', !stage && 'animate-spin')} aria-hidden />
        <span className="font-medium">{stage?.label ?? 'Starting research…'}</span>
        <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
      </div>

      <div className="mt-2 flex items-center gap-1" aria-hidden>
        {ORDER.map((step, index) => (
          <span
            key={step}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < currentIndex ? 'bg-primary' : index === currentIndex ? 'bg-primary/60' : 'bg-muted',
            )}
          />
        ))}
      </div>

      {stage?.queries && stage.queries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {stage.queries.slice(0, 5).map((query, index) => (
            <span key={index} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              <Search className="h-2.5 w-2.5" aria-hidden />{query}
            </span>
          ))}
        </div>
      )}

      {typeof stage?.context_size === 'number' && stage.context_size > 0 && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-2.5 w-2.5 text-primary" aria-hidden />
          {stage.context_size} update{stage.context_size === 1 ? '' : 's'}
          {stage.sources ? ` from ${stage.sources} source${stage.sources === 1 ? '' : 's'}` : ''}
          {stage.retrieval_mode ? ` · ${stage.retrieval_mode} retrieval` : ''}
        </p>
      )}
    </div>
  );
}
