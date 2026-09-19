/**
 * Resolve a PDF embedded font's PostScript name to the closest available web font.
 * Returns substituted=true when we fall back to a generic stack so the importer
 * can surface it in the fidelity report.
 */
const MAP: Array<{ test: RegExp; family: string }> = [
  { test: /helvetica|arial|liberation\s*sans|nimbus\s*sans/i, family: 'Helvetica, Arial, sans-serif' },
  { test: /times|tinos|liberation\s*serif|nimbus\s*roman/i, family: '"Times New Roman", Times, serif' },
  { test: /courier|cousine|liberation\s*mono/i, family: '"Courier New", Courier, monospace' },
  { test: /georgia/i, family: 'Georgia, serif' },
  { test: /garamond/i, family: 'Garamond, serif' },
  { test: /verdana/i, family: 'Verdana, sans-serif' },
  { test: /tahoma/i, family: 'Tahoma, sans-serif' },
  { test: /calibri|carlito/i, family: 'Calibri, "Carlito", sans-serif' },
  { test: /cambria|caladea/i, family: 'Cambria, "Caladea", serif' },
  { test: /roboto/i, family: 'Roboto, sans-serif' },
  { test: /open\s*sans/i, family: '"Open Sans", sans-serif' },
  { test: /lato/i, family: 'Lato, sans-serif' },
  { test: /montserrat/i, family: 'Montserrat, sans-serif' },
  { test: /inter/i, family: 'Inter, sans-serif' },
  { test: /playfair/i, family: '"Playfair Display", serif' },
  { test: /poppins/i, family: 'Poppins, sans-serif' },
];

export function resolveFontFamily(psName: string): { family: string; substituted: boolean } {
  const cleaned = psName.replace(/^[A-Z]{6}\+/, ''); // strip subset prefix
  for (const m of MAP) {
    if (m.test.test(cleaned)) return { family: m.family, substituted: false };
  }
  return { family: 'Helvetica, Arial, sans-serif', substituted: true };
}

import { findCatalogFontLoose } from '../fontCatalog';

// Weight/style tokens trimmed from the tail of a PostScript name before matching
// (e.g. "OpenSans-Bold" → "Open Sans"). Words like "Display"/"Text" are KEPT
// because they are part of real family names ("Playfair Display").
const STYLE_WORDS = new Set([
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'regular', 'book', 'normal',
  'medium', 'semibold', 'demibold', 'demi', 'bold', 'extrabold', 'ultrabold', 'black',
  'heavy', 'italic', 'oblique', 'condensed', 'expanded', 'narrow', 'wide', 'mt', 'ps',
]);

/** Normalised key for matching font names across the subset tag + separators. */
export function fontLookupKey(name: string): string {
  return (name || '').replace(/^[A-Z]{6}\+/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up an embedded `@font-face` family for a source font name, tolerant of
 * the subset tag and truncated span names (prefix match either direction).
 */
export function lookupEmbeddedFamily(
  name: string,
  map: Record<string, string> | undefined,
): string | undefined {
  if (!map) return undefined;
  const key = fontLookupKey(name);
  if (!key) return undefined;
  if (map[key]) return map[key];
  for (const [k, family] of Object.entries(map)) {
    if (k.startsWith(key) || key.startsWith(k)) return family;
  }
  return undefined;
}

/** Turn a PostScript name into a spaced candidate family ("OpenSans-Bold" → "Open Sans Bold"). */
export function psNameToCandidateFamily(psName: string): string {
  return (psName || '')
    .replace(/^[A-Z]{6}\+/, '')              // strip subset tag
    .replace(/[_-]+/g, ' ')                   // separators → space
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // split camelCase
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a source PostScript font name to the best **catalog** family (so
 * `ensureCatalogFontFaces` can load it from Google Fonts), trimming trailing
 * weight/style tokens. Falls back to the generic `resolveFontFamily` stack when
 * the family is not in the catalog (e.g. proprietary fonts).
 */
export function resolveSourceFontFamily(
  psName: string,
): { family: string; substituted: boolean; catalogFamily?: string } {
  const words = psNameToCandidateFamily(psName).split(' ').filter(Boolean);
  for (let end = words.length; end >= 1; end -= 1) {
    const candidate = words.slice(0, end).join(' ');
    const cat = findCatalogFontLoose(candidate);
    if (cat) return { family: cat.family, substituted: false, catalogFamily: cat.family };
    // Only keep trimming while the tail is a weight/style token.
    if (!STYLE_WORDS.has((words[end - 1] || '').toLowerCase())) break;
  }
  return resolveFontFamily(psName);
}
