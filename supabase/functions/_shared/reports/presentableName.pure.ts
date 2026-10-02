/**
 * A register's word set the way a reader expects to read it.
 *
 * Registers publish in their own casing, and a document that prints the value
 * verbatim prints the register's typesetting rather than the name: the NSW
 * cadastre names a council "THE HILLS SHIRE", and the record's property type
 * is the vocabulary word "house". The 18 Annabelle Crescent Compass's property
 * table printed both, under "18 Annabelle Crescent, Kellyville NSW 2155"
 * (Audit 6, 1 Oct 2026).
 *
 * Each rule touches only the casing it can read. A value that already mixes
 * cases is somebody's typesetting and is returned as it stands, so a council
 * a register publishes as "Fraser Coast Regional" is never re-cased.
 */

/** Official spellings no casing rule reaches. */
const IRREGULAR_NAMES: Readonly<Record<string, string>> = {
  'KU-RING-GAI': 'Ku-ring-gai',
};

/** Joining words kept lower-case inside a name: "City of Sydney". */
const JOINING_WORDS = new Set(['of', 'and', 'the']);

/**
 * Abbreviations that stay in capitals inside a name. Registers qualify a
 * council by its state ("BAYSIDE (NSW)", "UNINCORPORATED ACT"), and an
 * abbreviation set as a word reads as a different word: "Bayside (nsw)".
 */
const KEPT_CAPITALS = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

/** An all-capitals name set as a name: "THE HILLS SHIRE" → "The Hills Shire". */
export function presentableName(value: string): string {
  if (value !== value.toUpperCase() || !/[A-Z]/.test(value)) return value;
  const irregular = IRREGULAR_NAMES[value.trim()];
  if (irregular) return irregular;
  // Words are split on spaces and hyphens only, so an apostrophe stays inside
  // its word: "HUNTER'S HILL" is "Hunter's Hill", never "Hunter'S Hill". A
  // word's leading bracket or quote is kept in front of it, so "(NSW)" is
  // judged as "NSW".
  return value.toLowerCase().split(/(\s+|-)/).map((part, i) => {
    const m = /^([^a-z]*)([a-z].*)$/.exec(part);
    if (!m) return part;
    const [, lead, word] = m;
    const bare = word.replace(/[^a-z]+$/, '');
    if (KEPT_CAPITALS.has(bare.toUpperCase())) return lead + bare.toUpperCase() + word.slice(bare.length);
    if (i > 0 && !lead && JOINING_WORDS.has(word)) return part;
    return lead + word.charAt(0).toUpperCase() + word.slice(1);
  }).join('');
}

/**
 * A lower-case vocabulary word set as a value: "house" → "House",
 * "house_and_land" → "House and land". An all-capitals term is set as a name.
 */
export function presentableTerm(value: string): string {
  if (/^[a-z][a-z0-9_ /-]*$/.test(value)) {
    const words = value.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return presentableName(value);
}
