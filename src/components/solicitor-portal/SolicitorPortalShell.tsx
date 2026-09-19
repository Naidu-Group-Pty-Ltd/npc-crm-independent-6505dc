import type { ReactNode } from 'react';
import { Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SolicitorPortalShellProps {
  title: string;
  description?: string;
  /** Small uppercase label above the title. Defaults to "Solicitor Portal". */
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Page-level heading/content used inside the single SolicitorPortalLayout.
 * Mirrors the Client Portal's `client-portal-page-header` treatment so every
 * solicitor page opens with the same gradient hero as the other portals.
 */
export function SolicitorPortalShell({
  title,
  description,
  eyebrow = 'Solicitor Portal',
  actions,
  className,
  children,
}: SolicitorPortalShellProps) {
  return (
    <div className={cn('space-y-6 md:space-y-8', className)}>
      <header className="solicitor-portal-page-header">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-1 flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary/60" aria-hidden />
                <span className="text-xs font-medium uppercase tracking-widest text-primary/70">{eyebrow}</span>
              </div>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </div>
  );
}
