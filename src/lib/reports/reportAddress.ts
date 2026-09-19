/**
 * Full-address resolution for generated investment reports.
 *
 * Some reports are created from an intake where only the street line was
 * captured, so `property_address` reads "22 Shiraz Street" while the report
 * body says "22 Shiraz Street, Muswellbrook NSW 2333". This module recovers the
 * locality (suburb, state, postcode) from the report narrative so every card,
 * table row and search query shows the complete Australian address.
 *
 * Presentation only — nothing here mutates stored data.
 */

const STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';

/** "Suburb STATE 1234" or "Suburb, STATE 1234" anywhere in prose. */
const LOCALITY_PATTERN = new RegExp(
  `([A-Za-z][A-Za-z'\\-\\u2019]*(?:[ ][A-Za-z][A-Za-z'\\-\\u2019]*){0,3}),?\\s+(${STATES})\\s+(\\d{4})`,
  'g',
);

const PROPERTY_LINE_PATTERN = new RegExp(
  `\\*\\*(?:Property|Property Address|Address|Subject Property)(?:\\*\\*)?:?\\*{0,2}\\s*(?:\\r?\\n\\s*)?([^\\n*]{6,160})`,
  'i',
);

const hasLocality = (value: string) => new RegExp(`(?:${STATES})\\s*\\d{4}\\s*$`, 'i').test(value.trim());

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

const tidy = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/, '')
    .replace(/\bCopy\b\s*$/i, '')
    .replace(/(\d{4})\s*Copy$/i, '$1')
    .trim();

const titleCaseSuburb = (value: string) =>
  value
    .split(/([ \-])/)
    .map((part) =>
      /^[ \-]$/.test(part) || part.length === 0
        ? part
        : part.length <= 2 && part === part.toUpperCase()
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');

interface Locality {
  suburb: string;
  state: string;
  postcode: string;
}

/** Most frequently mentioned locality in the narrative wins — that is the subject suburb. */
function findLocality(text: string): Locality | null {
  const counts = new Map<string, { locality: Locality; count: number }>();
  for (const match of text.matchAll(LOCALITY_PATTERN)) {
    // Prose leading into the locality ("located in Maryborough QLD 4650") is
    // trimmed by keeping only the capitalised words that form the suburb name.
    const words = tidy(match[1]).split(' ');
    while (words.length > 1 && !/^[A-Z]/.test(words[0])) words.shift();
    while (words.length > 1 && /^(?:In|The|Of|And|For|To|At|From|Is|As|By|With|Near|Within|Property|Located|Subject|Suburb)$/i.test(words[0])) words.shift();
    const suburb = words.join(' ');
    if (!suburb || suburb.length < 3) continue;
    // Skip sentence fragments that merely precede a state ("in the suburb of" style noise).
    if (/\b(?:in|the|of|and|for|to|at|from|is|as|by|with|near|within)$/i.test(suburb)) continue;
    const locality: Locality = { suburb: titleCaseSuburb(suburb), state: match[2].toUpperCase(), postcode: match[3] };
    const key = `${normalise(locality.suburb)}|${locality.state}|${locality.postcode}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { locality, count: 1 });
  }
  if (counts.size === 0) return null;
  return [...counts.values()].sort((a, b) => b.count - a.count)[0].locality;
}

const sameStreet = (candidate: string, stored: string) => {
  const comparable = (value: string) => normalise(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const candidateKey = comparable(candidate);
  const storedKey = comparable(stored);
  return storedKey.length >= 4 && (candidateKey.startsWith(storedKey) || candidateKey.includes(storedKey));
};

export interface ReportAddressSource {
  property_address?: string | null;
  report_content?: string | null;
  sources_content?: string | null;
}

/**
 * Returns the fullest address available for a report: the stored value when it
 * already carries a state and postcode, otherwise the stored street line plus
 * the locality recovered from the report body.
 */
export function resolveReportAddress(report: ReportAddressSource | null | undefined): string {
  const stored = tidy(report?.property_address || '');
  if (!report) return 'Address unavailable';
  if (!stored) return 'Address unavailable';
  if (hasLocality(stored)) return stored;

  const text = `${report.report_content || ''}\n${report.sources_content || ''}`;
  if (!text.trim()) return stored;

  // 1. An explicit "**Property:** <full address>" line that extends the stored street.
  const line = text.match(PROPERTY_LINE_PATTERN)?.[1];
  if (line) {
    const candidate = tidy(line);
    if (hasLocality(candidate) && sameStreet(candidate, stored)) return candidate;
  }

  // 2. Otherwise append the dominant locality mentioned in the narrative.
  const locality = findLocality(text);
  if (!locality) return stored;
  const localityPattern = new RegExp(`[^\\n]{0,180}${locality.state}\\s+${locality.postcode}`, 'i');
  const localityLine = text.match(localityPattern)?.[0] || '';
  if (!sameStreet(localityLine, stored)) return stored;
  if (normalise(stored).includes(normalise(locality.suburb))) {
    return hasLocality(stored) ? stored : `${stored} ${locality.state} ${locality.postcode}`;
  }
  return `${stored}, ${locality.suburb} ${locality.state} ${locality.postcode}`;
}
