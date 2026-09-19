import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave without saving?';

export interface AnchorNavigationDescriptor {
  href: string;
  target?: string | null;
  hasDownload?: boolean;
}

export interface NavigationModifiers {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface CurrentLocation {
  origin: string;
  pathname: string;
  search: string;
}

/**
 * Pure decision helper: should an anchor click be intercepted by the unsaved-
 * changes guard? Extracted from the hook so the (fiddly) interception rules are
 * unit-testable without a DOM. Returns `true` only for plain, primary-button,
 * same-origin, in-app navigations that actually change the route.
 */
export function shouldInterceptNavigation(params: {
  anchor: AnchorNavigationDescriptor;
  modifiers: NavigationModifiers;
  defaultPrevented: boolean;
  current: CurrentLocation;
}): boolean {
  const { anchor, modifiers, defaultPrevented, current } = params;
  if (defaultPrevented) return false;
  // Only plain left-clicks — let new-tab / new-window gestures through.
  if (
    modifiers.button !== 0 ||
    modifiers.metaKey ||
    modifiers.ctrlKey ||
    modifiers.shiftKey ||
    modifiers.altKey
  ) {
    return false;
  }
  if (!anchor.href) return false;
  if (anchor.hasDownload) return false;
  if (anchor.target && anchor.target !== '_self') return false;

  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  // Same route (in-page hash links, no-op clicks) — nothing to guard.
  if (url.pathname === current.pathname && url.search === current.search) return false;
  return true;
}

export interface UnsavedChangesGuardOptions {
  /** Guard is active only while this is true (e.g. the editor is dirty). */
  when: boolean;
  /** Message shown in the browser/confirm prompts. */
  message?: string;
}

/**
 * Guards against losing unsaved work when leaving an editor.
 *
 * The app mounts a `<BrowserRouter>` (not a data router), so React Router's
 * `useBlocker` / `unstable_usePrompt` are unavailable. This hook provides
 * equivalent coverage without migrating the router:
 *   - `beforeunload` for tab close / reload / external navigation;
 *   - a capture-phase document click interceptor for in-app `<a>` / `<Link>`
 *     navigations (sidebar, breadcrumbs, etc.);
 *   - `confirmLeave()` for imperative `navigate()` calls (buttons).
 *
 * Browser Back/Forward (history `popstate`) is intentionally NOT intercepted —
 * doing so reliably requires history hacks that can corrupt the SPA history
 * stack. `beforeunload` still covers full-document back/forward navigations.
 */
export function useUnsavedChangesGuard({ when, message = DEFAULT_MESSAGE }: UnsavedChangesGuardOptions) {
  const whenRef = useRef(when);
  whenRef.current = when;
  const messageRef = useRef(message);
  messageRef.current = message;

  // Tab close / reload / external navigation.
  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  // In-app SPA navigation via anchor / <Link> clicks (sidebar, breadcrumbs…).
  // Registered once; reads the latest state through refs.
  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      if (!whenRef.current) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a') ?? null;
      if (!anchor) return;
      const intercept = shouldInterceptNavigation({
        anchor: {
          href: anchor.href,
          target: anchor.getAttribute('target'),
          hasDownload: anchor.hasAttribute('download'),
        },
        modifiers: {
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
        defaultPrevented: event.defaultPrevented,
        current: {
          origin: window.location.origin,
          pathname: window.location.pathname,
          search: window.location.search,
        },
      });
      if (!intercept) return;
      // A synchronous confirm lets us decide before the browser default and
      // React Router's own click handler run. Cancel -> swallow the click.
      if (!window.confirm(messageRef.current)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);

  /** Imperative guard for non-anchor navigations (buttons calling `navigate()`). */
  const confirmLeave = useCallback(() => {
    if (!whenRef.current) return true;
    return window.confirm(messageRef.current);
  }, []);

  return { confirmLeave };
}
