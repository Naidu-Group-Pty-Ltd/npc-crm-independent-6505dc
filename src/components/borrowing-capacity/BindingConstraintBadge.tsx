import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Lock, TrendingUp, Infinity as InfinityIcon, AlertTriangle } from 'lucide-react';
import {
  computeBindingConstraint,
  type BindingConstraintAnalysis,
  type BindingConstraintKind,
} from '@/utils/bindingConstraint';
import type {
  BorrowingCapacityInput,
  BorrowingCapacityResult,
} from '@/utils/borrowingCapacityCalculations';

interface BindingConstraintBadgeProps {
  inputs: BorrowingCapacityInput;
  result: BorrowingCapacityResult;
  /** Optional pre-computed analysis (skip recompute). */
  analysis?: BindingConstraintAnalysis;
  /** Compact = badge only with tooltip; expanded = badge + 3-way breakdown card. */
  variant?: 'compact' | 'expanded';
  className?: string;
}

const KIND_META: Record<
  BindingConstraintKind,
  { icon: typeof Lock; tone: string }
> = {
  surplus: { icon: TrendingUp, tone: 'bg-primary/10 text-primary border-primary/30' },
  dti_cap: { icon: Lock, tone: 'bg-brand-500/10 text-brand-600 border-brand-500/30 dark:text-brand-400' },
  absolute_max: { icon: InfinityIcon, tone: 'bg-accent/10 text-accent border-accent/30 dark:text-accent' },
  none: { icon: AlertTriangle, tone: 'bg-destructive/10 text-destructive border-destructive/30' },
};

export function BindingConstraintBadge({
  inputs,
  result,
  analysis,
  variant = 'compact',
  className,
}: BindingConstraintBadgeProps) {
  const a = analysis ?? computeBindingConstraint(inputs, result);
  const meta = KIND_META[a.binding];
  const Icon = meta.icon;

  if (variant === 'compact') {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`gap-1.5 border ${meta.tone} cursor-help ${className ?? ''}`}
            >
              <Icon className="h-3 w-3" />
              <span className="text-[11px] font-medium">Binding: {a.bindingLabel}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
            <p className="font-semibold mb-1">Why this matters</p>
            <p>{a.explanation}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Expanded: badge + breakdown of all candidates
  return (
    <div className={`rounded-lg border bg-card/60 p-3 space-y-2 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={`gap-1.5 ${meta.tone}`}>
          <Icon className="h-3 w-3" />
          <span className="text-[11px] font-medium">Binding: {a.bindingLabel}</span>
        </Badge>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-sm text-xs leading-relaxed">
              <p>{a.explanation}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{a.explanation}</p>

      <div className="grid grid-cols-3 gap-2 pt-1">
        {a.candidates.map((c) => {
          const isBinding = c.kind === a.binding;
          const cMeta = KIND_META[c.kind];
          const CIcon = cMeta.icon;
          return (
            <TooltipProvider key={c.kind} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`p-2 rounded border text-center cursor-help transition-colors ${
                      isBinding
                        ? cMeta.tone
                        : 'bg-muted/40 border-border text-muted-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <CIcon className="h-3 w-3" />
                      <span className="text-[10px] font-medium uppercase tracking-wide">
                        {c.label}
                      </span>
                    </div>
                    <p className={`text-xs font-semibold ${isBinding ? '' : 'text-foreground/70'}`}>
                      {c.capacity !== null ? formatCapacity(c.capacity) : '—'}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  <p className="font-semibold mb-1">{c.label}</p>
                  <p>{c.detail}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}

function formatCapacity(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString('en-AU')}`;
}
