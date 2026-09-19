/**
 * Sample-data presets used by the live preview. Pick one to instantly preview
 * how the template renders against different report shapes (compass tier,
 * premium tier, empty/edge case, etc.).
 */

export interface SampleDataPreset {
  id: string;
  label: string;
  description: string;
  data: Record<string, any>;
}

export const SAMPLE_DATA_PRESETS: SampleDataPreset[] = [
  {
    id: 'compass-investor',
    label: 'Compass tier — Investor',
    description: 'Standard investor profile, Sydney property, mid-tier financials.',
    data: {
      property: {
        address: '12 Bondi Avenue, Bondi Beach NSW 2026',
        suburb: 'Bondi Beach',
        imageUrl: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800',
      },
      financials: { weeklyRent: 1100, purchasePrice: 1850000, yield: 3.09 },
      client: { name: 'Alex Chen', portalUrl: 'https://portal.example.com/alex' },
      reportType: 'investment',
      tier: 'compass',
    },
  },
  {
    id: 'premium-portfolio',
    label: 'Premium tier — Portfolio',
    description: 'High-net-worth client with premium pricing.',
    data: {
      property: {
        address: '88 Vaucluse Road, Vaucluse NSW 2030',
        suburb: 'Vaucluse',
        imageUrl: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800',
      },
      financials: { weeklyRent: 3500, purchasePrice: 6800000, yield: 2.68 },
      client: { name: 'Morgan Wei', portalUrl: 'https://portal.example.com/morgan' },
      reportType: 'portfolio review',
      tier: 'premium',
    },
  },
  {
    id: 'first-home',
    label: 'First home buyer',
    description: 'Entry-level price band, regional NSW.',
    data: {
      property: {
        address: '4 Park Lane, Bathurst NSW 2795',
        suburb: 'Bathurst',
        imageUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800',
      },
      financials: { weeklyRent: 480, purchasePrice: 590000, yield: 4.23 },
      client: { name: 'Jamie Patel', portalUrl: '' },
      reportType: 'first home buyer',
      tier: 'compass',
    },
  },
  {
    id: 'empty',
    label: 'Empty / edge case',
    description: 'Mostly empty fields — exposes missing-data handling.',
    data: {
      property: { address: '', suburb: '', imageUrl: '' },
      financials: { weeklyRent: 0, purchasePrice: 0, yield: 0 },
      client: { name: '', portalUrl: '' },
      reportType: '',
      tier: '',
    },
  },
];

export const DEFAULT_SAMPLE_DATA_PRESET = SAMPLE_DATA_PRESETS[0];

/** Flatten a JS object into "a.b.c" → value entries (max depth 4). */
export function flattenPaths(obj: any, prefix = '', depth = 0, out: Array<{ path: string; preview: string }> = []): Array<{ path: string; preview: string }> {
  if (depth > 4 || obj == null) return out;
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    out.push({ path: prefix, preview: Array.isArray(obj) ? `[${obj.length}]` : String(obj) });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      flattenPaths(v, next, depth + 1, out);
    } else {
      out.push({ path: next, preview: Array.isArray(v) ? `[${v.length}]` : String(v ?? '') });
    }
  }
  return out;
}
