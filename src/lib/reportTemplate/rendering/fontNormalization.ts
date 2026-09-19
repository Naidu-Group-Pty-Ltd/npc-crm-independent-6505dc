/**
 * fontNormalization — map messy PDF font names to CSS-safe families/stacks.
 *
 * Phase 7D fidelity hardening. PDF imports carry font names like
 * `ABCDEE+Helvetica-Bold` (a subset prefix + a base face + a style suffix).
 * Passed to the browser verbatim, these never match an installed face and the
 * renderer silently substitutes something with different metrics — text drifts
 * from the source raster. These helpers strip the noise, canonicalise common
 * faces, and emit deterministic CSS stacks so the editor, renderer, and Visual QA
 * capture all resolve the same font.
 *
 * Pure and dependency-free.
 */

/** Canonical families that have a curated stack. */
const FONT_STACKS: Record<string, string> = {
  Arial: 'Arial, Helvetica, sans-serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  Roboto: 'Roboto, Arial, sans-serif',
  Inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
};

/** Last-resort family when input is empty/unknown. */
const FALLBACK_FAMILY = 'Inter';

/**
 * Fallback stack for imported text that carries no font information at all.
 * Deliberately matches the stack `pdfImport/fontResolver` emits for Helvetica, so
 * untyped imported text renders identically to resolved text — and reliably on the
 * Linux/WeasyPrint export server, where a bare `"Helvetica"` is not an installed
 * face and silently falls back. Used at the CDIR→template ingestion boundary.
 */
export const DEFAULT_IMPORT_FONT_STACK = 'Helvetica, Arial, sans-serif';

/** Lowercased alias → canonical family. */
const FONT_ALIASES: Record<string, string> = {
  helvetica: 'Arial',
  helveticaneue: 'Arial',
  'helvetica neue': 'Arial',
  arial: 'Arial',
  arialmt: 'Arial',
  liberationsans: 'Arial',
  times: 'Times New Roman',
  timesnewroman: 'Times New Roman',
  'times new roman': 'Times New Roman',
  timesnewromanpsmt: 'Times New Roman',
  'times roman': 'Times New Roman',
  liberationserif: 'Times New Roman',
  roboto: 'Roboto',
  inter: 'Inter',
};

const SUBSET_PREFIX = /^[A-Z]{6}\+/;
const STYLE_SUFFIX = /[-_\s,]+(bold|italic|oblique|regular|roman|medium|light|semibold|demibold|black|thin|book|heavy|condensed|narrow|mt|ps|psmt)+$/i;

/** Turn a cleaned family into a lookup key: strip quotes, style suffixes, collapse spaces. */
function aliasKey(name: string): string {
  let key = name.replace(/['"]/g, '').trim().toLowerCase();
  // Repeatedly peel trailing style descriptors (e.g. "helvetica-bold-italic").
  let previous = '';
  while (key !== previous) {
    previous = key;
    key = key.replace(STYLE_SUFFIX, '').trim();
  }
  return key.replace(/\s+/g, ' ');
}

/**
 * Strip subset prefix + surrounding noise and canonicalise a common PDF face.
 * Returns a family name (canonical when recognised, otherwise the cleaned input),
 * or `null` for empty/invalid input.
 */
export function normalizePdfFontFamily(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(SUBSET_PREFIX, '').replace(/['"]/g, '').trim();
  if (!cleaned) return null;

  const key = aliasKey(cleaned);
  if (key && FONT_ALIASES[key]) return FONT_ALIASES[key];

  // Unknown face: return the cleaned display name (without the subset prefix).
  return cleaned;
}

/**
 * Build a CSS-safe font stack for a family. Recognised faces get their curated
 * stack; empty/unknown collapse to the system fallback stack.
 */
export function buildFontStack(fontFamily: string | null | undefined): string {
  if (typeof fontFamily !== 'string' || !fontFamily.trim()) return FONT_STACKS[FALLBACK_FAMILY];
  if (FONT_STACKS[fontFamily]) return FONT_STACKS[fontFamily];
  const canonical = FONT_ALIASES[aliasKey(fontFamily)];
  if (canonical && FONT_STACKS[canonical]) return FONT_STACKS[canonical];
  return FONT_STACKS[FALLBACK_FAMILY];
}

/**
 * Resolve arbitrary (PDF-origin) input to a canonical, stack-backed family.
 * Always returns one of the curated families; unknown/empty → `Inter`.
 */
export function resolveTemplateFontFamily(raw: unknown): string {
  const family = normalizePdfFontFamily(raw);
  if (!family) return FALLBACK_FAMILY;
  if (FONT_STACKS[family]) return family;
  const canonical = FONT_ALIASES[aliasKey(family)];
  if (canonical && FONT_STACKS[canonical]) return canonical;
  return FALLBACK_FAMILY;
}
