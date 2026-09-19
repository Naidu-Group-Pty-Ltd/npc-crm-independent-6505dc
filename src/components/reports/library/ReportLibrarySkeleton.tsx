import { BarChart3, FileText, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

export function ReportLibrarySkeleton() {
  return (
    <div className="flex-1 space-y-4 p-4 pt-4 md:p-8 md:pt-6">
      <DashboardThemeFrame variant="hero" className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-6 w-56 rounded-full" />
            <Skeleton className="h-10 w-72 rounded-xl" />
            <Skeleton className="h-5 w-full max-w-xl rounded-xl" />
          </div>
          <Skeleton className="h-10 w-44 rounded-xl" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </DashboardThemeFrame>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[FileText, TrendingUp, BarChart3].concat([FileText, TrendingUp, BarChart3]).map((Icon, i) => (
          <DashboardThemeFrame key={i} variant="card" className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="mt-5 space-y-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-10 rounded-xl" />
            </div>
          </DashboardThemeFrame>
        ))}
      </div>
    </div>
  );
}
