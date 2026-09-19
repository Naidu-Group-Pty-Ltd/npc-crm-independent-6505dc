import { ReactNode } from 'react';

export interface CashFlowContainerProps {
  children: ReactNode;
}

export interface CashFlowClassNameProps {
  className?: string;
}

/**
 * How the cash-flow workspace is framed.
 *
 * `modal` is the original overlay (still used where the workspace is opened
 * over another surface); `page` is the routed full-page drill-down reached
 * from the Cash Flow Analysis property list.
 */
export type CashFlowPresentation = 'modal' | 'page';
