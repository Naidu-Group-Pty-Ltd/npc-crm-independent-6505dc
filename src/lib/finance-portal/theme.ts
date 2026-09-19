/**
 * Batch 13 #66 — Finance partner theme & density.
 *
 * Toggles classes on <html> so src/styles/finance-portal.css can pin token
 * overrides on `.finance-theme-{name}` / `.finance-density-compact`. The
 * palettes have to live on the document element rather than on the portal
 * root: Radix renders dialogs, popovers and dropdowns through portals
 * attached to <body>, outside the portal subtree, and they need the same
 * tokens as the page behind them.
 *
 * ── Two things follow from living on <html> ───────────────────────────
 *
 * 1. It is global state, so it has to be torn down. `bootFinanceAppearance`
 *    is paired with `clearFinanceAppearance`, which the finance portal
 *    layout calls on unmount. Without that the palette follows the user out
 *    of the portal, and the Command Centre renders with finance dark
 *    surfaces underneath its own light-mode rules. The preference survives
 *    in localStorage either way — only the DOM state is removed.
 *
 * 2. It does not own the `.dark` class. BrandProvider does, as a function of
 *    the user's theme mode and their system preference, and two writers on
 *    one class would clobber each other. So a dark finance palette announces
 *    itself with `data-palette="dark"` instead. Stylesheets that mean "the
 *    light theme" test `:root:not(.dark):not([data-palette='dark'])`, and the
 *    dark half of the glass scale in src/styles/tokens.css keys off the same
 *    attribute. Adding another dark palette is therefore a one-line change:
 *    list it in DARK_THEMES and the CSS follows.
 */
export type FinanceTheme = 'dark' | 'midnight' | 'graphite';
export type FinanceDensity = 'comfortable' | 'compact';

const THEME_KEY = 'finance_theme';
const DENSITY_KEY = 'finance_density';
const THEMES: FinanceTheme[] = ['dark', 'midnight', 'graphite'];

/**
 * Palettes that re-point the surface tokens to dark values. `dark` is not one
 * of them: it ships no overrides and defers to the app's own theme.
 */
const DARK_THEMES: FinanceTheme[] = ['midnight', 'graphite'];

const DENSITY_CLASS = 'finance-density-compact';
const PALETTE_ATTR = 'data-palette';

export function getCachedTheme(): FinanceTheme {
  try {
    const v = localStorage.getItem(THEME_KEY) as FinanceTheme | null;
    return v && THEMES.includes(v) ? v : 'dark';
  } catch { return 'dark'; }
}

export function getCachedDensity(): FinanceDensity {
  try {
    return (localStorage.getItem(DENSITY_KEY) as FinanceDensity) || 'comfortable';
  } catch { return 'comfortable'; }
}

export function applyFinanceTheme(theme: FinanceTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  THEMES.forEach(t => root.classList.remove(`finance-theme-${t}`));
  root.classList.add(`finance-theme-${theme}`);
  if (DARK_THEMES.includes(theme)) {
    root.setAttribute(PALETTE_ATTR, 'dark');
  } else {
    root.removeAttribute(PALETTE_ATTR);
  }
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

export function applyFinanceDensity(density: FinanceDensity) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle(DENSITY_CLASS, density === 'compact');
  try { localStorage.setItem(DENSITY_KEY, density); } catch {}
}

export function bootFinanceAppearance() {
  applyFinanceTheme(getCachedTheme());
  applyFinanceDensity(getCachedDensity());
}

/**
 * Remove every trace of the finance appearance from <html>.
 *
 * Called when the finance portal unmounts. Deliberately does not clear the
 * stored preference — the user gets their palette back next time they open
 * the portal; it just stops following them around the rest of the app.
 */
export function clearFinanceAppearance() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  THEMES.forEach(t => root.classList.remove(`finance-theme-${t}`));
  root.classList.remove(DENSITY_CLASS);
  root.removeAttribute(PALETTE_ATTR);
}
