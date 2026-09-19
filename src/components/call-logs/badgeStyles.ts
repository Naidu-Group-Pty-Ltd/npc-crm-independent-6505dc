import { cn } from '@/lib/utils';

export type CallLogBadgeTone =
  | 'success'
  | 'danger'
  | 'warning'
  | 'attention'
  | 'info'
  | 'squad'
  | 'neutral'
  | 'tag';

export const callLogBadgeBase =
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium leading-none shadow-sm transition-colors';

/**
 * Tones read from the semantic + categorical tokens rather than fixed Tailwind
 * hues, so call-log badges follow white-label branding and stay in step with
 * <StatusBadge>. `attention` and `squad` have no semantic equivalent (they are
 * categories, not health signals), so they borrow the categorical chart ramp.
 */
const callLogBadgeTones: Record<CallLogBadgeTone, string> = {
  success: 'border-success/30 bg-success/10 text-success shadow-success/10',
  danger: 'border-destructive/35 bg-destructive/10 text-destructive shadow-destructive/10',
  warning: 'border-warning/35 bg-warning/10 text-warning shadow-warning/10',
  attention: 'border-chart-6/35 bg-chart-6/10 text-chart-6 shadow-chart-6/10',
  info: 'border-info/30 bg-info/10 text-info shadow-info/10',
  squad: 'border-chart-5/35 bg-chart-5/10 text-chart-5 shadow-chart-5/10',
  neutral: 'border-border bg-muted/60 text-muted-foreground',
  tag: 'border-brand/30 bg-brand/10 text-brand-700 shadow-brand/10 dark:text-brand',
};

export const callLogBadgeTone = (tone: CallLogBadgeTone, className?: string) =>
  cn(callLogBadgeBase, callLogBadgeTones[tone], className);

