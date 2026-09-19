import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * DetailDrawer — Phase 5 primitive.
 *
 * Right-side glass drawer used to preview a row without leaving list context
 * (Clients, Deals, Reports, Listings). Sticky footer, scrollable body,
 * accessible close via ⎋ and the close button.
 */

export type DetailDrawerWidth = 'sm' | 'md' | 'lg' | 'xl';

const widthClass: Record<DetailDrawerWidth, string> = {
  sm: 'sm:w-[420px]',
  md: 'sm:w-[520px]',
  lg: 'sm:w-[640px]',
  xl: 'sm:w-[780px]',
};

export interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  footer?: React.ReactNode;
  width?: DetailDrawerWidth;
  className?: string;
  bodyClassName?: string;
  /** Optional actions rendered inline to the right of the title. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  footer,
  width = 'md',
  className,
  bodyClassName,
  headerActions,
  children,
}: DetailDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-background/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden',
            'inset-y-0 right-0 w-full max-w-full',
            widthClass[width],
            'border-l border-[color:var(--glass-hairline)] [background:var(--glass-tint)] backdrop-blur-xl shadow-[var(--elevation-3)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            'motion-reduce:animate-none',
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[image:var(--aurora-gradient)] opacity-40"
          />

          <header className="relative flex items-start gap-3 border-b border-[color:var(--glass-hairline)] px-5 py-4">
            {eyebrow && <div className="mt-0.5 shrink-0">{eyebrow}</div>}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {headerActions && (
              <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
            )}
            <DialogPrimitive.Close
              className={cn(
                'shrink-0 rounded-md p-2 text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 flex items-center justify-center',
              )}
              aria-label="Close details"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </header>

          <div className={cn('relative min-h-0 flex-1', bodyClassName)}>
            <ScrollArea className="h-full">
              <div className="px-5 py-4">{children}</div>
            </ScrollArea>
          </div>

          {footer && (
            <footer className="relative flex shrink-0 items-center gap-2 border-t border-[color:var(--glass-hairline)] bg-background/40 px-5 py-3">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default DetailDrawer;
