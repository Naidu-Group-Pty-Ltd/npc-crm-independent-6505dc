import { ReactNode } from 'react';

interface CashFlowChartControlsProps {
  children: ReactNode;
}

export function CashFlowChartControls({ children }: CashFlowChartControlsProps) {
  return <>{children}</>;
}
