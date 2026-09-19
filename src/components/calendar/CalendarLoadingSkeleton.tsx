import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

interface CalendarLoadingSkeletonProps {
  view: 'month' | 'week' | 'timeline';
}

export function CalendarLoadingSkeleton({ view }: CalendarLoadingSkeletonProps) {
  const isMobile = useIsMobile();
  
  if (view === 'month') {
    // Simplified mobile month skeleton
    const daysToShow = isMobile ? 28 : 35;
    const cellHeight = isMobile ? 'min-h-[60px]' : 'min-h-[80px]';
    
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-2 shadow-inner shadow-sm dark:shadow-black/20">
        {/* Day headers */}
        <div className="mb-1 grid grid-cols-7 gap-1 rounded-xl border border-border bg-muted/60 p-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div key={i} className="text-center py-2">
              <Skeleton className="mx-auto h-4 w-4 rounded-full bg-card/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
        {/* Calendar grid - reduced items on mobile */}
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: daysToShow }).map((_, i) => (
            <div
              key={i}
              className={`${cellHeight} rounded-xl border border-border dark:border-white/5 bg-white/[0.02] p-1.5`}
            >
              <Skeleton className="mb-2 h-5 w-5 rounded-full bg-card/10 dark:bg-white/10" />
              {!isMobile && i % 3 === 0 && <Skeleton className="h-4 w-full rounded-md bg-card/10 dark:bg-white/10" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'week') {
    const hoursToShow = isMobile ? 8 : 12;
    
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-2 shadow-inner shadow-sm dark:shadow-black/20">
        {/* Week headers - simplified on mobile */}
        <div className={`grid ${isMobile ? 'grid-cols-4' : 'grid-cols-8'} gap-1 mb-2`}>
          {!isMobile && <div className="w-16" />}
          {Array.from({ length: isMobile ? 4 : 7 }).map((_, i) => (
            <div key={i} className="text-center py-2">
              <Skeleton className="h-4 w-6 mx-auto mb-1 rounded bg-card/10 dark:bg-white/10" />
              <Skeleton className="h-6 w-6 rounded-full mx-auto bg-card/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
        {/* Time grid - fewer hours on mobile */}
        {Array.from({ length: hoursToShow }).map((_, hour) => (
          <div key={hour} className={`grid ${isMobile ? 'grid-cols-4' : 'grid-cols-8'} gap-1 border-t border-border`}>
            {!isMobile && (
              <div className="w-16 py-1">
                <Skeleton className="h-3 w-10 ml-auto rounded bg-card/10 dark:bg-white/10" />
              </div>
            )}
            {Array.from({ length: isMobile ? 4 : 7 }).map((_, day) => (
              <div key={day} className="min-h-[40px] px-1 py-1 border-l border-border">
                {hour % 3 === 0 && day % 2 === 0 && (
                  <Skeleton className="h-8 w-full rounded-lg bg-card/10 dark:bg-white/10" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Timeline view - optimized for mobile
  const itemsToShow = isMobile ? 5 : 8;
  
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-3 shadow-inner shadow-sm dark:shadow-black/20">
      {Array.from({ length: itemsToShow }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className={`${isMobile ? 'w-12' : 'w-16'} shrink-0`}>
            <Skeleton className="h-4 w-10 rounded bg-card/10 dark:bg-white/10" />
          </div>
          <div className="flex-1">
            <Skeleton className={`${isMobile ? 'h-12' : 'h-16'} w-full rounded-xl bg-card/10 dark:bg-white/10`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Stats loading skeleton - mobile optimized
export function StatsLoadingSkeleton() {
  const isMobile = useIsMobile();
  
  return (
    <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-4 gap-4'}`}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={`${isMobile ? 'p-3' : 'p-4'} rounded-2xl border border-border bg-card/80 shadow-[0_18px_60px_hsl(0_0%_0%/0.25)]`}>
          <Skeleton className={`${isMobile ? 'h-6 w-12' : 'h-8 w-16'} mb-2 rounded-lg bg-card/10 dark:bg-white/10`} />
          <Skeleton className={`${isMobile ? 'h-3 w-16' : 'h-4 w-20'} rounded bg-card/10 dark:bg-white/10`} />
        </div>
      ))}
    </div>
  );
}

// Sidebar loading skeleton - mobile optimized
export function SidebarLoadingSkeleton() {
  const isMobile = useIsMobile();
  const itemsToShow = isMobile ? 3 : 5;
  
  return (
    <div className="space-y-3">
      {Array.from({ length: itemsToShow }).map((_, i) => (
        <div key={i} className={`${isMobile ? 'p-2' : 'p-3'} rounded-2xl border border-border bg-white/[0.03]`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1">
              <Skeleton className="h-4 w-3/4 mb-1 rounded bg-card/10 dark:bg-white/10" />
              <Skeleton className="h-3 w-1/2 rounded bg-card/10 dark:bg-white/10" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full bg-card/10 dark:bg-white/10" />
          </div>
          {!isMobile && (
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-20" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Generic list skeleton for mobile
export function ListLoadingSkeleton({ count = 5 }: { count?: number }) {
  const isMobile = useIsMobile();
  
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`flex items-center gap-3 ${isMobile ? 'p-3' : 'p-4'} rounded-lg border bg-card`}>
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          {!isMobile && <Skeleton className="h-8 w-20" />}
        </div>
      ))}
    </div>
  );
}

// Card grid skeleton for reports/listings
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  const isMobile = useIsMobile();
  
  return (
    <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3'}`}>
      {Array.from({ length: isMobile ? Math.min(count, 4) : count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card overflow-hidden">
          <Skeleton className={`w-full ${isMobile ? 'h-32' : 'h-40'}`} />
          <div className={`${isMobile ? 'p-3' : 'p-4'} space-y-2`}>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Table skeleton for data tables
export function TableLoadingSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const isMobile = useIsMobile();
  const displayCols = isMobile ? Math.min(cols, 3) : cols;
  
  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <div className={`grid gap-4 p-3 bg-muted/50 border-b`} style={{ gridTemplateColumns: `repeat(${displayCols}, 1fr)` }}>
        {Array.from({ length: displayCols }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div 
          key={rowIdx} 
          className={`grid gap-4 p-3 border-b last:border-0`}
          style={{ gridTemplateColumns: `repeat(${displayCols}, 1fr)` }}
        >
          {Array.from({ length: displayCols }).map((_, colIdx) => (
            <Skeleton key={colIdx} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
