import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * GlassCard — Phase 1 primitive.
 *
 * Semantic wrapper for the "glass surface" pattern used across the tri-portal.
 * Consumes:
 *   - --glass-tint            (surface fill)
 *   - --glass-hairline        (border)
 *   - --radius-xl             (radius)
 *   - --elevation-1 / 2 / 3   (shadow scale)
 *   - --motion-fast/base       (interaction)
 *
 * Never hardcodes colours. Never sets `text-white` or raw palette classes.
 */
export type GlassCardElevation = 1 | 2 | 3;

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Elevation preset. Defaults to 1 (resting). */
  elevation?: GlassCardElevation;
  /** Adds a subtle interactive hover-lift + focus ring. Defaults to false. */
  interactive?: boolean;
  /** Renders the aurora gradient behind the content (used by AuroraHero). */
  aurora?: boolean;
  /** Removes the default padding — for cards that render their own layout. */
  flush?: boolean;
  asChild?: boolean;
}

const elevationClass: Record<GlassCardElevation, string> = {
  1: 'shadow-[var(--elevation-1)]',
  2: 'shadow-[var(--elevation-2)]',
  3: 'shadow-[var(--elevation-3)]',
};

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  (
    { className, elevation = 1, interactive = false, aurora = false, flush = false, style, children, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'relative isolate overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)] text-foreground backdrop-blur-md',
          elevationClass[elevation],
          !flush && 'p-5',
          interactive &&
            'transition-[transform,box-shadow] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] hover:-translate-y-0.5 hover:shadow-[var(--elevation-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          '[background:var(--glass-tint)] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
          className
        )}
        style={style}
        {...props}
      >
        {aurora && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--aurora-gradient)] opacity-90 motion-reduce:opacity-70"
          />
        )}
        {children}
      </div>
    );
  }
);

GlassCard.displayName = 'GlassCard';

export default GlassCard;
