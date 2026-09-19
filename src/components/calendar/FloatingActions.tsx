import { Plus, RefreshCw, X, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface FloatingActionsProps {
  onQuickAdd: () => void;
  onRefresh: () => void;
  onClearSelection?: () => void;
  hasSelection?: boolean;
  isRefreshing?: boolean;
  showScrollTop?: boolean;
  onScrollTop?: () => void;
  className?: string;
}

export function FloatingActions({
  onQuickAdd,
  onRefresh,
  onClearSelection,
  hasSelection,
  isRefreshing,
  showScrollTop,
  onScrollTop,
  className,
}: FloatingActionsProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn(
        'fixed bottom-44 right-4 flex flex-col gap-2 z-40 sm:bottom-28 sm:right-6',
        className
      )}>
        {/* Scroll to top */}
        {showScrollTop && onScrollTop && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-full border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-all animate-in fade-in slide-in-from-bottom-2 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95"
                onClick={onScrollTop}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Scroll to top</TooltipContent>
          </Tooltip>
        )}

        {/* Clear selection */}
        {hasSelection && onClearSelection && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-10 w-10 rounded-full border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95"
                onClick={onClearSelection}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Clear selection</TooltipContent>
          </Tooltip>
        )}

        {/* Refresh */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-10 w-10 rounded-full border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Refresh calendar</TooltipContent>
        </Tooltip>

        {/* Quick Add - Primary action */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-[0_14px_36px_hsl(var(--primary)/0.28)] transition-all hover:-translate-y-1 hover:bg-primary/90 hover:shadow-[0_18px_46px_hsl(var(--primary)/0.34)] focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95"
              onClick={onQuickAdd}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="flex items-center gap-2">
              Quick Add
              <kbd className="px-1.5 py-0.5 text-[10px] bg-background/50 rounded border">N</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
