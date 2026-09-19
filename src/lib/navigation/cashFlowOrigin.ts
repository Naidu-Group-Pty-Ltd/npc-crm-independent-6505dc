import type { Location } from 'react-router-dom';

/**
 * Marks a drill-down as having started on the Cash Flow Analysis property list.
 *
 * Both cards on that list now route away — "View Report" to the investment
 * report, "Open Cash Flow" to the property's cash-flow workspace — and both
 * destinations are reachable from elsewhere too. The origin travels in router
 * state so the destination can offer a named route back rather than inferring
 * one from history: `navigate(-1)` is a *browser* step, and it lands somewhere
 * else entirely when the page was opened from a deep link, a refresh, or a new
 * tab. A named route is correct in all three.
 */
export const CASH_FLOW_ANALYSIS_ORIGIN = 'cash-flow-analysis';

export const CASH_FLOW_ANALYSIS_PATH = '/cash-flow-analysis';

export const CASH_FLOW_ANALYSIS_BACK_LABEL = 'Back to Cash Flow Analysis';

/** True when this location was reached by drilling in from the property list. */
export function cameFromCashFlowAnalysis(location: Pick<Location, 'state'>): boolean {
  const state = location.state as { from?: unknown } | null | undefined;
  return state?.from === CASH_FLOW_ANALYSIS_ORIGIN;
}

type Navigate = {
  (delta: number): void;
  (to: string): void;
};

/**
 * The one way back out of a drill-down.
 *
 * When the origin marker is on this entry the previous history entry *is* the
 * property list, so the return **pops** it: pushing `/cash-flow-analysis`
 * again would leave the list twice in the stack, and the browser's own back
 * button would then walk forward into the detail page the adviser just left.
 * Without the marker — a deep link, a bookmark, a fresh tab, an activity-log
 * link — there is nothing behind this entry to pop, so the list is addressed
 * by path. Either way the list restores its own filters, depth and scroll.
 */
export function navigateBackToCashFlowAnalysis(
  navigate: Navigate,
  location: Pick<Location, 'state'>,
): void {
  if (cameFromCashFlowAnalysis(location)) {
    navigate(-1);
    return;
  }
  navigate(CASH_FLOW_ANALYSIS_PATH);
}
