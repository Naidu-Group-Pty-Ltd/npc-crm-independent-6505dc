import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DashboardThemeFrameVariant =
  | 'page'
  | 'hero'
  | 'section'
  | 'sectionAccent'
  | 'card'
  | 'premiumCard'
  | 'chartCard'
  | 'toolbar';

type DashboardThemeFrameElement = 'div' | 'section' | 'main' | 'article' | 'header';

interface DashboardThemeFrameProps extends HTMLAttributes<HTMLElement> {
  as?: DashboardThemeFrameElement;
  variant?: DashboardThemeFrameVariant;
  children: ReactNode;
}

/**
 * Layout, radius and spacing only.
 *
 * Every surface here is a glass pane, and the material — fill, edge,
 * sheen, blur and shadow — is defined once per variant in
 * src/styles/glass.css against the `dashboard-theme-*` class. Tailwind
 * emits utilities after the components layer, so a `bg-*`, `shadow-*`,
 * `ring-*` or `backdrop-blur` utility here would paint straight back
 * over the glass. Change the material in glass.css, not here.
 */
const variantClasses: Record<DashboardThemeFrameVariant, string> = {
  page: 'dashboard-theme-frame mx-auto w-full max-w-[1600px] min-w-0 overflow-x-hidden',
  hero:
    'dashboard-theme-hero relative overflow-hidden rounded-[1.5rem] border p-4 sm:rounded-[2rem] sm:p-5 md:p-7',
  section:
    'dashboard-theme-section relative min-w-0 overflow-hidden rounded-[1.5rem] border p-4 sm:rounded-[1.85rem] sm:p-5 md:p-6',
  sectionAccent:
    'dashboard-theme-section dashboard-theme-section-accent relative min-w-0 overflow-hidden rounded-[1.5rem] border p-4 sm:rounded-[1.85rem] sm:p-5 md:p-6',
  card:
    'dashboard-theme-card rounded-2xl border transition-all duration-200',
  premiumCard:
    'dashboard-theme-premium-card glass-interactive group min-w-0 overflow-hidden rounded-2xl border',
  chartCard:
    'dashboard-theme-chart-card glass-interactive group min-w-0 overflow-hidden rounded-2xl border',
  toolbar:
    'dashboard-theme-toolbar flex w-full flex-wrap items-stretch gap-2 rounded-2xl border p-2 sm:items-center',
};

export const DashboardThemeFrame = forwardRef<HTMLElement, DashboardThemeFrameProps>(
  ({ as: Component = 'div', variant = 'section', className, children, ...props }, ref) => (
    <Component ref={ref as any} className={cn(variantClasses[variant], className)} {...props}>
      {children}
    </Component>
  )
);

DashboardThemeFrame.displayName = 'DashboardThemeFrame';
