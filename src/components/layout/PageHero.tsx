import type { ReactNode } from 'react';
import { DashboardThemeFrame } from './DashboardThemeFrame';
import { cn } from '@/lib/utils';
import { getLightModeModuleVisual, lightModeModuleVisuals, type LightModeModuleVisualKey } from '@/config/moduleVisuals';

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  imageVariant?: LightModeModuleVisualKey;
  actions?: ReactNode;
  className?: string;
}

export function PageHero({ eyebrow, title, subtitle, imageVariant = 'overview', actions, className }: PageHeroProps) {
  const visual = getLightModeModuleVisual(imageVariant) ?? lightModeModuleVisuals.overview;
  // The hero is a glass pane, so its decorative layers are tints rather
  // than fills — every stop carries an alpha and the ambient field reads
  // through. An opaque base here would make the one surface most likely
  // to sit at the top of a page the one surface that isn't glass.
  const overlayClass =
    visual.overlay === 'ivory'
      ? 'from-[hsl(var(--card)/0.62)] via-[hsl(var(--dashboard-surface-elevated)/0.44)]'
      : 'from-[hsl(var(--card)/0.62)] via-[hsl(var(--dashboard-primary-soft)/0.46)]';
  const fallbackGradientClass =
    visual.fallbackGradient === 'brand-studio'
      ? 'bg-[radial-gradient(circle_at_18%_0%,hsl(var(--dashboard-primary-soft)/0.42),transparent_26rem),radial-gradient(circle_at_88%_12%,hsl(var(--accent)/0.12),transparent_22rem),linear-gradient(135deg,hsl(var(--card)/0.34)_0%,hsl(var(--dashboard-surface-elevated)/0.22)_54%,hsl(var(--dashboard-primary-soft)/0.30)_100%)]'
      : visual.fallbackGradient === 'ivory'
        ? 'bg-[radial-gradient(circle_at_18%_0%,hsl(var(--card)/0.44),transparent_24rem),linear-gradient(135deg,hsl(var(--card)/0.34)_0%,hsl(var(--dashboard-surface-elevated)/0.22)_58%,hsl(var(--background)/0.28)_100%)]'
        : 'bg-[radial-gradient(circle_at_18%_0%,hsl(var(--dashboard-primary-soft)/0.42),transparent_24rem),linear-gradient(135deg,hsl(var(--card)/0.34)_0%,hsl(var(--dashboard-surface-elevated)/0.22)_54%,hsl(var(--dashboard-primary-soft)/0.30)_100%)]';

  return (
    <DashboardThemeFrame as="header" variant="hero" className={cn('page-hero', className)}>
      <div className={cn('absolute inset-0 dark:hidden', fallbackGradientClass)} aria-hidden="true" />
      <img
        src={visual.image}
        alt={visual.alt}
        className="absolute inset-y-0 right-0 hidden h-full w-1/2 object-cover opacity-0 transition-opacity duration-300 dark:hidden md:block"
        onLoad={(event) => {
          event.currentTarget.classList.remove('opacity-0');
          event.currentTarget.classList.add('opacity-70');
        }}
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <div className={cn('absolute inset-0 bg-gradient-to-r to-transparent dark:hidden', overlayClass)} />
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          {eyebrow ? <p className="dashboard-eyebrow">{eyebrow}</p> : null}
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          {subtitle ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
    </DashboardThemeFrame>
  );
}
