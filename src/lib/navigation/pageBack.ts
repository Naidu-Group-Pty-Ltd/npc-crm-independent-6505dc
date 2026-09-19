/**
 * A Back control that is still correct when there is nothing behind it.
 *
 * ## The failure this exists to avoid
 *
 * `navigate(-1)` is a *browser* step, not an application one. It is right when
 * the user walked here from another page in the app, and wrong every other
 * way a page gets opened:
 *
 *  - a bookmark or a link in an email — the previous entry is the mail client;
 *  - a fresh tab — there is no previous entry, and the button does nothing;
 *  - a refresh — the stack is rebuilt from this entry;
 *  - **a redirect** — `/partner-agreements/new` and its three siblings are
 *    `<Navigate replace>` onto `/partner-agreements`, so the entry the user
 *    would step back to is whatever preceded the old bookmark they followed.
 *
 * A "Back" button that silently leaves the product, or does nothing at all, is
 * worse than no button. So: pop history when there is app history to pop, and
 * otherwise address a named route by path. `cashFlowOrigin.ts` reaches the
 * same conclusion for drill-downs; this is the general form, for a page that
 * has no single parent to return to.
 *
 * ## How "is there app history" is known
 *
 * React Router's history stamps `window.history.state.idx` — the index of this
 * entry within the stack the router has seen. It is `0` on the first entry
 * after any full page load, whatever the browser's own history contains, which
 * is exactly the distinction that matters: `idx > 0` means the user reached
 * here by navigating inside the app, and only then is stepping back a step
 * within the app.
 *
 * `replace` does not advance `idx`, so a redirect from a retired route reads
 * as no app history — which is right, because it is the user's *bookmark* that
 * is behind them, not a page of ours.
 */

/** Shape of `useNavigate` that this module needs; keeps it testable. */
export interface BackNavigate {
  (delta: number): void;
  (to: string, options?: { replace?: boolean }): void;
}

export type BackTarget = 'history' | 'fallback';

/**
 * Whether stepping back lands somewhere inside the app.
 *
 * Reads the router's own index rather than `history.length`, which counts
 * entries from before the app was loaded and is therefore never zero in a
 * tab that has been used.
 */
export function hasInAppHistory(historyState: unknown = typeof window === 'undefined'
  ? null
  : window.history.state): boolean {
  if (!historyState || typeof historyState !== 'object') return false;
  const index = (historyState as { idx?: unknown }).idx;
  return typeof index === 'number' && index > 0;
}

/** Which of the two things the button will do, so its label can say so. */
export function resolveBackTarget(historyState?: unknown): BackTarget {
  return hasInAppHistory(historyState) ? 'history' : 'fallback';
}

/**
 * The label the control should carry.
 *
 * Named when the destination is named. A button that says "Back" and lands
 * somewhere the user has never been reads as a bug; "Back to Dashboard" is a
 * promise the click keeps.
 */
export function backLabel(target: BackTarget, fallbackLabel: string): string {
  return target === 'history' ? 'Back' : `Back to ${fallbackLabel}`;
}

/**
 * Go back, or go to the named fallback.
 *
 * The fallback is `replace`d rather than pushed: the entry being left is one
 * the user arrived at from outside the app, and pushing over it would make the
 * browser's own back button return to this page — the opposite of what the
 * control they just pressed was for.
 */
export function navigateBack(
  navigate: BackNavigate,
  fallbackPath: string,
  historyState?: unknown,
): void {
  if (resolveBackTarget(historyState) === 'history') {
    navigate(-1);
    return;
  }
  navigate(fallbackPath, { replace: true });
}
