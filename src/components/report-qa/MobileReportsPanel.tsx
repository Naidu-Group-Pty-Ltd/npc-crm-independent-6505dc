import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileReportsPanelProps {
  children: React.ReactNode;
  reportCount: number;
  className?: string;
}

export function MobileReportsPanel({ children, reportCount, className }: MobileReportsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Auto-close on navigation or when reports are cleared
  useEffect(() => {
    if (reportCount === 0) {
      setIsOpen(false);
    }
  }, [reportCount]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "lg:hidden fixed bottom-20 left-4 z-40 shadow-lg gap-2",
            className
          )}
          aria-label={`Open reports panel (${reportCount} reports)`}
        >
          <FileText className="h-4 w-4" />
          Reports
          {reportCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
              {reportCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85vw] max-w-md p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Reports ({reportCount})
          </SheetTitle>
        </SheetHeader>
        <div className="p-4 overflow-auto h-[calc(100vh-5rem)]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Re-export swipe gesture hook from shared location
export { useSwipeGesture } from '@/hooks/useSwipeGesture';

// Collapsible panel for desktop
interface CollapsibleSidePanelProps {
  children: React.ReactNode;
  isCollapsed: boolean;
  onToggle: () => void;
  side: 'left' | 'right';
  title?: string;
}

export function CollapsibleSidePanel({
  children,
  isCollapsed,
  onToggle,
  side,
  title
}: CollapsibleSidePanelProps) {
  const Icon = side === 'left' 
    ? (isCollapsed ? ChevronRight : ChevronLeft)
    : (isCollapsed ? ChevronLeft : ChevronRight);

  return (
    <div 
      className={cn(
        "relative transition-all duration-300 ease-in-out motion-reduce:transition-none",
        isCollapsed ? "w-0 overflow-hidden" : "w-full"
      )}
    >
      {!isCollapsed && children}
      
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "absolute top-1/2 -translate-y-1/2 h-8 w-6 rounded-full border bg-background shadow-sm z-10",
          side === 'left' ? "-right-3" : "-left-3"
        )}
        onClick={onToggle}
        aria-label={isCollapsed ? `Show ${title || 'panel'}` : `Hide ${title || 'panel'}`}
        aria-expanded={!isCollapsed}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </div>
  );
}
