/**
 * A Back button's whole job is the case where there is nothing behind it.
 *
 * Every assertion below is about an arrival that is NOT "clicked a link in the
 * app": a bookmark, a redirect from a retired route, a fresh tab, a refresh.
 * Those are how `/partner-agreements` is actually reached — it has no sidebar
 * entry — and they are the ones a naive `navigate(-1)` gets wrong, silently.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  backLabel,
  hasInAppHistory,
  navigateBack,
  resolveBackTarget,
} from '@/lib/navigation/pageBack';

/** What React Router's history writes onto `window.history.state`. */
const entry = (idx: number) => ({ usr: null, key: 'abc123', idx });

describe('knowing whether there is app history behind this page', () => {
  it('is true once the user has navigated within the app', () => {
    expect(hasInAppHistory(entry(1))).toBe(true);
    expect(hasInAppHistory(entry(7))).toBe(true);
  });

  it('is false on the first entry after any page load', () => {
    // A bookmark, a link from an email, a fresh tab, a refresh — the router
    // rebuilds from index 0 regardless of what the browser's own stack holds.
    expect(hasInAppHistory(entry(0))).toBe(false);
  });

  it('is false when the router has written nothing at all', () => {
    // Belt and braces: a non-router navigation, or a browser that lost the
    // state. Guessing "there is history" here is what walks the user out of
    // the product.
    expect(hasInAppHistory(null)).toBe(false);
    expect(hasInAppHistory(undefined)).toBe(false);
    expect(hasInAppHistory({})).toBe(false);
    expect(hasInAppHistory({ idx: null })).toBe(false);
    expect(hasInAppHistory({ idx: '3' })).toBe(false);
    expect(hasInAppHistory('idx=3')).toBe(false);
  });

  it('is false for a negative index rather than trusting the number', () => {
    expect(hasInAppHistory(entry(-1))).toBe(false);
  });
});

describe('what the button does', () => {
  it('steps back when the user walked here', () => {
    const navigate = vi.fn();
    navigateBack(navigate, '/dashboard', entry(2));
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('addresses the fallback by path when they did not', () => {
    const navigate = vi.fn();
    navigateBack(navigate, '/dashboard', entry(0));
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('replaces rather than pushes the fallback', () => {
    // Pushing would leave this page behind the destination, so the browser's
    // own back button would return to the page they just asked to leave.
    const navigate = vi.fn();
    navigateBack(navigate, '/dashboard', null);
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    expect(navigate).not.toHaveBeenCalledWith('/dashboard');
  });

  it('never steps back into whatever preceded a redirect', () => {
    // `<Navigate replace>` does not advance `idx`. The entry behind a
    // redirected arrival belongs to wherever the old link came from.
    const navigate = vi.fn();
    navigateBack(navigate, '/dashboard', entry(0));
    expect(navigate).not.toHaveBeenCalledWith(-1);
  });
});

describe('what the button says', () => {
  it('says Back only when Back is what it does', () => {
    expect(backLabel(resolveBackTarget(entry(3)), 'Dashboard')).toBe('Back');
  });

  it('names the destination when it is going somewhere named', () => {
    // "Back" that lands somewhere the user has never been reads as a bug.
    expect(backLabel(resolveBackTarget(entry(0)), 'Dashboard')).toBe('Back to Dashboard');
    expect(backLabel(resolveBackTarget(null), 'Finance Partners')).toBe('Back to Finance Partners');
  });
});
