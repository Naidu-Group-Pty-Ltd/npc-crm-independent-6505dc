import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyFinanceDensity,
  applyFinanceTheme,
  bootFinanceAppearance,
  clearFinanceAppearance,
  getCachedTheme,
} from '@/lib/finance-portal/theme';

/**
 * The finance palettes live on <html>, which makes them global state shared
 * with the rest of the app. These tests pin the two invariants that keeps
 * safe: the appearance is fully removable, and it never touches `.dark`.
 */
const root = () => document.documentElement;
const financeClasses = () =>
  Array.from(root().classList).filter((c) => c.startsWith('finance-'));

describe('finance portal appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    root().className = '';
    root().removeAttribute('data-palette');
  });

  it('applies the cached theme on boot', () => {
    applyFinanceTheme('midnight');
    root().className = '';
    root().removeAttribute('data-palette');

    bootFinanceAppearance();

    expect(getCachedTheme()).toBe('midnight');
    expect(root().classList.contains('finance-theme-midnight')).toBe(true);
  });

  it('marks a dark palette with data-palette so stylesheets can test for it', () => {
    applyFinanceTheme('midnight');
    expect(root().getAttribute('data-palette')).toBe('dark');

    applyFinanceTheme('graphite');
    expect(root().getAttribute('data-palette')).toBe('dark');
  });

  it('does not mark the default theme, which ships no palette overrides', () => {
    applyFinanceTheme('midnight');
    applyFinanceTheme('dark');

    expect(root().classList.contains('finance-theme-dark')).toBe(true);
    expect(root().hasAttribute('data-palette')).toBe(false);
  });

  it('never leaves a stale theme class when switching', () => {
    applyFinanceTheme('midnight');
    applyFinanceTheme('graphite');

    expect(financeClasses()).toEqual(['finance-theme-graphite']);
  });

  // The regression this file exists for: leaving the portal used to leave the
  // palette behind, so the Command Centre rendered with finance dark surfaces
  // underneath its own light-mode rules.
  it('removes every trace of the appearance on clear', () => {
    applyFinanceTheme('midnight');
    applyFinanceDensity('compact');

    clearFinanceAppearance();

    expect(financeClasses()).toEqual([]);
    expect(root().hasAttribute('data-palette')).toBe(false);
  });

  it('keeps the stored preference so the palette returns on the next visit', () => {
    applyFinanceTheme('graphite');
    applyFinanceDensity('compact');

    clearFinanceAppearance();
    bootFinanceAppearance();

    expect(root().classList.contains('finance-theme-graphite')).toBe(true);
    expect(root().classList.contains('finance-density-compact')).toBe(true);
    expect(root().getAttribute('data-palette')).toBe('dark');
  });

  // BrandProvider owns `.dark`, as a function of the user's theme mode and
  // system preference. Two writers on one class would clobber each other.
  it('leaves the app-owned dark class alone', () => {
    root().classList.add('dark');

    bootFinanceAppearance();
    applyFinanceTheme('midnight');
    clearFinanceAppearance();

    expect(root().classList.contains('dark')).toBe(true);
  });
});
