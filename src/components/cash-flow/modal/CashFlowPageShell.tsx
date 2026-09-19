import { ReactNode } from 'react';

interface CashFlowPageShellProps {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Full-page presentation of the 10-Year Cash Flow workspace.
 *
 * The sibling of `CashFlowModalShell`: same header/body/footer contract, no
 * dialog. It exists so drilling in from the Cash Flow Analysis list reads as
 * navigating deeper into a property rather than as an overlay stacked on top
 * of it, while the workspace itself stays one implementation.
 *
 * The header is a rail rather than a sticky bar. `DashboardPageShell` sets
 * `overflow-x: hidden`, which computes `overflow-y` to `auto` and makes it the
 * nearest scrollport for everything it contains — a scrollport whose height is
 * its own content, so it never scrolls and a `position: sticky` child inside
 * it never activates. The route back is therefore repeated at the foot of the
 * page and in the More menu, so it is reachable from wherever the adviser has
 * scrolled to.
 *
 * The negative margins let the rail's rule meet the page edges while the body
 * keeps the page's own padding.
 */
export function CashFlowPageShell({ header, children, footer }: CashFlowPageShellProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="-mx-4 border-b border-border/60 px-4 pb-4 md:-mx-6 md:px-6 md:pb-5">
        {header}
      </div>

      <div className="min-w-0 flex-1 pt-4 md:pt-6">
        {children}
      </div>

      {footer && (
        <div className="-mx-4 mt-6 border-t border-border/60 px-4 md:-mx-6 md:px-6">
          {footer}
        </div>
      )}
    </div>
  );
}
