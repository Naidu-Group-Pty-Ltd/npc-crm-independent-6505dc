import type { CashFlowContainerProps } from './types';

export function CashFlowProjectionTable({ children }: CashFlowContainerProps) {
  return (
    <section className="rounded-[1.75rem] border border-border/80 bg-gradient-to-br from-background via-muted/10 to-background p-2 shadow-sm md:p-3">
      {children}
    </section>
  );
}
