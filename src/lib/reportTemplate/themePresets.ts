/**
 * Curated theme presets — apply a full brand identity (colors + fonts + spacing)
 * to a template's tokens in one click. Pairs with the Tokens editor and the
 * Command Palette ("Apply theme: …").
 */
import type { FontFace, Tokens } from './templateSchema';
import { googleFontsCssUrl } from './fontCatalog';

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  swatch: string[];
  tokens: Tokens;
}

const baseSpacing = { gutter: 16, sectionGap: 24, padding: 24 };

function googleFaces(...families: string[]): FontFace[] {
  return families.map((family) => ({ family, cssUrl: googleFontsCssUrl(family) }));
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'material-design-3',
    label: 'Material Design',
    description: 'Google Material 3 — tonal surfaces, accessible blue, Roboto type scale.',
    swatch: ['#fffbfe', '#e7e0ec', '#6750a4', '#006c4c'],
    tokens: {
      colors: {
        bg: '#fffbfe', surface: '#f7f2fa', text: '#1d1b20',
        muted: '#79747e', primary: '#6750a4', accent: '#625b71',
        success: '#006c4c', danger: '#ba1a1a', outline: '#79747e', surfaceVariant: '#e7e0ec',
      },
      fonts: { heading: 'Roboto', body: 'Roboto', mono: 'Roboto Mono' },
      spacing: { gutter: 24, sectionGap: 32, padding: 24, cardGap: 16 },
      radii: { sm: 8, md: 12, lg: 28, pill: 999 },
      shadows: { card: '0 1px 2px rgba(0,0,0,.30), 0 1px 3px 1px rgba(0,0,0,.15)' },
      fontFaces: googleFaces('Roboto', 'Roboto Mono'),
    },
  },
  {
    id: 'fluent-2',
    label: 'Fluent',
    description: 'Microsoft Fluent 2 — Segoe-like Aptos typography, calm neutrals, blue accent.',
    swatch: ['#ffffff', '#f5f5f5', '#0f6cbd', '#242424'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#f5f5f5', text: '#242424',
        muted: '#616161', primary: '#0f6cbd', accent: '#115ea3',
        success: '#107c10', danger: '#d13438', outline: '#d1d1d1', surfaceVariant: '#fafafa',
      },
      fonts: { heading: 'Noto Sans', body: 'Noto Sans', mono: 'Roboto Mono' },
      spacing: { gutter: 20, sectionGap: 28, padding: 20, cardGap: 12 },
      radii: { sm: 4, md: 6, lg: 8, pill: 999 },
      shadows: { card: '0 2px 4px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)' },
      fontFaces: googleFaces('Noto Sans', 'Roboto Mono'),
    },
  },
  {
    id: 'bootstrap-5',
    label: 'Bootstrap',
    description: 'Bootstrap 5 — system UI, familiar blue, rounded components, pragmatic spacing.',
    swatch: ['#ffffff', '#f8f9fa', '#0d6efd', '#212529'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#f8f9fa', text: '#212529',
        muted: '#6c757d', primary: '#0d6efd', accent: '#6610f2',
        success: '#198754', danger: '#dc3545', warning: '#ffc107', info: '#0dcaf0', outline: '#dee2e6',
      },
      fonts: { heading: 'Inter', body: 'Inter', mono: 'Roboto Mono' },
      spacing: { gutter: 24, sectionGap: 24, padding: 16, cardGap: 16 },
      radii: { sm: 4, md: 6, lg: 8, pill: 999 },
      shadows: { card: '0 .5rem 1rem rgba(0,0,0,.15)' },
      fontFaces: googleFaces('Inter', 'Roboto Mono'),
    },
  },
  {
    id: 'ant-design-5',
    label: 'Ant Design',
    description: 'Ant Design 5 — enterprise reports, blue primary, compact radii, clean tables.',
    swatch: ['#ffffff', '#f5f5f5', '#1677ff', '#001529'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#f5f5f5', text: '#000000e0',
        muted: '#00000073', primary: '#1677ff', accent: '#722ed1',
        success: '#52c41a', danger: '#ff4d4f', warning: '#faad14', info: '#1677ff', outline: '#d9d9d9',
      },
      fonts: { heading: 'Inter', body: 'Inter', mono: 'Roboto Mono' },
      spacing: { gutter: 24, sectionGap: 24, padding: 24, cardGap: 16 },
      radii: { sm: 4, md: 6, lg: 8, pill: 999 },
      shadows: { card: '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12)' },
      fontFaces: googleFaces('Inter', 'Roboto Mono'),
    },
  },
  {
    id: 'midnight-gold',
    label: 'Midnight Gold',
    description: 'Dark luxe — premium investment / private-client reports.',
    swatch: ['#0d0d0d', '#1a1a1a', '#bf9b50', '#f0d78c'],
    tokens: {
      colors: {
        bg: '#0d0d0d', surface: '#1a1a1a', text: '#ffffff',
        muted: '#9a9a9a', primary: '#bf9b50', accent: '#f0d78c',
        success: '#5fb27a', danger: '#e06b6b',
      },
      fonts: { heading: 'Helvetica', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
  {
    id: 'paper-ink',
    label: 'Paper & Ink',
    description: 'Editorial off-white & rich black — Swiss-inspired clarity.',
    swatch: ['#f5f3ee', '#e8e4dd', '#2d2d2d', '#0d0d0d'],
    tokens: {
      colors: {
        bg: '#f5f3ee', surface: '#ffffff', text: '#0d0d0d',
        muted: '#6b6b6b', primary: '#2d2d2d', accent: '#bf6a3a',
        success: '#3a7a4f', danger: '#a8302a',
      },
      fonts: { heading: 'Times', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
  {
    id: 'navy-trust',
    label: 'Navy Trust',
    description: 'Finance, legal, enterprise — credibility-first palette.',
    swatch: ['#0f1b3d', '#1e3a5f', '#3b6fa0', '#e8edf3'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#e8edf3', text: '#0f1b3d',
        muted: '#5a6a85', primary: '#1e3a5f', accent: '#3b6fa0',
        success: '#1f7a4d', danger: '#b3322a',
      },
      fonts: { heading: 'Helvetica', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
  {
    id: 'sunset-blaze',
    label: 'Sunset Blaze',
    description: 'High-energy marketing decks — warm gradient palette.',
    swatch: ['#ff6b35', '#f7931e', '#e84393', '#6c5ce7'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#fff5ee', text: '#1a1a1a',
        muted: '#7a7a7a', primary: '#e84393', accent: '#ff6b35',
        success: '#3a8a4f', danger: '#c23a2a',
      },
      fonts: { heading: 'Helvetica', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
  {
    id: 'forest-moss',
    label: 'Forest & Moss',
    description: 'Organic, sustainability, wellness — grounded greens.',
    swatch: ['#1a3c2a', '#2d5a3d', '#5a8a5c', '#a0c49d'],
    tokens: {
      colors: {
        bg: '#f5f6f1', surface: '#ffffff', text: '#1a3c2a',
        muted: '#6b7a6e', primary: '#2d5a3d', accent: '#5a8a5c',
        success: '#3a8a4f', danger: '#a8302a',
      },
      fonts: { heading: 'Times', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
  {
    id: 'arctic-frost',
    label: 'Arctic Frost',
    description: 'Crisp, pristine SaaS — cool blues on white.',
    swatch: ['#e8f0f8', '#b8d4e8', '#6ba3c8', '#2e6b8a'],
    tokens: {
      colors: {
        bg: '#ffffff', surface: '#e8f0f8', text: '#0c2340',
        muted: '#5d738a', primary: '#2e6b8a', accent: '#6ba3c8',
        success: '#3a8a4f', danger: '#b3322a',
      },
      fonts: { heading: 'Helvetica', body: 'Helvetica', mono: 'Courier' },
      spacing: baseSpacing,
    },
  },
];

export function getThemePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
