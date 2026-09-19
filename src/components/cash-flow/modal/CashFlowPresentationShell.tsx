import { ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { CashFlowModalShell } from './CashFlowModalShell';
import { CashFlowPageShell } from './CashFlowPageShell';
import type { CashFlowPresentation } from './types';

interface CashFlowPresentationShellProps {
  presentation: CashFlowPresentation;
  isOpen: boolean;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Chooses the chrome the cash-flow workspace is drawn inside.
 *
 * One workspace, two frames: a dialog when it is opened over another surface
 * (the client property view still does this), a routed page when it is
 * reached by drilling into a property from the Cash Flow Analysis list. The
 * body is identical in both, which is the point — a second implementation is
 * how the two would drift.
 */
export function CashFlowPresentationShell({
  presentation,
  isOpen,
  onClose,
  header,
  children,
  footer,
}: CashFlowPresentationShellProps) {
  if (presentation === 'page') {
    return (
      <CashFlowPageShell header={header} footer={footer}>
        {children}
      </CashFlowPageShell>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <CashFlowModalShell header={header} footer={footer}>
        {children}
      </CashFlowModalShell>
    </Dialog>
  );
}
