import { describe, expect, it } from 'vitest';
import { getBrandAccessibilityChecks } from '../accessibility';
import { defaultBrandConfig } from '../brand-defaults';

describe('Branding validation guardrails', () => {
  it('continues to block publishing when required brand identity is incomplete', () => {
    const checks = getBrandAccessibilityChecks({
      ...defaultBrandConfig,
      companyName: '   ',
    });

    expect(checks).toContainEqual(expect.objectContaining({ id: 'company-name', status: 'critical' }));
  });

  it('keeps custom brand colours guarded by readable foreground contrast checks', () => {
    const checks = getBrandAccessibilityChecks({
      ...defaultBrandConfig,
      primaryColor: '0 0% 100%',
      accentColor: '0 0% 8%',
    });

    expect(checks).toContainEqual(expect.objectContaining({ id: 'primary-contrast', status: 'pass' }));
    expect(checks).toContainEqual(expect.objectContaining({ id: 'accent-contrast', status: 'pass' }));
  });

  it('continues to warn when required brand asset slots are incomplete', () => {
    const checks = getBrandAccessibilityChecks({
      ...defaultBrandConfig,
      authLogo: null,
      sidebarLogo: null,
      sidebarIcon: null,
      favicon: null,
    });

    expect(checks).toContainEqual(expect.objectContaining({ id: 'logo-coverage', status: 'warning' }));
  });
});
