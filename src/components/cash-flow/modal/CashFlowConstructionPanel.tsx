import { HardHat } from 'lucide-react';
import type { CashFlowContainerProps } from './types';

interface CashFlowConstructionPanelProps extends CashFlowContainerProps {
  active?: boolean;
}

export function CashFlowConstructionPanel({ children, active = true }: CashFlowConstructionPanelProps) {
  if (!active) return null;

  return (
    <section className="space-y-4 rounded-[1.75rem] border border-brand-200/70 bg-gradient-to-br from-brand-50/50 via-background to-background p-3 shadow-sm md:p-4 dark:border-brand-900/40 dark:from-brand-950/20">
      <div className="flex items-center gap-3 px-1">
        <span className="rounded-2xl bg-brand-500/10 p-2 text-brand-600 shadow-sm ring-1 ring-brand-500/10">
          <HardHat className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold md:text-base">Construction Schedule</p>
          <p className="text-xs text-muted-foreground">Review staged drawdowns, schedule presets, and export inclusion for new builds.</p>
        </div>
      </div>
      {children}
    </section>
  );
}
