import * as React from 'react';
import { cn } from '@/lib/utils';
import { AuroraHero, type AuroraHeroProps } from './AuroraHero';
import { AurixaMark } from '@/components/agent/AurixaMark';

/**
 * ReportCoverHero — Phase 7 primitive.
 *
 * Standardised cover surface for generated reports. Wraps `AuroraHero`
 * with the brand mark, category chip, canonical property key, and a
 * timestamp strip. All colour / typography via semantic tokens.
 */
export interface ReportCoverHeroProps extends Omit<AuroraHeroProps, 'eyebrow' | 'icon'> {
  category?: React.ReactNode;
  propertyKey?: React.ReactNode;
  generatedAt?: string | Date;
  brandLabel?: React.ReactNode;
  /** Hide the brand mark chip (e.g. when embedded in a shell that shows it). */
  hideBrandMark?: boolean;
}

function formatTimestamp(value?: string | Date): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ReportCoverHero = React.forwardRef<HTMLDivElement, ReportCoverHeroProps>(
  (
    { category, propertyKey, generatedAt, brandLabel, hideBrandMark = false, description, className, children, ...props },
    ref
  ) => {
    const ts = formatTimestamp(generatedAt);

    return (
      <AuroraHero
        ref={ref}
        className={cn('rounded-3xl', className)}
        eyebrow={category}
        icon={!hideBrandMark ? <AurixaMark size="sm" /> : undefined}
        description={description}
        {...props}
      >
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {brandLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.35)] px-2.5 py-1 font-medium uppercase tracking-[0.14em]">
              {brandLabel}
            </span>
          )}
          {propertyKey && (
            <span className="font-mono text-[11px] text-muted-foreground/80">
              <span className="opacity-70">Property · </span>
              {propertyKey}
            </span>
          )}
          {ts && (
            <span className="text-[11px]">
              <span className="opacity-70">Generated · </span>
              {ts}
            </span>
          )}
        </div>
        {children}
      </AuroraHero>
    );
  }
);

ReportCoverHero.displayName = 'ReportCoverHero';

export default ReportCoverHero;
