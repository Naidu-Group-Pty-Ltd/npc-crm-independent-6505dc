import * as React from 'react';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';

/**
 * AuroraHero — Phase 2 primitive.
 *
 * Full-bleed page hero used at the top of dashboard surfaces. Wraps
 * `GlassCard` with the aurora backdrop enabled and provides slots for
 * eyebrow/title/description/actions. Never hardcodes colours or fonts;
 * consumes semantic tokens exclusively.
 */
export interface AuroraHeroProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  align?: 'start' | 'center';
}

export const AuroraHero = React.forwardRef<HTMLDivElement, AuroraHeroProps>(
  ({ eyebrow, title, description, icon, actions, align = 'start', className, children, ...props }, ref) => {
    return (
      <GlassCard
        ref={ref}
        aurora
        elevation={2}
        className={cn('overflow-hidden px-6 py-6 md:px-8 md:py-8', className)}
        {...props}
      >
        <div
          className={cn(
            'relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between',
            align === 'center' && 'lg:items-center'
          )}
        >
          <div className="min-w-0 max-w-3xl">
            {eyebrow && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.45)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {icon}
                <span>{eyebrow}</span>
              </div>
            )}
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">{title}</h1>
            {description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {actions}
            </div>
          )}
        </div>
        {children}
      </GlassCard>
    );
  }
);

AuroraHero.displayName = 'AuroraHero';

export default AuroraHero;
