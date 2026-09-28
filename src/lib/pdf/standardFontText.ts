/**
 * Text for jsPDF's built-in fonts, which carry the WinAnsi set and nothing
 * else.
 *
 * A character outside that set is not dropped; jsPDF writes its bytes as
 * WinAnsi, so it prints as other characters. The Strategy Rationale Brief
 * printed every "→" in its lever labels as `!’` ("Revalue 17 Cahill Street
 * !’ $480,000"), on a document that goes to a finance team. The composer's
 * strings are shared with the typeset brief, where the arrow is correct, so
 * the words stay as they are and the jsPDF document is guarded where it
 * draws.
 */
import type { jsPDF } from 'jspdf';

const REPLACEMENTS: Array<[RegExp, string]> = [
  // An arrow between two things reads as "to".
  [/\s*\u2192\s*/g, ' to '],
  [/\s*\u2190\s*/g, ' from '],
  // A tick after a target reads as "met".
  [/\s*[\u2713\u2714]/g, ' met'],
  // A minus sign is a sign: dropped, a negative figure would read as a gain.
  [/\u2212/g, '-'],
  [/\u2265/g, '>='],
  [/\u2264/g, '<='],
  [/\u2248/g, '~'],
  // Thin, hair, narrow and figure spaces.
  [/[\u2009\u200A\u202F\u2007]/g, ' '],
  // Zero-width characters and the emoji variation selector.
  [/[\u200B\u200C\u200D\uFE0F]/g, ''],
  // A warning glyph has no WinAnsi form, and the words beside it already warn.
  [/\u26A0\s*/g, ''],
];

export function standardFontText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Guards one document: everything it draws, wraps or measures passes through
 * `standardFontText` first, so a measured width is the width of what prints.
 */
export function guardStandardFontText(doc: jsPDF): jsPDF {
  const map = (t: unknown) =>
    typeof t === 'string' ? standardFontText(t) : Array.isArray(t) ? t.map(map) : t;
  const text = doc.text.bind(doc);
  const split = doc.splitTextToSize.bind(doc);
  const width = doc.getTextWidth.bind(doc);
  (doc as unknown as { text: unknown }).text = (t: unknown, ...rest: unknown[]) =>
    (text as (...a: unknown[]) => jsPDF)(map(t), ...rest);
  (doc as unknown as { splitTextToSize: unknown }).splitTextToSize = (t: unknown, ...rest: unknown[]) =>
    (split as (...a: unknown[]) => string[])(map(t), ...rest);
  (doc as unknown as { getTextWidth: unknown }).getTextWidth = (t: unknown) =>
    (width as (a: unknown) => number)(map(t));
  return doc;
}
