/**
 * The address as a geocoder should be asked it.
 *
 * This module exists because of a measured production defect, and the
 * measurement is the argument. Of the 1,112 stored investment reports that
 * carry a coordinate, **183 are outside Australia** — Blacksburg Virginia,
 * Manhattan, Knoxville, Bristol, Edinburgh, Auckland, Ottawa and Bulacan in
 * the Philippines, each answered with total confidence. Split by what the
 * address itself said:
 *
 * | the address names…      | reports | landed outside Australia |
 * |-------------------------|--------:|-------------------------:|
 * | a state AND a postcode  |     283 |          **1** (0.4%)    |
 * | neither                 |     768 |        **180** (23.4%)   |
 *
 * The 180 are bare street names — `Keystone Drive`, `124 First Avenue`,
 * `4 Lilac Close`, `44 Frederick Street` — and a bare street name exists in
 * every English-speaking country. Nothing was malfunctioning: Google was
 * asked an ambiguous question and answered one of its correct answers.
 *
 * Two things follow, and this module is the first of them.
 *
 * **Ask the question with its locality.** `location-intelligence-service` is
 * handed `suburb`, `postcode` and `state` and used them for the CBD lookup
 * and the public-transport call, while the one request that actually needed
 * a locality — the geocode — was given the address alone. The fields were
 * already there.
 *
 * **Then filter, then check.** `components=country:AU` is a filter where
 * `region=au` is only a bias, and `assessAuPoint` judges the answer. But a
 * filter on its own only relocates this failure: `Keystone Drive` restricted
 * to Australia resolves to *some* Keystone Drive here, in the wrong suburb,
 * inside the country box, past every gate. Composing the query is what makes
 * the answer right rather than merely local.
 *
 * Pure: no Deno, no DOM, no network.
 */

export interface AuAddressParts {
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  state?: string | null;
}

/**
 * Reduce a fragment to comparable tokens: lower case, non-alphanumerics
 * collapsed to single spaces, padded so a whole-token containment test cannot
 * match inside a longer word. `St Marys` and `Marys` are different places.
 */
function tokenBand(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Compose the query string for an Australian address geocode.
 *
 * Parts already present in the address are never repeated. `12 Smith St,
 * Parramatta NSW 2150` must not become
 * `12 Smith St, Parramatta NSW 2150, Parramatta, NSW, 2150, Australia` —
 * that is a worse query than the original, not a better one, and the suburb
 * reports already arrive pre-composed (`Postcode 2150, NSW, Australia`) from
 * the generator's own formatter.
 *
 * `Australia` is appended for the same reason the country filter is set: it
 * costs nothing when the filter already binds, and it is the difference
 * between a question with one answer and a question with six.
 *
 * Returns an empty string when there is nothing to ask — the caller must
 * treat that as unresolvable rather than sending `Australia` on its own and
 * geocoding the centre of the continent.
 */
export function buildAuGeocodeQuery(parts: AuAddressParts): string {
  const address = (parts.address ?? '').trim();
  const out: string[] = [];
  if (address) out.push(address);

  // Everything appended is checked against everything already accumulated,
  // not against the address alone — `suburb: 'Parramatta', state: 'NSW'` on
  // an address of `Parramatta` must add the state once and the suburb never.
  const seen = () => tokenBand(out.join(' '));

  const append = (value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return;
    if (seen().includes(tokenBand(trimmed))) return;
    out.push(trimmed);
  };

  append(parts.suburb);
  append(parts.state);
  append(parts.postcode);

  // Nothing to ask. An address-less request must fail, not resolve to the
  // country's centroid.
  if (out.length === 0) return '';

  append('Australia');
  return out.join(', ');
}
