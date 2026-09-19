import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type CallStateTone = 'amber' | 'emerald' | 'blue' | 'purple' | 'neutral' | 'danger';

const toneStyles: Record<CallStateTone, string> = {
  amber: 'border-brand-300/20 bg-brand-300/10 text-brand-200 shadow-brand-500/10',
  emerald: 'border-success/20 bg-success/10 text-success shadow-success/10',
  blue: 'border-info/20 bg-info/10 text-info shadow-info/10',
  purple: 'border-accent/20 bg-accent/10 text-accent shadow-accent/10',
  neutral: 'border-border/20 bg-muted/40 text-muted-foreground dark:text-foreground shadow-sm dark:shadow-black/20',
  danger: 'border-destructive/20 bg-destructive/10 text-destructive shadow-destructive/10',
};

interface CallStatePanelProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: CallStateTone;
  className?: string;
}

export const CallStatePanel = ({
  icon,
  title,
  description,
  action,
  tone = 'amber',
  className,
}: CallStatePanelProps) => (
  <div
    className={cn(
      'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/90 via-background dark:via-black/65 to-card dark:to-background/90 px-6 py-12 text-center shadow-inner shadow-sm dark:shadow-black/30',
      className
    )}
  >
    <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/40 to-transparent" />
    <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-brand-500/10 blur-3xl" />
    <div className="relative z-10 mx-auto flex max-w-md flex-col items-center">
      <div className={cn('mb-4 rounded-3xl border p-4 shadow-lg', toneStyles[tone])}>
        {icon}
      </div>
      <p className="font-semibold text-foreground dark:text-foreground">{title}</p>
      {description && <div className="mt-2 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  </div>
);
