import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Printer, Share2, Download, Check } from 'lucide-react';

/**
 * ReportActionDock — Phase 7 primitive.
 *
 * Floating glass action cluster anchored to the right edge of long-form
 * report surfaces. Provides copy-link / print / share / download affordances
 * with consistent tooltip labels, keyboard access, and a copy-state cue.
 * Consumes only semantic tokens.
 */
export interface ReportActionDockAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void | Promise<void>;
  /** When true, briefly shows the "done" check after selection. */
  transient?: boolean;
  disabled?: boolean;
}

export interface ReportActionDockProps extends React.HTMLAttributes<HTMLDivElement> {
  onCopyLink?: () => void | Promise<void>;
  onPrint?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
  /** Extra actions appended after the built-ins. */
  extraActions?: ReportActionDockAction[];
  /** Vertical anchor. Defaults to `right`. */
  side?: 'left' | 'right';
}

export const ReportActionDock = React.forwardRef<HTMLDivElement, ReportActionDockProps>(
  ({ onCopyLink, onPrint, onShare, onDownload, extraActions = [], side = 'right', className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(async () => {
      try {
        if (onCopyLink) {
          await onCopyLink();
        } else if (typeof window !== 'undefined') {
          await navigator.clipboard.writeText(window.location.href);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        /* swallow — clipboard denials are non-fatal */
      }
    }, [onCopyLink]);

    const actions: ReportActionDockAction[] = [
      {
        id: 'copy',
        label: copied ? 'Link copied' : 'Copy link',
        icon: copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />,
        onSelect: handleCopy,
      },
      ...(onShare
        ? [{ id: 'share', label: 'Share', icon: <Share2 className="h-4 w-4" />, onSelect: onShare }]
        : []),
      ...(onPrint
        ? [{ id: 'print', label: 'Print', icon: <Printer className="h-4 w-4" />, onSelect: onPrint }]
        : []),
      ...(onDownload
        ? [{ id: 'download', label: 'Download', icon: <Download className="h-4 w-4" />, onSelect: onDownload }]
        : []),
      ...extraActions,
    ];

    return (
      <TooltipProvider delayDuration={200}>
        <div
          ref={ref}
          className={cn(
            'aurixa-hairline pointer-events-auto fixed top-1/2 z-40 -translate-y-1/2 rounded-2xl p-1.5 shadow-[var(--elevation-2)]',
            side === 'right' ? 'right-4 md:right-6' : 'left-4 md:left-6',
            'hidden md:flex md:flex-col md:gap-1',
            className
          )}
          role="toolbar"
          aria-label="Report actions"
          {...props}
        >
          {actions.map((action) => (
            <Tooltip key={action.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={action.disabled}
                  onClick={() => void action.onSelect()}
                  className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={action.label}
                >
                  {action.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={side === 'right' ? 'left' : 'right'} className="text-xs">
                {action.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    );
  }
);

ReportActionDock.displayName = 'ReportActionDock';

export default ReportActionDock;
