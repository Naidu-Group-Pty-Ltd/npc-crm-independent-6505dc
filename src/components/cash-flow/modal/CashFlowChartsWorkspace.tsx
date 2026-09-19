import { BarChart3 } from 'lucide-react';
import type { CashFlowContainerProps } from './types';

export function CashFlowChartsWorkspace({ children }: CashFlowContainerProps) {
  return (
    <section className="space-y-4 rounded-[1.75rem] border border-border/80 bg-gradient-to-br from-muted via-background to-muted/70 p-3 shadow-sm md:p-4 dark:from-background/40 dark:via-background dark:to-background/30">
      <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-primary/10 p-2 text-primary shadow-sm ring-1 ring-primary/10">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold md:text-base">Chart Workspace</p>
            <p className="text-xs text-muted-foreground">Toggle metrics, review insights, and export charts without changing projection data.</p>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}
