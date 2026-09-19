import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, ExternalLink, Image as ImageIcon, Volume2, Sparkles, ChevronDown, ChevronUp, Shield, ShieldOff, Boxes } from 'lucide-react';
import { BrandMark } from '@/components/integrations/BrandMark';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  extractExtras,
  familyFromId,
  familyTint,
  formatContext,
  formatPricePerM,
  formatReleased,
  type ORExtras,
} from '@/lib/openrouter/format';

export interface OpenRouterCardModel {
  model_id: string;
  display_name: string;
  status: string;
  context_window: number | null;
  pricing_input_per_1m: number | null;
  pricing_output_per_1m: number | null;
  raw_metadata?: unknown;
}

interface Props {
  model: OpenRouterCardModel;
  /** cheapest input price in current filter set — used to draw the relative-cost bar */
  cheapestInput?: number;
  /** most expensive input price in current filter set */
  priciestInput?: number;
}

function ModalityIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <ImageIcon className="h-3 w-3" aria-label="image" />;
  if (kind === 'audio') return <Volume2 className="h-3 w-3" aria-label="audio" />;
  return <Sparkles className="h-3 w-3" aria-label="text" />;
}

export function OpenRouterModelCard({ model, cheapestInput, priciestInput }: Props) {
  const [expanded, setExpanded] = useState(false);
  const extras: ORExtras = extractExtras(model.raw_metadata);
  const family = familyFromId(model.model_id);
  const tint = familyTint(family);

  const priceIn = model.pricing_input_per_1m ?? undefined;
  let costPct = 0;
  if (priceIn !== undefined && cheapestInput !== undefined && priciestInput !== undefined && priciestInput > cheapestInput) {
    costPct = Math.min(100, Math.max(4, ((priceIn - cheapestInput) / (priciestInput - cheapestInput)) * 100));
  } else if (priceIn !== undefined) {
    costPct = 8;
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(model.model_id);
      toast.success('Model ID copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="group aurixa-glass relative flex min-w-0 flex-col gap-3 rounded-[20px] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:ring-1 hover:ring-primary/25">
      {extras.isNew && (
        <span className="absolute right-3 top-3 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
          New
        </span>
      )}

      <div className="flex min-w-0 items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border', tint.chip)}>
          <BrandMark integrationId={family} size={22} fallback={<Boxes className="h-4 w-4" />} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-[15px] font-medium leading-tight text-foreground" title={model.display_name}>
            {model.display_name}
          </h3>
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={model.model_id}>{model.model_id}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {model.context_window ? (
          <span className="rounded-full border border-border/60 bg-background/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {formatContext(model.context_window)} ctx
          </span>
        ) : null}
        {[...new Set([...extras.inputModalities, ...extras.outputModalities])].slice(0, 4).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
            <ModalityIcon kind={kind} /> {kind}
          </span>
        ))}
        {extras.isModerated !== undefined && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
            extras.isModerated ? 'border-info/25 bg-info/10 text-info' : 'border-border/60 bg-background/50 text-muted-foreground'
          )}>
            {extras.isModerated ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
            {extras.isModerated ? 'moderated' : 'unmoderated'}
          </span>
        )}
        {model.status !== 'available' && (
          <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.12em]">{model.status}</Badge>
        )}
      </div>

      <div className="rounded-xl border border-border/50 bg-background/40 p-2.5">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">Input</span>
          <span className="font-mono font-semibold text-foreground">{formatPricePerM(priceIn)}<span className="text-muted-foreground"> /1M</span></span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary" style={{ width: `${costPct}%` }} />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">Output</span>
          <span className="font-mono font-semibold text-foreground">{formatPricePerM(model.pricing_output_per_1m ?? undefined)}<span className="text-muted-foreground"> /1M</span></span>
        </div>
        {extras.imagePricePerK !== undefined && (
          <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">Image</span>
            <span className="font-mono text-foreground">${extras.imagePricePerK.toFixed(2)}<span className="text-muted-foreground"> /1K</span></span>
          </div>
        )}
      </div>

      {extras.description && (
        <div>
          <p className={cn('text-[12px] leading-5 text-muted-foreground', !expanded && 'line-clamp-3')}>
            {extras.description}
          </p>
          {extras.description.length > 160 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {expanded ? <>Show less <ChevronUp className="h-3 w-3" /></> : <>Read more <ChevronDown className="h-3 w-3" /></>}
            </button>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          {extras.topProviderName && <span title="Underlying provider">via {extras.topProviderName}</span>}
          {extras.releasedAt && <span className="hidden font-mono sm:inline">· {formatReleased(extras.releasedAt)}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyId} aria-label="Copy model ID">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild aria-label="Open on OpenRouter">
            <a href={`https://openrouter.ai/${model.model_id}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
