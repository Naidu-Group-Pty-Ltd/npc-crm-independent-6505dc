import { cn } from '@/lib/utils';

export const pipelineBadgeBase =
  'inline-flex min-w-0 max-w-full items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold leading-4 tracking-[0.01em] shadow-sm [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0 [&>span]:min-w-0 [&>span]:truncate';

export const pipelineBadgeCompact =
  'inline-flex min-w-0 max-w-full items-center justify-center gap-1 rounded-full border px-1.5 py-0 text-[9px] font-bold leading-3 shadow-sm [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:shrink-0 [&>span]:min-w-0 [&>span]:truncate';

/** Token-driven so pipeline badges re-theme with the brand; `gold` is the
 *  brand accent itself rather than a fixed yellow. */
export const badgeTones = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/35 bg-warning/10 text-warning',
  danger: 'border-destructive/35 bg-destructive/10 text-destructive',
  gold: 'border-brand/35 bg-brand/10 text-brand-700 dark:text-brand',
  neutral: 'border-border bg-muted/60 text-muted-foreground',
  info: 'border-info/30 bg-info/10 text-info',
} as const;

export function pipelineBadgeClass(tone: keyof typeof badgeTones, compact = false, extra?: string) {
  return cn(compact ? pipelineBadgeCompact : pipelineBadgeBase, badgeTones[tone], extra);
}
