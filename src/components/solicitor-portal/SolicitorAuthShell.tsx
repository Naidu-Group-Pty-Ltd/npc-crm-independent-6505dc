import { ReactNode } from 'react';
import { BrandLogo } from '@/components/branding/BrandAssets';
import { useBrand } from '@/branding/useTokens';

/**
 * Shared chrome for the unauthenticated Solicitor Portal surfaces
 * (login, invite acceptance, password reset). Aurora backdrop + glass shell,
 * matching the Command Centre auth pages.
 */
export function SolicitorAuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { settings } = useBrand();

  return (
    <div className="solicitor-portal-theme relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60% 45% at 15% 10%, hsl(var(--primary) / 0.20), transparent 60%), radial-gradient(50% 40% at 85% 0%, hsl(var(--accent) / 0.16), transparent 62%), radial-gradient(70% 55% at 50% 100%, hsl(var(--primary) / 0.10), transparent 65%)',
        }}
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-4 flex justify-center">
              <BrandLogo
                slot="auth"
                alt={settings.companyName || 'Solicitor Portal'}
                className="h-14 max-w-[220px] object-contain"
                fallbackClassName="h-14 w-14 rounded-2xl border border-primary/30"
              />
            </div>
            <p className="text-base font-semibold tracking-tight text-foreground">{settings.companyName}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.35em] text-primary">Solicitor Portal</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>

          <div className="glass-raised rounded-2xl p-6 sm:p-8">
            {children}
          </div>

          {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
