/**
 * Canonical paper-size catalog for the Template Builder.
 *
 * All values stored in PDF points (1pt = 1/72 inch). Helpers convert to
 * millimetres / inches for the picker UI.
 */

export type PaperOrientation = 'portrait' | 'landscape';
export type PaperUnit = 'pt' | 'mm' | 'in';

export interface PaperSize {
  id: string;
  label: string;
  group: 'ISO A' | 'ISO B' | 'US' | 'Square' | 'Digital';
  /** width in points, portrait orientation */
  widthPt: number;
  /** height in points, portrait orientation */
  heightPt: number;
  description?: string;
}

const mm = (v: number) => Math.round((v / 25.4) * 72 * 100) / 100;
const inch = (v: number) => Math.round(v * 72 * 100) / 100;

export const PAPER_SIZES: PaperSize[] = [
  // ISO A
  { id: 'a3', label: 'A3', group: 'ISO A', widthPt: mm(297), heightPt: mm(420), description: '297 × 420 mm' },
  { id: 'a4', label: 'A4', group: 'ISO A', widthPt: 595, heightPt: 842, description: '210 × 297 mm — standard' },
  { id: 'a5', label: 'A5', group: 'ISO A', widthPt: mm(148), heightPt: mm(210), description: '148 × 210 mm' },
  { id: 'a6', label: 'A6', group: 'ISO A', widthPt: mm(105), heightPt: mm(148), description: '105 × 148 mm — postcard' },
  // ISO B
  { id: 'b4', label: 'B4', group: 'ISO B', widthPt: mm(250), heightPt: mm(353), description: '250 × 353 mm' },
  { id: 'b5', label: 'B5', group: 'ISO B', widthPt: mm(176), heightPt: mm(250), description: '176 × 250 mm' },
  // US
  { id: 'letter', label: 'US Letter', group: 'US', widthPt: 612, heightPt: 792, description: '8.5 × 11 in' },
  { id: 'legal', label: 'US Legal', group: 'US', widthPt: 612, heightPt: 1008, description: '8.5 × 14 in' },
  { id: 'tabloid', label: 'Tabloid', group: 'US', widthPt: 792, heightPt: 1224, description: '11 × 17 in' },
  { id: 'executive', label: 'Executive', group: 'US', widthPt: inch(7.25), heightPt: inch(10.5), description: '7.25 × 10.5 in' },
  { id: 'statement', label: 'Statement', group: 'US', widthPt: inch(5.5), heightPt: inch(8.5), description: '5.5 × 8.5 in' },
  // Square
  { id: 'sq-200', label: 'Square 200mm', group: 'Square', widthPt: mm(200), heightPt: mm(200), description: '200 × 200 mm' },
  { id: 'sq-250', label: 'Square 250mm', group: 'Square', widthPt: mm(250), heightPt: mm(250), description: '250 × 250 mm' },
  // Digital / presentation
  { id: 'slide-16-9', label: 'Slide 16:9', group: 'Digital', widthPt: 960, heightPt: 540, description: 'Widescreen deck' },
  { id: 'slide-4-3', label: 'Slide 4:3', group: 'Digital', widthPt: 720, heightPt: 540, description: 'Classic deck' },
  { id: 'social-1x1', label: 'Social 1:1', group: 'Digital', widthPt: 1080 * 0.72, heightPt: 1080 * 0.72, description: '1080 × 1080 px' },
  { id: 'social-9-16', label: 'Story 9:16', group: 'Digital', widthPt: 1080 * 0.72, heightPt: 1920 * 0.72, description: '1080 × 1920 px' },
];

export function detectPaperSize(widthPt: number, heightPt: number): { paper: PaperSize | null; orientation: PaperOrientation } {
  const tol = 1.5;
  for (const p of PAPER_SIZES) {
    if (Math.abs(p.widthPt - widthPt) < tol && Math.abs(p.heightPt - heightPt) < tol) return { paper: p, orientation: 'portrait' };
    if (Math.abs(p.heightPt - widthPt) < tol && Math.abs(p.widthPt - heightPt) < tol) return { paper: p, orientation: 'landscape' };
  }
  return { paper: null, orientation: widthPt > heightPt ? 'landscape' : 'portrait' };
}

export function applyOrientation(p: PaperSize, orientation: PaperOrientation): { width: number; height: number } {
  return orientation === 'portrait'
    ? { width: p.widthPt, height: p.heightPt }
    : { width: p.heightPt, height: p.widthPt };
}

export function ptToUnit(pt: number, unit: PaperUnit): number {
  if (unit === 'pt') return Math.round(pt * 10) / 10;
  if (unit === 'mm') return Math.round((pt / 72) * 25.4 * 10) / 10;
  return Math.round((pt / 72) * 100) / 100; // in
}

export function unitToPt(value: number, unit: PaperUnit): number {
  if (unit === 'pt') return value;
  if (unit === 'mm') return Math.round((value / 25.4) * 72 * 100) / 100;
  return Math.round(value * 72 * 100) / 100;
}

export const PAPER_GROUPS: PaperSize['group'][] = ['ISO A', 'ISO B', 'US', 'Square', 'Digital'];
