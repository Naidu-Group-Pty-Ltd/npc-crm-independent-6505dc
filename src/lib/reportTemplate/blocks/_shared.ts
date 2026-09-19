/**
 * Shared primitives for Compass visual blocks: color parsing, rating chips,
 * confidence chips, and column splitter helpers used by scorecard /
 * riskRegister / amenityMatrix / planningTable / ddChecklist / decisionBox.
 */
import type { jsPDF } from 'jspdf';
import { UNSTATED_CONFIDENCE } from './_chips.html';

export function hex(s: string) {
  let h = String(s ?? '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export type Rating = 'Strong' | 'Moderate' | 'Watch' | 'High' | 'Medium' | 'Low' | string;
export type Confidence =
  | 'Verified'
  | 'Indicative'
  | 'Planned'
  | 'UnderConstruction'
  | 'Unverified'
  | string;

export const RATING_PALETTE: Record<string, { bg: string; fg: string }> = {
  Strong:   { bg: '#DCFCE7', fg: '#065F46' },
  Moderate: { bg: '#FEF3C7', fg: '#92400E' },
  Watch:    { bg: '#FEE2E2', fg: '#991B1B' },
  High:     { bg: '#FEE2E2', fg: '#991B1B' },
  Medium:   { bg: '#FEF3C7', fg: '#92400E' },
  Low:      { bg: '#DCFCE7', fg: '#065F46' },
};

export const CONFIDENCE_PALETTE: Record<string, { bg: string; fg: string; label: string }> = {
  Verified:          { bg: '#DCFCE7', fg: '#065F46', label: 'Verified' },
  Indicative:        { bg: '#FEF3C7', fg: '#92400E', label: 'Indicative' },
  Planned:           { bg: '#DBEAFE', fg: '#1E3A8A', label: 'Planned' },
  UnderConstruction: { bg: '#E0E7FF', fg: '#3730A3', label: 'Under construction' },
  Unverified:        { bg: '#F3F4F6', fg: '#374151', label: 'Unverified' },
};

/** Draw a pill / chip. Returns its width in pt. */
export function drawChip(
  doc: jsPDF,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
  fontSize = 8,
): number {
  const bgC = hex(bg);
  const fgC = hex(fg);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const w = doc.getTextWidth(text) + 12;
  doc.setFillColor(bgC.r, bgC.g, bgC.b);
  doc.roundedRect(x, y - fontSize, w, fontSize + 6, fontSize / 2 + 2, fontSize / 2 + 2, 'F');
  doc.setTextColor(fgC.r, fgC.g, fgC.b);
  doc.text(text, x + 6, y - 1, { baseline: 'alphabetic' });
  return w;
}

export function ratingChip(doc: jsPDF, x: number, y: number, rating: Rating, fontSize = 8): number {
  const c = RATING_PALETTE[rating] ?? { bg: '#F3F4F6', fg: '#374151' };
  return drawChip(doc, x, y, rating, c.bg, c.fg, fontSize);
}

export function confidenceChip(
  doc: jsPDF,
  x: number,
  y: number,
  conf: Confidence,
  fontSize = 7.5,
): number {
  // An unstated confidence draws nothing — see `UNSTATED_CONFIDENCE`.
  if (UNSTATED_CONFIDENCE.test(String(conf ?? ''))) return 0;
  const c = CONFIDENCE_PALETTE[conf] ?? { bg: '#F3F4F6', fg: '#374151', label: String(conf) };
  return drawChip(doc, x, y, c.label, c.bg, c.fg, fontSize);
}
