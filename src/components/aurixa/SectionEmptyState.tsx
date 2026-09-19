import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';

/**
 * SectionEmptyState — Phase 1 primitive.
 *
 * Enforces the AGENTS.md rule: empty states must be actionable.
 * Every consumer supplies a heading, a short description, and at least a
 * primary CTA that describes the next step.
 */
export interface SectionEmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
}

export interface SectionEmptyStateProps {
  icon?: LucideIcon;
  heading: string;
  description?: React.ReactNode;
  primary?: SectionEmptyStateAction;
  secondary?: SectionEmptyStateAction;
  className?: string;
  /** Removes the outer GlassCard shell — for inline usage inside a card that already exists. */
  bare?: boolean;
}

function ActionButton({ action, defaultVariant }: { action: SectionEmptyStateAction; defaultVariant: 'default' | 'outline' }) {
  const variant = action.variant ?? defaultVariant;
  if (action.href) {
    return (
      <Button asChild variant={variant} size="sm">
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function SectionEmptyState({
  icon: Icon,
  heading,
  description,
  primary,
  secondary,
  className,
  bare = false,
}: SectionEmptyStateProps) {
  const body = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-10 text-center',
        className
      )}
    >
      {Icon && (
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--muted)/0.4)] text-primary"
        >
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-foreground">{heading}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {(primary || secondary) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {primary && <ActionButton action={primary} defaultVariant="default" />}
          {secondary && <ActionButton action={secondary} defaultVariant="outline" />}
        </div>
      )}
    </div>
  );

  if (bare) return body;
  return <GlassCard elevation={1}>{body}</GlassCard>;
}

export default SectionEmptyState;
