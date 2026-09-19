import type { CSSProperties } from 'react';
import { APP_SHELL_DIMENSIONS } from '@/components/layout/shellDimensions';

export type ManualOverrideSidebarState = 'expanded' | 'collapsed';

/**
 * Supplies the portal-safe shell variables for Manual Data Override. Dialog
 * portals live outside the sidebar provider's DOM subtree, so the active shell
 * measurements are intentionally passed to the portal as CSS custom values.
 */
export function getManualOverrideShellVariables(
  sidebarState: ManualOverrideSidebarState,
  hasDesktopSidebar: boolean,
): CSSProperties {
  return {
    '--manual-override-sidebar-width': hasDesktopSidebar
      ? sidebarState === 'collapsed'
        ? APP_SHELL_DIMENSIONS.collapsedSidebar
        : APP_SHELL_DIMENSIONS.expandedSidebar
      : '0px',
    '--manual-override-header-height': hasDesktopSidebar
      ? APP_SHELL_DIMENSIONS.desktopHeader
      : APP_SHELL_DIMENSIONS.mobileHeader,
  } as CSSProperties;
}

/**
 * Largest width the contained modal is allowed to reach on wide desktops. The
 * shell offsets keep it inside the main content frame; this simply prevents the
 * dialog from stretching edge-to-edge on very large monitors.
 */
export const MANUAL_OVERRIDE_MAX_WIDTH_PX = 1500;

/**
 * Backdrop for the contained modal. It is portalled to `document.body`, so the
 * shared `inset-0` base is overridden with the live shell offsets: the dim only
 * covers the main content frame, leaving the persistent sidebar and top header
 * visible. Offsets read from the CSS variables supplied via `overlayStyle`.
 */
export const MANUAL_OVERRIDE_OVERLAY_CLASSNAME = [
  'luxury-dialog-overlay',
  '!left-[var(--manual-override-sidebar-width)]',
  '!top-[var(--manual-override-header-height)]',
  '!right-0',
  '!bottom-0',
].join(' ');

/**
 * Positioning + sizing contract for the contained modal. Paired with the
 * `bareLayout` DialogContent escape hatch (no shared bottom-sheet/centered
 * classes to fight), so no `!important` overrides are needed.
 *
 * Horizontal band: starts one gutter after the current sidebar width and ends
 * one gutter before the viewport edge. `mx-auto` centres the capped-width box
 * within that band, so the modal is centred in the main content frame with
 * balanced gutters and never overflows onto the sidebar or past the viewport.
 *
 * Vertical band: pinned one gutter below the top header and one gutter above the
 * viewport bottom. Anchoring BOTH insets gives the fixed dialog a *definite*
 * height (viewport − top − bottom), which is essential: the internally scrollable
 * body relies on a `height: 100%` chain (Radix ScrollArea), and a percentage
 * height only resolves against a definite ancestor. With `max-height` alone the
 * ancestor stays indefinite, the chain collapses to content height, and the body
 * never scrolls. The `max-h` is kept purely as a belt-and-suspenders cap.
 */
export const MANUAL_OVERRIDE_CONTENT_CLASSNAME = [
  'manual-data-override-dialog',
  // Three-region shell: fixed header, internally scrollable body, fixed footer.
  'flex flex-col overflow-hidden',
  'gap-0 rounded-2xl p-0',
  // Horizontal placement: after the sidebar, centred, capped, gutter on the right.
  'left-[calc(var(--manual-override-sidebar-width)_+_1rem)]',
  'right-4',
  'mx-auto w-auto min-w-0',
  // NOTE: keep this a static literal so Tailwind's JIT scanner emits the rule;
  // it must stay in sync with MANUAL_OVERRIDE_MAX_WIDTH_PX above.
  'max-w-[1500px]',
  // Vertical placement: below the header, above the viewport bottom. Both insets
  // are required so the height is definite and the body can scroll internally.
  'top-[calc(var(--manual-override-header-height)_+_1rem)]',
  'bottom-4',
  'max-h-[calc(100dvh_-_var(--manual-override-header-height)_-_2rem)]',
].join(' ');
