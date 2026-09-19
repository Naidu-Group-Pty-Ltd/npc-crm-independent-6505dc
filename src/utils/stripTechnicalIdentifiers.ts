/**
 * Removes developer-facing identifiers (UUIDs, `id: …` citation fragments,
 * bare row ids) from AI-generated prose before it reaches the UI.
 *
 * Presentation-only: the underlying records keep their ids, this simply keeps
 * reader-facing copy clean and readable.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const PATTERNS: RegExp[] = [
  // ", id: <uuid>" / "; ids: <uuid>, <uuid>" including any trailing list
  new RegExp(`[,;:]?\\s*\\b(?:ids?|uuid|update[_ ]?id|source[_ ]?id|record[_ ]?id)\\b\\s*[:=]?\\s*${UUID}(?:\\s*(?:,|and)\\s*${UUID})*`, 'gi'),
  // bare uuid anywhere left over
  new RegExp(UUID, 'gi'),
];

export function stripTechnicalIdentifiers(input?: string | null): string {
  if (!input) return '';
  let out = String(input);
  for (const pattern of PATTERNS) out = out.replace(pattern, '');

  return out
    // empty parentheses / brackets left behind, e.g. "(Savings.com.au, )"
    .replace(/\(\s*[,;:]?\s*\)/g, '')
    .replace(/\[\s*[,;:]?\s*\]/g, '')
    // dangling separators inside parentheses: "(Savings.com.au, )" -> "(Savings.com.au)"
    .replace(/([(,;:])\s*[,;:]+/g, '$1')
    .replace(/[,;:]\s*\)/g, ')')
    .replace(/\(\s*/g, '(')
    .replace(/\s+\)/g, ')')
    // collapse whitespace and fix stranded punctuation spacing
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\.{2,}(?!\.)/g, '.')
    .trim();
}

export function stripTechnicalIdentifiersFromList(items?: (string | null | undefined)[] | null): string[] {
  if (!items?.length) return [];
  return items.map(item => stripTechnicalIdentifiers(item)).filter(Boolean);
}

/**
 * Conservative variant: removes only explicitly-labelled id fragments
 * (e.g. "id: <uuid>"), leaving URLs and citation markers untouched. Use where
 * the text may contain markdown links whose hrefs legitimately carry ids.
 */
export function stripLabelledIdentifiers(input?: string | null): string {
  if (!input) return '';
  return String(input)
    .replace(PATTERNS[0], '')
    .replace(/\(\s*[,;:]?\s*\)/g, '')
    .replace(/[,;:]\s*\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
