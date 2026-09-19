import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const PortalPanel = forwardRef<ElementRef<typeof Card>, ComponentPropsWithoutRef<typeof Card>>(({ className, ...props }, ref) => (
  <Card ref={ref} className={cn('client-portal-soft-panel', className)} {...props} />
));
PortalPanel.displayName = 'PortalPanel';

export const PortalPanelHeader = forwardRef<ElementRef<typeof CardHeader>, ComponentPropsWithoutRef<typeof CardHeader>>(({ className, ...props }, ref) => (
  <CardHeader ref={ref} className={cn('border-b border-border/50 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent pb-4', className)} {...props} />
));
PortalPanelHeader.displayName = 'PortalPanelHeader';

export const PortalPanelContent = forwardRef<ElementRef<typeof CardContent>, ComponentPropsWithoutRef<typeof CardContent>>(({ className, ...props }, ref) => (
  <CardContent ref={ref} className={cn(className)} {...props} />
));
PortalPanelContent.displayName = 'PortalPanelContent';

export const PortalPanelTitle = forwardRef<ElementRef<typeof CardTitle>, ComponentPropsWithoutRef<typeof CardTitle>>(({ className, ...props }, ref) => (
  <CardTitle ref={ref} className={cn('client-portal-section-title', className)} {...props} />
));
PortalPanelTitle.displayName = 'PortalPanelTitle';

export function portalPanelClassName(className?: string) {
  return cn('client-portal-soft-panel', className);
}

export function portalStatCardClassName(className?: string) {
  return cn('client-portal-stat-card', className);
}