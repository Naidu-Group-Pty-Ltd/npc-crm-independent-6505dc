import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ReportLibraryEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function ReportLibraryEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: ReportLibraryEmptyStateProps) {
  return (
    <DashboardThemeFrame variant="section" className="flex min-h-[24rem] flex-col items-center justify-center p-8 text-center">
      <div className="pointer-events-none absolute -top-24 h-52 w-52 rounded-full bg-brand-400/10 blur-3xl" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-400/25 bg-brand-500/10 text-brand-700 shadow-sm shadow-brand-500/10 dark:text-brand-300">
        <Icon className="h-7 w-7" />
      </div>
      <div className="relative mt-5 max-w-md space-y-2">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="relative mt-6 flex flex-col gap-2 sm:flex-row">
          {actionLabel && onAction && (
            <Button onClick={onAction} className="gap-2 rounded-xl">
              {actionIcon || <ArrowRight className="h-4 w-4" />}
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="outline" onClick={onSecondaryAction} className="gap-2 rounded-xl">
              <RotateCcw className="h-4 w-4" />
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      ) : null}
    </DashboardThemeFrame>
  );
}
