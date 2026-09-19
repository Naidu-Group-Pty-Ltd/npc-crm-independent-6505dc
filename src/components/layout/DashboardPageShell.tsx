import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { DashboardThemeFrame } from './DashboardThemeFrame';

export const DashboardPageShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <DashboardThemeFrame
      ref={ref}
      variant="page"
      className={cn('dashboard-page-shell dashboard-section', className)}
      {...props}
    >
      {children}
    </DashboardThemeFrame>
  )
);

DashboardPageShell.displayName = 'DashboardPageShell';
