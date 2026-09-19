/**
 * Shared dimensions for the persistent dashboard chrome.
 *
 * Keep overlay surfaces aligned with the shell by consuming these values rather
 * than re-declaring sidebar or header measurements at individual feature sites.
 */
export const APP_SHELL_DIMENSIONS = {
  desktopHeader: '72px',
  mobileHeader: '56px',
  expandedSidebar: '16rem',
  collapsedSidebar: '3rem',
} as const;
