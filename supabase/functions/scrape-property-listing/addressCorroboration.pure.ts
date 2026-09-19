/**
 * Does the address the model returned belong to the URL that was asked about?
 *
 * ## The defect this exists for
 *
 * The scraper reads the listing page through Firecrawl, and where that returns
 * nothing it asks the model to FIND the listing by web search instead. That
 * fallback's prompt says "If the exact listing is not found, return nulls
 * rather than using generic commercial real estate pages" — and a prohibition
 * with no demonstration of the permitted form is one a model routes around, so
 * what comes back for a listing it cannot reach is a plausible property rather
 * than an absence. The 19 Sep 2026 clone audit reported it precisely: a
 * 13 Silky Oak Court URL answered with 10 Railway Avenue at $725,000.
 *
 * It is clone-shaped because `FIRECRAWL_API_KEY` is an Integrations-page
 * credential no clone is provisioned with, so on a clone the page is never
 * read and EVERY scrape is that fallback.
 *
 * ## The rules
 *
 * **Only a scrape that did not read the page is judged.** Where the page was
 * read, the page is the authority and a URL slug is a weaker signal that could
 * only make a right answer look wrong.
 *
 * **A slug that names nothing is evidence of nothing.** Most listing URLs are
 * an id and a site's own furniture; `no_signal` is a distinct verdict from
 * `contradicted`, and it is by far the commonest one.
 *
 * **It takes at least two distinctive tokens to contradict, and any one of
 * them to corroborate.** The asymmetry is deliberate: a false `contradicted`
 * refuses a scrape that worked, which is a regression, while a missed one
 * leaves the operator exactly where the provenance warning already puts them.
 * "13 Silky Oak Court Kirwan" against "13 Silky Oak Ct, Kirwan QLD" shares
 * four; "13 Silky Oak Court Kirwan" against "10 Railway Avenue, Cardiff"
 * shares none.
 *
 * Pure + deterministic + JSON-safe: no DOM, network, secrets or clocks.
 */

export type AddressCorroboration = 'corroborated' | 'contradicted' | 'no_signal';

/**
 * Words a listing URL carries about the SITE rather than the property.
 *
 * State codes and property types are in almost every slug and would corroborate
 * any Australian address at all, so they earn no vote either way.
 */
const NON_DISTINCTIVE = new Set([
  'property', 'properties', 'real', 'estate', 'realestate', 'listing', 'listings',
  'for', 'sale', 'sold', 'rent', 'rental', 'lease', 'leased', 'buy', 'new', 'homes',
  'home', 'house', 'apartment', 'unit', 'units', 'townhouse', 'villa', 'land',
  'residential', 'commercial', 'industrial', 'office', 'retail', 'warehouse',
  'project', 'profile', 'details', 'view', 'au', 'com', 'www', 'the', 'and', 'of',
  'nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'nt', 'act', 'australia',
  'st', 'rd', 'ave', 'street', 'road', 'avenue', 'court', 'ct', 'drive', 'dr',
  'place', 'pl', 'lane', 'way', 'crescent', 'cres', 'close', 'terrace', 'parade',
]);

function tokenise(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * The tokens in a URL's own address hint that could identify a property.
 *
 * A street TYPE is excluded above, because "court" appears in the slug of
 * every listing on a court; the street NAME and the number are what carry.
 * A bare id is excluded too — a run of seven or more digits is the site's
 * listing id, not a street number.
 */
export function distinctiveHintTokens(addressHint: string | null | undefined): string[] {
  if (!addressHint) return [];
  const seen = new Set<string>();
  for (const token of tokenise(addressHint)) {
    if (NON_DISTINCTIVE.has(token)) continue;
    if (/^\d{7,}$/.test(token)) continue;
    // A one- or two-letter leftover carries nothing.
    if (token.length < 3 && !/^\d+$/.test(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

export interface CorroborationInput {
  /** The URL's own address hint, from `deriveListingHints`. */
  addressHint: string | null | undefined;
  /** Whether the listing page itself was read. */
  scrapedFromPage: boolean;
  /** What the extraction says this property is: address, suburb, title. */
  extractedParts: Array<string | null | undefined>;
}

export interface CorroborationResult {
  verdict: AddressCorroboration;
  /** The hint tokens that were looked for. */
  hintTokens: string[];
  /** Those of them the extraction carries. */
  matched: string[];
}

export function corroborateAddress(input: CorroborationInput): CorroborationResult {
  const hintTokens = distinctiveHintTokens(input.addressHint);
  const empty = { hintTokens, matched: [] as string[] };

  // The page is the authority where it was read.
  if (input.scrapedFromPage) return { verdict: 'no_signal', ...empty };

  const haystack = new Set(
    input.extractedParts
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .flatMap(tokenise),
  );
  if (haystack.size === 0) return { verdict: 'no_signal', ...empty };

  const matched = hintTokens.filter((token) => haystack.has(token));
  if (matched.length > 0) return { verdict: 'corroborated', hintTokens, matched };
  // Two is the floor for a refusal; one token that happens not to appear is
  // not enough to throw away an extraction.
  if (hintTokens.length >= 2) return { verdict: 'contradicted', hintTokens, matched };
  return { verdict: 'no_signal', hintTokens, matched };
}

/**
 * What to record on a job the URL contradicts.
 *
 * It names the two addresses, because an operator asked to trust a refusal
 * needs to see what was compared — and because "the scrape failed" over a
 * model that confidently answered is the shape that made this invisible.
 */
export function contradictionMessage(
  urlAddressHint: string | null | undefined,
  extractedAddress: string | null | undefined,
): string {
  const found = extractedAddress?.trim() || 'a property it did not name';
  const asked = urlAddressHint?.trim() || 'the address in the link';
  return (
    `The listing page could not be read, and the property found by searching `
    + `("${found}") does not match the address in the link ("${asked}"), so it is `
    + `a different property. Nothing has been filled in. Add a Firecrawl API key `
    + `on the Integrations page to read listing pages directly, or enter the `
    + `property's details by hand.`
  );
}
