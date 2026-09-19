import type { BrandConfig } from './brand-types';
import { getReadableForeground, normalizeHslString, relativeLuminanceFromHsl } from './color-utils';

export interface BrandAccessibilityCheck {
  id: string;
  label: string;
  detail: string;
  status: 'pass' | 'warning' | 'critical';
}

export interface BrandImpactPreviewItem {
  id: string;
  surface: string;
  label: string;
  detail: string;
}

function contrastRatio(foreground: string, background: string) {
  const fg = relativeLuminanceFromHsl(foreground);
  const bg = relativeLuminanceFromHsl(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getBrandAccessibilityChecks(config: BrandConfig): BrandAccessibilityCheck[] {
  const primary = normalizeHslString(config.primaryColor, '43 74% 49%');
  const accent = normalizeHslString(config.accentColor, primary);
  const primaryForeground = getReadableForeground(primary);
  const accentForeground = getReadableForeground(accent);

  const checks: BrandAccessibilityCheck[] = [
    {
      id: 'company-name',
      label: 'Company name',
      detail: config.companyName.trim()
        ? 'Brand name is set and ready for shell, auth, and browser tab usage.'
        : 'Add a company name so browser titles and shell branding are not blank.',
      status: config.companyName.trim() ? 'pass' : 'critical',
    },
    {
      id: 'primary-contrast',
      label: 'Primary action contrast',
      detail: `Primary actions render at ${contrastRatio(primary, primaryForeground).toFixed(2)}:1 contrast.`,
      status: contrastRatio(primary, primaryForeground) >= 4.5 ? 'pass' : contrastRatio(primary, primaryForeground) >= 3 ? 'warning' : 'critical',
    },
    {
      id: 'accent-contrast',
      label: 'Accent contrast',
      detail: `Accent surfaces render at ${contrastRatio(accent, accentForeground).toFixed(2)}:1 contrast.`,
      status: contrastRatio(accent, accentForeground) >= 4.5 ? 'pass' : contrastRatio(accent, accentForeground) >= 3 ? 'warning' : 'critical',
    },
    {
      id: 'logo-coverage',
      label: 'Brand asset coverage',
      detail: config.authLogo && (config.sidebarLogo || config.sidebarIcon) && config.favicon
        ? 'All primary slots have assets assigned.'
        : 'Consider adding auth, sidebar, and favicon assets for a complete branded experience.',
      status: config.authLogo && (config.sidebarLogo || config.sidebarIcon) && config.favicon ? 'pass' : 'warning',
    },
  ];

  return checks;
}

export function getBrandImpactPreview(config: BrandConfig): BrandImpactPreviewItem[] {
  const items: BrandImpactPreviewItem[] = [
    {
      id: 'app-shell',
      surface: 'Shell',
      label: 'Global navigation and layout chrome',
      detail: 'Primary, surface, and border tokens will refresh across the dashboard shell, topbar, sidebar, and mobile navigation.',
    },
    {
      id: 'controls',
      surface: 'Controls',
      label: 'Buttons, inputs, tabs, and focus rings',
      detail: 'Interactive states inherit the draft primary and accent colors through semantic control tokens.',
    },
    {
      id: 'data-views',
      surface: 'Data views',
      label: 'Tables, badges, alerts, and charts',
      detail: 'Shared UI primitives update to the resolved brand palette for statuses, data emphasis, and chart color ramps.',
    },
    {
      id: 'brand-assets',
      surface: 'Assets',
      label: 'Auth, sidebar, collapsed icon, and browser tab',
      detail: config.authLogo || config.sidebarLogo || config.sidebarIcon || config.favicon
        ? 'Uploaded assets will be reused across every available logo slot with fallback rules where needed.'
        : 'Add logos and a favicon to propagate a fully branded shell across auth, navigation, and browser surfaces.',
    },
  ];

  return items;
}