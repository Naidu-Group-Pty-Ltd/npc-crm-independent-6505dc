/**
 * Curated vector icon pack for the template builder.
 *
 * 24×24 stroke-style glyphs (lucide-flavoured) used three ways:
 *  - the design agent places NAMED icons (`{ type:'vector', icon:'map-pin' }`)
 *    instead of approximating source pictograms with crude shapes or skipping
 *    them — the edge function expands the name into these paths;
 *  - the editor can insert icons as editable vector overlays;
 *  - imports keep a stable, professional icon vocabulary across formats.
 *
 * KEEP IN SYNC with `supabase/functions/_shared/iconPack.ts` (same data; the
 * Deno runtime cannot import from src/).
 */

export const ICON_VIEWBOX = '0 0 24 24';

export const ICON_PACK: Record<string, string[]> = {
  'building': ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01'],
  'home': ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M9 21v-6h6v6'],
  'map-pin': ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z', 'M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  'landmark': ['M3 22h18', 'M5 18v-7M9.5 18v-7M14.5 18v-7M19 18v-7', 'M2 11 12 3l10 8z'],
  'school': ['M22 10 12 5 2 10l10 5 10-5z', 'M6 12.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5', 'M22 10v6'],
  'hospital': ['M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16', 'M2 21h20', 'M12 8v6', 'M9 11h6'],
  'trees': ['M12 3 7 10h2l-3 5h12l-3-5h2L12 3z', 'M12 15v6'],
  'bed': ['M3 7v11', 'M3 16h18', 'M21 16v-5a2 2 0 0 0-2-2H10v7', 'M6 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  'bath': ['M4 12h16a1 1 0 0 1 1 1 6 6 0 0 1-6 6H9a6 6 0 0 1-6-6 1 1 0 0 1 1-1z', 'M6 12V5a2 2 0 0 1 4 0', 'M7 19l-1 2M17 19l1 2'],
  'car': ['M5 16H3v-4l2-5h12l2 5h2v4h-2', 'M7 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M17 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M5 12h14'],
  'train': ['M6 3h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z', 'M4 10h16', 'M8 14h.01M16 14h.01', 'M7 17l-2 4M17 17l2 4'],
  'ruler': ['M3 17 17 3l4 4L7 21l-4-4z', 'M8 12l1.5 1.5M11 9l1.5 1.5M14 6l1.5 1.5'],
  'key': ['M15 9a4 4 0 1 0-4 4l-7 7v2h2l1-1v-2h2v-2h2l2.5-2.5A4 4 0 0 0 15 9z', 'M15.5 8.5h.01'],
  'file-text': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z', 'M14 2v6h6', 'M8 13h8M8 17h8'],
  'calendar': ['M8 2v4M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  'clock': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 3'],
  'check': ['M20 6 9 17l-5-5'],
  'check-circle': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 12l2.5 2.5L16 9.5'],
  'alert': ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  'info': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8h.01', 'M12 11v5'],
  'star': ['m12 3 2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-3-5.5 3 1-6.2L3 9.5l6.3-.9L12 3z'],
  'shield': ['M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z'],
  'target': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  'tag': ['M12 2H4a2 2 0 0 0-2 2v8l10 10 10-10L12 2z', 'M7 7h.01'],
  'dollar': ['M12 2v20', 'M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6'],
  'percent': ['M19 5 5 19', 'M6.5 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M17.5 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  'wallet': ['M20 7H5a2 2 0 0 1 0-4h13v4', 'M3 5v14a2 2 0 0 0 2 2h16V7', 'M16 13h.01'],
  'trend-up': ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  'trend-down': ['M22 17l-8.5-8.5-5 5L2 7', 'M16 17h6v-6'],
  'bar-chart': ['M3 21h18', 'M7 21V9', 'M12 21V3', 'M17 21v-12'],
  'pie-chart': ['M21 12A9 9 0 1 1 12 3v9z', 'M21 8.5A9 9 0 0 0 14 3v5.5z'],
  'activity': ['M2 12h4l3-8 6 16 3-8h4'],
  'calculator': ['M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M8 6h8', 'M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01'],
  'users': ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  'user': ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  'phone': ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z'],
  'mail': ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 6-10 7L2 6'],
  'globe': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z'],
  'briefcase': ['M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M2 13h20'],
  'sun': ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'],
  'leaf': ['M6 21c8 0 14-6 14-15V4h-2C9 4 3 10 3 18v3h3z', 'M6 21c0-6 4-11 11-13'],
  'droplet': ['M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7z'],
  'zap': ['M13 2 3 14h7l-1 8 11-13h-8l1-7z'],
  'wifi': ['M2 9a15 15 0 0 1 20 0', 'M5.5 12.5a10 10 0 0 1 13 0', 'M9 16a5 5 0 0 1 6 0', 'M12 19h.01'],
  'layers': ['m12 2 9 5-9 5-9-5 9-5z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
  'grid': ['M4 3h7v7H4zM13 3h7v7h-7zM4 14h7v7H4zM13 14h7v7h-7z'],
  'camera': ['M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  'arrow-right': ['M4 12h16', 'm13 5 7 7-7 7'],
  'arrow-up-right': ['M6 18 18 6', 'M9 6h9v9'],
};

export const ICON_NAMES = Object.keys(ICON_PACK).sort();

export interface IconVectorProps {
  viewBox: string;
  preserveAspectRatio: string;
  paths: Array<{ d: string; fill: string; stroke: string; strokeWidth: number }>;
}

/** Expand an icon name into vector-overlay path props (stroke glyph). */
export function iconToVectorProps(name: string, color = '#111111'): IconVectorProps | null {
  const paths = ICON_PACK[name];
  if (!paths) return null;
  return {
    viewBox: ICON_VIEWBOX,
    preserveAspectRatio: 'xMidYMid meet',
    paths: paths.map((d) => ({ d, fill: 'none', stroke: color, strokeWidth: 2 })),
  };
}
