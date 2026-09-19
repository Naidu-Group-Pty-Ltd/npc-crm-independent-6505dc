/**
 * A national reading of a zone — derived, disclosed, and never a substitute.
 *
 * NSW answered `R1 / General Residential` and VIC `UGZ8 / Urban Growth Zone
 * — Schedule 8` for equivalent suburban land: these are different legal
 * systems, not different spellings, so the research doc's rule 3 is binding:
 * store the verbatim code AND a normalised family, and **the family must
 * never be printed as though it were the zone**.
 *
 * How the family is derived matters as much as that it exists. NSW re-used
 * its `E` prefix (E1–E4 environmental became C1–C4 conservation, and a NEW
 * E1–E5 means employment), so judging family from a code table is exactly
 * the plausible-wrong-figure trap. The family is therefore read from the
 * INSTRUMENT'S OWN WORDS — the zone label the service returned — by keyword,
 * and where nothing matches the family is null, never a guess. The one
 * exception is the ACT, whose labels name sub-policies ("CORE ZONE") rather
 * than the land use: there the Territory Plan's own published legend for its
 * code prefixes (RZ residential, CZ commercial, IZ industrial, TSZ transport
 * and services, PRZ parks and recreation, CFZ community facility, NUZ
 * non-urban) is applied — the scheme's taxonomy, not ours.
 */

export type ZoneFamily =
  | 'residential'
  | 'commercial'
  | 'mixed_use'
  | 'industrial'
  | 'rural'
  | 'environmental'
  | 'special_purpose'
  | 'community'
  | 'recreation'
  | 'urban_growth'
  | 'waterway';

/** Ordered: the first matching family wins, and more specific phrases go first. */
const KEYWORD_FAMILIES: ReadonlyArray<[RegExp, ZoneFamily]> = [
  [/urban growth/i, 'urban_growth'],
  [/mixed use/i, 'mixed_use'],
  [/residential|housing|village/i, 'residential'],
  // Deliberately narrow: NSW's employment-zones reform makes "employment"
  // span retail centres (E1) through heavy industry (E5), so that word alone
  // resolves to no family rather than the wrong one.
  [/industrial/i, 'industrial'],
  [/business|commercial|centre|core zone|office/i, 'commercial'],
  [/rural|agricultur|farming|primary production/i, 'rural'],
  [/environment|conservation|coastal protection|landscape/i, 'environmental'],
  [/recreation|open space|park/i, 'recreation'],
  [/community|utilities|infrastructur|special (purpose|use)|transport/i, 'community'],
  [/waterway|water supply/i, 'waterway'],
];

const ACT_PREFIX_FAMILIES: ReadonlyArray<[RegExp, ZoneFamily]> = [
  [/^RZ\d/i, 'residential'],
  [/^CZ\d/i, 'commercial'],
  [/^IZ\d/i, 'industrial'],
  [/^TSZ\d/i, 'community'],
  [/^PRZ\d/i, 'recreation'],
  [/^CFZ/i, 'community'],
  [/^NUZ\d/i, 'rural'],
];

export const ZONE_FAMILY_LABEL: Readonly<Record<ZoneFamily, string>> = {
  residential: 'residential',
  commercial: 'commercial/centre',
  mixed_use: 'mixed use',
  industrial: 'industrial/employment',
  rural: 'rural',
  environmental: 'environmental/conservation',
  special_purpose: 'special purpose',
  community: 'community/infrastructure',
  recreation: 'recreation/open space',
  urban_growth: 'urban growth',
  waterway: 'waterway',
};

/**
 * Derive the family from what the instrument itself says. Null when the
 * label carries no recognised land-use word — an unfamiliar zone is
 * disclosed as itself, not filed under a family it may not belong to.
 */
export function deriveZoneFamily(
  jurisdiction: string,
  zoneCode: string,
  zoneLabel: string | null,
): ZoneFamily | null {
  if (jurisdiction === 'ACT') {
    for (const [re, fam] of ACT_PREFIX_FAMILIES) {
      if (re.test(zoneCode)) return fam;
    }
  }
  const text = `${zoneLabel ?? ''}`;
  for (const [re, fam] of KEYWORD_FAMILIES) {
    if (re.test(text)) return fam;
  }
  return null;
}
