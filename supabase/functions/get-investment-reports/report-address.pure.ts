const AU_STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';
const COMPLETE_LOCALITY = new RegExp(`\\b(?:${AU_STATES})\\s+\\d{4}\\b`, 'i');
const EXPLICIT_PROPERTY_LINE = new RegExp(
  `(?:Subject Property|Property Address|Property)\\s*(?:\\*{0,2}:?\\*{0,2})?\\s*(?:\\r?\\n\\s*)?([^\\n]{4,180}?\\b(?:${AU_STATES})\\s+\\d{4})`,
  'i',
);
const ANY_ADDRESS_LINE = new RegExp(`([^\\n]{4,180}?\\b(?:${AU_STATES})\\s+\\d{4})`, 'gi');

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

const tidyAddress = (value: string) => value
  .replace(/\{\{[^}]*\}\}/g, ' ')
  .replace(/^[#>*_`\-\s]+/, '')
  .replace(/[*_`]+/g, '')
  .replace(/\s+/g, ' ')
  .replace(/^[^\d]*(?=\d)/, '')
  .replace(/\s*(?:Property type|Prepared for|Prepared by|Configuration)\s*:.*$/i, '')
  .replace(/[.,;:\s]+$/, '')
  .trim();

const streetKey = (value: string) => normalise(value)
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function candidateMatchesStored(candidate: string, stored: string): boolean {
  const candidateKey = streetKey(candidate);
  const storedKey = streetKey(stored);
  return storedKey.length >= 4 && (candidateKey.startsWith(storedKey) || candidateKey.includes(storedKey));
}

/**
 * Resolves the complete Australian address without returning report prose to
 * list clients. Explicit cover-page property labels win; otherwise the first
 * locality-bearing line containing the stored street is used.
 */
export function resolveCompleteReportAddress(
  storedValue: unknown,
  reportContent: unknown,
  sourcesContent?: unknown,
): string {
  const stored = tidyAddress(typeof storedValue === 'string' ? storedValue : '');
  if (!stored) return 'Address unavailable';
  if (COMPLETE_LOCALITY.test(stored)) return stored;

  const text = [reportContent, sourcesContent].filter((value): value is string => typeof value === 'string').join('\n');
  if (!text) return stored;

  const explicit = text.match(EXPLICIT_PROPERTY_LINE)?.[1];
  if (explicit) {
    const candidate = tidyAddress(explicit);
    if (COMPLETE_LOCALITY.test(candidate) && candidateMatchesStored(candidate, stored)) return candidate;
  }

  for (const match of text.matchAll(ANY_ADDRESS_LINE)) {
    const candidate = tidyAddress(match[1]);
    if (COMPLETE_LOCALITY.test(candidate) && candidateMatchesStored(candidate, stored)) return candidate;
  }
  return stored;
}

export const hasCompleteAustralianAddress = (value: unknown): boolean =>
  typeof value === 'string' && COMPLETE_LOCALITY.test(value);
