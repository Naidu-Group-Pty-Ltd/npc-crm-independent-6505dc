import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * StatusPill — a compact, monospaced semantic status chip used across
 * insights, plans, skills, and tool cards. Presentational only.
 */
export type StatusPillTone =
  | 'neutral'
  | 'brand'
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive';

interface StatusPillProps {
  tone?: StatusPillTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  pulse?: boolean;
}

const toneClasses: Record<StatusPillTone, string> = {
  neutral:
    'border-border/70 bg-muted/40 text-muted-foreground',
  brand:
    'border-brand/40 bg-brand/10 text-brand',
  info:
    'border-info/40 bg-info/10 text-info',
  success:
    'border-success/40 bg-success/10 text-success',
  warning:
    'border-warning/40 bg-warning/10 text-warning',
  destructive:
    'border-destructive/40 bg-destructive/10 text-destructive',
};

export function StatusPill({
  tone = 'neutral',
  icon,
  children,
  className,
  pulse = false,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
        toneClasses[tone],
        className
      )}
    >
      {pulse ? (
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-current',
            'animate-aurixa-breathe'
          )}
        />
      ) : icon ? (
        <span aria-hidden className="[&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export default StatusPill;
