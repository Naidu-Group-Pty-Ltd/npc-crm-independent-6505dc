import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * AurixaSectionHeader — display-serif title with a monospaced eyebrow
 * and an optional right-hand action slot. Presentational only.
 */
interface AurixaSectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  align?: 'left' | 'center';
}

export function AurixaSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  align = 'left',
}: AurixaSectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        align === 'center' && 'sm:flex-col sm:items-center sm:text-center',
        className
      )}
    >
      <div className={cn('min-w-0 flex-1', align === 'center' && 'text-center')}>
        {eyebrow ? (
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-heading text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl md:text-[2rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default AurixaSectionHeader;
