/**
 * Deciding whether two written addresses are the same property.
 *
 * This exists because of one specific failure mode. When a listing arrives with
 * no source link, the only way to find its photographs is to search for the
 * property elsewhere — and the moment you do that, you can attach the wrong
 * house to the card. On a marketplace that is worse than showing no photograph
 * at all: a blank frame is an absence, a wrong photograph is a lie, and it is
 * the kind of lie a buyer acts on.
 *
 * So the bar here is deliberately high and deliberately dumb. It does not score
 * similarity or rank candidates. It answers yes only when the street number, the
 * street name and the suburb all agree after normalisation, and it answers no to
 * everything else — including cases a human would probably accept. A missed
 * match costs one grey card. A false match costs trust.
 */

/**
 * Australian street-type abbreviations, collapsed to one spelling.
 *
 * Agents write the same street six ways ("Hillcrest Rd", "Hillcrest Road",
 * "HILLCREST RD."), and the email parser preserves whatever it was given, so the
 * record and the web page rarely agree on the abbreviation.
 */
const STREET_TYPES: Record<string, string> = {
  rd: 'road', road: 'road',
  st: 'street', str: 'street', street: 'street',
  ave: 'avenue', av: 'avenue', avenue: 'avenue',
  dr: 'drive', drv: 'drive', drive: 'drive',
  ct: 'court', crt: 'court', court: 'court',
  pl: 'place', place: 'place',
  cres: 'crescent', cr: 'crescent', crescent: 'crescent',
  pde: 'parade', parade: 'parade',
  hwy: 'highway', highway: 'highway',
  ln: 'lane', lane: 'lane',
  tce: 'terrace', terrace: 'terrace',
  cl: 'close', close: 'close',
  cct: 'circuit', circuit: 'circuit',
  gr: 'grove', grv: 'grove', grove: 'grove',
  bvd: 'boulevard', blvd: 'boulevard', boulevard: 'boulevard',
  way: 'way', loop: 'loop', rise: 'rise', mews: 'mews', esplanade: 'esplanade',
  esp: 'esplanade', square: 'square', sq: 'square', walk: 'walk',
  ridge: 'ridge', view: 'view', vista: 'vista', glade: 'glade', link: 'link',
  circle: 'circle', cir: 'circle', track: 'track', trail: 'trail',
};

export interface ParsedAddress {
  /** Street number as written, lowercased: `16a`, `36-38`, `7`. */
  number: string | null;
  /** Sub-dwelling, when the address carries one: the `1` of `1/72`. */
  unit: string | null;
  /** Street name with its type normalised: `hillcrest road`. */
  street: string | null;
  /** Every significant token, for the coarse containment check. */
  tokens: string[];
}

function clean(value: string): string {
  return value
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9/\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull the number, unit and street out of a written address.
 *
 * Deliberately tolerant of trailing junk — page titles arrive as
 * "16A Beach Road, AIREYS INLET | Great Ocean Properties" — because the caller
 * compares field by field rather than string to string.
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = { number: null, unit: null, street: null, tokens: [] };
  if (typeof raw !== 'string') return empty;

  // Everything after a pipe or a bullet is site chrome, not address.
  const head = clean(raw.split(/[|•·–—]/)[0]);
  if (!head) return empty;

  const tokens = head.split(' ').filter(Boolean);
  if (tokens.length === 0) return empty;

  let unit: string | null = null;
  let number: string | null = null;
  let rest = tokens;

  // "unit 5 12 smith st" / "lot 3 smith st" — drop the label, keep the value.
  if (/^(unit|apt|apartment|lot|villa|suite|shop)$/.test(rest[0]) && rest.length > 1) {
    unit = rest[1];
    rest = rest.slice(2);
  }

  const first = rest[0] ?? '';
  // `1/72` — sub-dwelling and street number in one token.
  const slash = first.match(/^(\d+[a-z]?)\/(\d+[a-z]?)$/);
  if (slash) {
    unit = unit ?? slash[1];
    number = slash[2];
    rest = rest.slice(1);
  } else if (/^\d+[a-z]?(-\d+[a-z]?)?$/.test(first)) {
    // `36-38` stays whole: a range is a different property from either end.
    number = first;
    rest = rest.slice(1);
  }

  const streetTokens = rest.map((token) => STREET_TYPES[token] ?? token);
  const street = streetTokens.length > 0 ? streetTokens.join(' ') : null;

  return { number, unit, street, tokens: [...(number ? [number] : []), ...streetTokens] };
}

/** Suburb equality, ignoring case, punctuation and the state that often trails it. */
export function sameSuburb(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string | null | undefined) =>
    clean(String(value ?? ''))
      .replace(/\b(nsw|vic|qld|wa|sa|tas|nt|act)\b/g, '')
      .replace(/\b\d{4}\b/g, '')
      .trim();
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}

/**
 * Is `candidate` the same property as `record`?
 *
 * `candidate` is untrusted page text — a title, a heading — so it may carry the
 * suburb, the agency name and a tagline alongside the address.
 *
 * Both a street number and a street name are required on each side. An address
 * that is only a street ("Great Ocean Road, Anglesea") could be any of a hundred
 * houses, and matching it would be exactly the false positive this module
 * exists to prevent.
 */
export function isSameProperty(
  record: { address: string | null | undefined; suburb: string | null | undefined },
  candidate: { address: string | null | undefined; suburb?: string | null | undefined },
): boolean {
  const left = parseAddress(record.address);
  const right = parseAddress(candidate.address);

  if (!left.number || !right.number) return false;
  if (!left.street || !right.street) return false;
  if (left.number !== right.number) return false;

  // Units must agree whenever *either* side names one.
  //
  // The tolerant version of this rule (only compare when both sides state a
  // unit) matched a record for "143D Great Ocean Road" against a page for
  // "5/143D Great Ocean Road" — one townhouse out of a complex. Its interior
  // photographs are not the property on the card unless the card is also unit
  // 5, and nothing in either record says whether it is. Ambiguous is not a
  // match.
  if ((left.unit || right.unit) && left.unit !== right.unit) return false;

  // The candidate's street segment usually has the suburb glued onto the end
  // ("beach road aireys inlet"), so containment either way is the honest test.
  const streetsAgree =
    left.street === right.street ||
    right.street.startsWith(`${left.street} `) ||
    left.street.startsWith(`${right.street} `);
  if (!streetsAgree) return false;

  // Suburb, where the page states one. Page titles often fold it into the
  // street segment instead, which the containment check above already covered.
  const candidateSuburb = candidate.suburb;
  if (candidateSuburb && record.suburb && !sameSuburb(record.suburb, candidateSuburb)) {
    return false;
  }
  if (!candidateSuburb && record.suburb) {
    const suburbTokens = clean(record.suburb).split(' ').filter((t) => t.length > 2);
    const haystack = `${right.street} ${clean(String(candidate.address ?? ''))}`;
    if (suburbTokens.length > 0 && !suburbTokens.every((token) => haystack.includes(token))) {
      return false;
    }
  }

  return true;
}
