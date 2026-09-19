/**
 * Batch 13 #68 — Empty states with suggested actions (finance portal flavour).
 *
 * Wraps the existing PortalEmptyState pattern and adds an optional secondary
 * action so we can always surface a "next best step" instead of a dead end.
 */
import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface FinanceEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  hint?: string;
  className?: string;
}

export function FinanceEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
  hint,
  className,
}: FinanceEmptyStateProps) {
  return (
    <Card className={cn('relative overflow-hidden border-dashed', className)}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/20 via-primary/70 to-primary/20" />
      <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center sm:px-10 sm:py-14">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        {(actionLabel || secondaryLabel) && (
          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            {actionLabel && onAction && (
              <Button type="button" onClick={onAction} className="min-h-10 gap-2 rounded-xl px-5">
                {actionLabel}
              </Button>
            )}
            {secondaryLabel && onSecondaryAction && (
              <Button
                type="button"
                variant="outline"
                onClick={onSecondaryAction}
                className="min-h-10 gap-2 rounded-xl px-5"
              >
                {secondaryLabel}
              </Button>
            )}
          </div>
        )}
        {hint && (
          <p className="mt-4 text-[11px] uppercase tracking-widest text-muted-foreground/60">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
