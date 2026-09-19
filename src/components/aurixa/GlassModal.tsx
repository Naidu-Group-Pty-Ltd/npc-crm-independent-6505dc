import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * GlassModal — Phase 5 primitive.
 *
 * Standardises every dialog on:
 *   - `h-[90vh]` bounded shell with an internal `ScrollArea` (per project memory).
 *   - Aurixa glass surface (border-[color:var(--glass-hairline)], aurora tint).
 *   - Header slot, scroll body, sticky footer with primary/secondary/destructive slots.
 *   - Always closable via ⎋ (Radix default) + accessible close button.
 *
 * Consumers compose:
 *   <GlassModal open={open} onOpenChange={setOpen}
 *     title="..." description="..." size="lg"
 *     footer={<GlassModalActions primary={...} secondary={...} />}>
 *     {body}
 *   </GlassModal>
 */

export type GlassModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClass: Record<GlassModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-6xl',
};

export interface GlassModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Icon or badge rendered before the title. */
  eyebrow?: React.ReactNode;
  /** Sticky footer content — usually a `<GlassModalActions />`. */
  footer?: React.ReactNode;
  size?: GlassModalSize;
  /** Disable body ScrollArea (rare — only when a nested list virtualises). */
  disableScroll?: boolean;
  /** Additional class for the outer content shell. */
  className?: string;
  /** Additional class for the body region. */
  bodyClassName?: string;
  children: React.ReactNode;
}

export function GlassModal({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  footer,
  size = 'md',
  disableScroll = false,
  className,
  bodyClassName,
  children,
}: GlassModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-background/70 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden',
            'inset-x-0 bottom-0 top-auto w-full rounded-t-2xl border-x-0 border-b-0',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:rounded-[var(--radius-xl)] sm:border',
            sizeClass[size],
            'border-[color:var(--glass-hairline)] [background:var(--glass-tint)] backdrop-blur-xl shadow-[var(--elevation-3)]',
            'h-[92vh] sm:h-[90vh]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95',
            'motion-reduce:animate-none',
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[image:var(--aurora-gradient)] opacity-40"
          />

          <header className="relative flex items-start gap-4 border-b border-[color:var(--glass-hairline)] px-6 py-5">
            {eyebrow && <div className="mt-0.5 shrink-0">{eyebrow}</div>}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className={cn(
                'shrink-0 rounded-md p-2 text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center',
              )}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </header>

          <div className={cn('relative min-h-0 flex-1', bodyClassName)}>
            {disableScroll ? (
              <div className="h-full overflow-hidden px-6 py-5">{children}</div>
            ) : (
              <ScrollArea className="h-full">
                <div className="px-6 py-5">{children}</div>
              </ScrollArea>
            )}
          </div>

          {footer && (
            <footer className="relative flex shrink-0 items-center gap-2 border-t border-[color:var(--glass-hairline)] bg-background/40 px-6 py-4">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * GlassModalActions — canonical footer slot layout.
 * Order (left → right): destructive · spacer · secondary · primary.
 */
export interface GlassModalActionsProps {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  destructive?: React.ReactNode;
  /** Optional inline helper text (e.g. autosave hint) rendered on the left. */
  hint?: React.ReactNode;
  className?: string;
}

export function GlassModalActions({
  primary,
  secondary,
  destructive,
  hint,
  className,
}: GlassModalActionsProps) {
  return (
    <div className={cn('flex w-full flex-wrap items-center gap-2', className)}>
      {destructive}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <div className="ml-auto flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}

export default GlassModal;
