// Aurora-gold on obsidian: shared chart palettes for the Live Chart Kernel.
// These are canvas-only colors (charts render on a white canvas for export
// fidelity), tuned to read cleanly in both light and dark app chrome.

export const AURORA_GOLD_PALETTE = [
  '#D4A843', // signature aurixa gold
  '#B58324',
  '#8B5CF6',
  '#6366F1',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#0EA5E9',
  '#84CC16',
  '#A855F7',
];

// Categorical palettes keyed by intent — pickers can hint via
// `chart_config.palette` or the semantic chart_type.
export const PALETTES = {
  aurora: AURORA_GOLD_PALETTE,
  sequential: ['#FEF3C7', '#FDE68A', '#FCD34D', '#F59E0B', '#D4A843', '#B58324', '#8B5CF6'],
  diverging: ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#06B6D4', '#6366F1'],
  ocean: ['#0EA5E9', '#0284C7', '#0369A1', '#075985', '#0C4A6E', '#134E4A', '#065F46'],
  forest: ['#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0'],
} as const;

export type PaletteKey = keyof typeof PALETTES;

export function resolvePalette(hint?: unknown): string[] {
  const key = (typeof hint === 'string' ? hint : '').toLowerCase() as PaletteKey;
  if (key && PALETTES[key]) return [...PALETTES[key]];
  return [...AURORA_GOLD_PALETTE];
}

export function colorAt(palette: string[], index: number): string {
  if (!palette.length) return AURORA_GOLD_PALETTE[index % AURORA_GOLD_PALETTE.length];
  return palette[index % palette.length];
}
