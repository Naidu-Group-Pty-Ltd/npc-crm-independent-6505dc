/**
 * Pure core of the listing enrichment pipeline.
 *
 * The upstream extractor runs one stage — read the email body, ask a model for
 * structured fields, write them to Airtable — and stops. Every later stage it
 * was designed with is switched off: `Web Scrape Status` reads "Not Required" on
 * every record, `Enrichment Status` reads "Not Started", `Processing Stage`
 * never advances past "AI Parsed". The consequences are visible in the data:
 * zero images and zero coordinates across all 1,441 records, no beds/baths on a
 * third of them, no agent on 60%.
 *
 * That pipeline lives in a Make.com account this workspace cannot see, so it
 * cannot be fixed here. What can be done is finish the job downstream, and the
 * cheapest place to start is the text the extractor already captured and then
 * ignored: `Raw Source Snippet` is populated on 1,440 of 1,441 records and
 * routinely contains facts that never reached their own columns. One sampled
 * snippet reads "4 2 2 ... From $1,599,000 ... Land size 801sqm ... Building
 * size 318sqm" against a record with no beds, no baths, no price and no land
 * size.
 *
 * Everything here is deterministic and offline so the extraction rules can be
 * tested against real snippets without a network or a model.
 */

/** Where a value came from. Ordered by how much it should be trusted. */
export type EnrichmentSource = 'airtable' | 'mined' | 'scraped' | 'geocoded' | 'llm';

export interface FieldProvenance {
  src: EnrichmentSource;
  /** 0–1. Regex on structured text scores high; a loose prose match scores low. */
  conf: number;
  /** ISO timestamp. */
  at: string;
  /** A short excerpt or URL showing where it came from, for the provenance panel. */
  ev?: string;
}

export interface MinedFacts {
  beds?: number;
  baths?: number;
  carSpaces?: number;
  landSizeSqm?: number;
  buildingAreaSqm?: number;
  priceDisplay?: string;
  priceNumeric?: number;
  agentMobile?: string;
  agentEmail?: string;
  imageUrls?: string[];
  listingUrls?: string[];
}

export interface MinedResult {
  facts: MinedFacts;
  provenance: Record<string, FieldProvenance>;
}

/* -------------------------------------------------------------------------- */
/* Image URLs                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hosts that serve property photos from a CDN path with no file extension.
 *
 * A plain `\.(jpe?g|png|webp)` pattern misses these entirely, and they are the
 * agency CRMs this mailbox actually receives — AgentBox, VaultRE, Rex, Console.
 */
const MEDIA_HOST_HINTS = [
  'agentboxcdn.com.au',
  'agentbox',
  'vaultre',
  'rexsoftware',
  'reasoftware',
  'domainstatic',
  'staticdomain',
  'rea-media',
  'realestate.com.au/blob',
  'campaigntrack',
  'consolecloud',
  'propertytree',
  'listingimages',
  'cloudfront.net',
  'imgix.net',
  'cloudinary.com',
];

/**
 * Path fragments that mark an image as chrome rather than the property.
 *
 * Marketing email bodies are mostly furniture: the agency's logo, the agent's
 * headshot, social icons, an open-tracking pixel. Harvesting those would fill
 * the library with the same twelve pictures and put a letterhead on the card
 * where the house should be.
 */
const BOILERPLATE_HINTS = [
  'logo',
  'signature',
  'sig-',
  'spacer',
  'pixel',
  'tracking',
  'open.gif',
  '1x1',
  'facebook',
  'twitter',
  'instagram',
  'linkedin',
  'youtube',
  'icon',
  'avatar',
  'headshot',
  'profile',
  'banner',
  'footer',
  'header',
  'button',
  'arrow',
  'divider',
  '/emails/',
  'unsubscribe',
];

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif|gif)(?:$|[?#])/i;

/** True when a URL looks like an image we would want to keep. */
export function looksLikePropertyImage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  const haystack = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  if (BOILERPLATE_HINTS.some((hint) => haystack.includes(hint))) return false;

  if (IMAGE_EXTENSION.test(parsed.pathname)) return true;
  return MEDIA_HOST_HINTS.some((hint) => haystack.includes(hint));
}

/**
 * Pulls candidate image URLs out of free text or HTML.
 *
 * Deliberately generous about what it matches and strict about what it keeps:
 * the cost of a false positive is one wasted fetch that the harvester rejects on
 * content type or size, while a false negative is a listing that stays blank.
 */
export function extractImageUrls(text: string | null | undefined, limit = 24): string[] {
  if (!text) return [];
  const found = new Set<string>();

  // `src="…"` and `srcset` first — in HTML these are unambiguous.
  for (const match of text.matchAll(/(?:src|data-src|content)\s*=\s*["']([^"']+)["']/gi)) {
    const url = match[1].trim();
    if (looksLikePropertyImage(url)) found.add(url);
  }
  // Then bare URLs in prose. Trailing punctuation is stripped because a URL at
  // the end of a sentence collects the full stop.
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>()\[\]]+/gi)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    if (looksLikePropertyImage(url)) found.add(url);
  }

  return Array.from(found).slice(0, limit);
}

/** Non-image links that might be the listing page itself. */
export function extractListingUrls(text: string | null | undefined, limit = 8): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>()\[\]]+/gi)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    if (looksLikePropertyImage(url)) continue;
    if (/unsubscribe|mailto:|\.(?:css|js|ico)$/i.test(url)) continue;
    found.add(url);
  }
  return Array.from(found).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

function firstNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function plausibleRoomCount(n: number | undefined): number | undefined {
  return n !== undefined && n >= 0 && n <= 20 ? n : undefined;
}

/**
 * Bedrooms, bathrooms and car spaces.
 *
 * Two shapes appear in these emails. The explicit one — "4 bed, 2 bath, 2 car" —
 * is unambiguous. The other is the bare triple agents paste from their CRM:
 * a line reading only "4 2 2". That is worth reading, but only as a whole line
 * of exactly three small numbers; matching loose digits anywhere in prose would
 * turn "Unit 3 of 12" into a bedroom count.
 */
export function mineSpecs(text: string): Pick<MinedFacts, 'beds' | 'baths' | 'carSpaces'> & {
  confidence: number;
} {
  const lower = text.toLowerCase();

  const labelled = (words: string[]): number | undefined => {
    for (const word of words) {
      const match = lower.match(new RegExp(`(\\d{1,2})\\s*(?:x\\s*)?${word}`, 'i'));
      const n = plausibleRoomCount(firstNumber(match?.[1]));
      if (n !== undefined) return n;
    }
    return undefined;
  };

  const beds = labelled(['bed(?:room)?s?\\b']);
  const baths = labelled(['bath(?:room)?s?\\b']);
  const carSpaces = labelled(['car\\s*(?:space|park|bay)?s?\\b', 'garages?\\b']);

  if (beds !== undefined || baths !== undefined || carSpaces !== undefined) {
    return { beds, baths, carSpaces, confidence: 0.85 };
  }

  // The bare triple, on a line of its own.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const triple = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})$/);
    if (!triple) continue;
    const [b, ba, c] = [triple[1], triple[2], triple[3]].map((v) => plausibleRoomCount(Number(v)));
    if (b === undefined || ba === undefined || c === undefined) continue;
    // A line of three numbers is a convention, not a statement, so it is trusted
    // less than an explicitly labelled count.
    return { beds: b, baths: ba, carSpaces: c, confidence: 0.6 };
  }

  return { beds: undefined, baths: undefined, carSpaces: undefined, confidence: 0 };
}

/** Land or building area in square metres. */
export function mineArea(text: string, kind: 'land' | 'building'): number | undefined {
  const label = kind === 'land' ? 'land(?:\\s*size|\\s*area)?' : 'building|floor|house|home';
  const pattern = new RegExp(
    `(?:${label})[^\\d]{0,20}(\\d[\\d,\\.]*)\\s*(sqm|m2|m²|square\\s*met(?:re|er)s?|ha|hectares?|acres?)`,
    'i',
  );
  const match = text.match(pattern);
  if (!match) return undefined;
  const amount = firstNumber(match[1]);
  if (amount === undefined || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  if (/^h/.test(unit)) return Math.round(amount * 10_000);
  if (/^ac/.test(unit)) return Math.round(amount * 4046.86);
  return Math.round(amount);
}

/**
 * A price as an agent wrote it.
 *
 * Returns the display string as well as a number, because "From $1,599,000"
 * and "Offers above $850,000" carry a qualifier the number alone discards.
 */
export function minePrice(text: string): { display?: string; amount?: number; confidence: number } {
  const qualified = text.match(
    /((?:from|offers?\s+(?:above|over|from)|guide|price guide|starting(?:\s+from)?|expressions?[^$\n]{0,20})\s*\$\s?[\d,]+(?:\.\d+)?\s*(?:k|m|million)?)/i,
  );
  if (qualified) {
    const amount = parseAudAmount(qualified[1]);
    return { display: qualified[1].trim().replace(/\s+/g, ' '), amount, confidence: 0.8 };
  }

  const range = text.match(/\$\s?[\d,]+(?:\.\d+)?\s*(?:k|m)?\s*(?:-|–|to)\s*\$?\s?[\d,]+(?:\.\d+)?\s*(?:k|m)?/i);
  if (range) {
    return { display: range[0].trim().replace(/\s+/g, ' '), confidence: 0.75 };
  }

  const plain = text.match(/\$\s?([\d,]{4,})(?:\.\d+)?/);
  if (plain) {
    const amount = parseAudAmount(plain[0]);
    // A bare dollar figure in prose could be a rent, a deposit or a rebate, so
    // it is offered with low confidence and the merge decides.
    if (amount !== undefined && amount >= 50_000) {
      return { display: plain[0].trim(), amount, confidence: 0.5 };
    }
  }

  return { confidence: 0 };
}

/** "$1.59m", "$850k", "$1,599,000" → a number. */
export function parseAudAmount(text: string): number | undefined {
  const match = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|million)?/i);
  if (!match) return undefined;
  let amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return undefined;
  const suffix = (match[2] ?? '').toLowerCase();
  if (suffix === 'k') amount *= 1_000;
  else if (suffix === 'm' || suffix === 'million') amount *= 1_000_000;
  return amount > 0 && amount < 50_000_000 ? amount : undefined;
}

/** An Australian mobile number, normalised. */
export function mineMobile(text: string): string | undefined {
  const match = text.match(/\b(?:\+?61\s?|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/);
  if (!match) return undefined;
  const digits = match[0].replace(/[^\d]/g, '').replace(/^61/, '0');
  return digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : undefined;
}

export function mineEmail(text: string): string | undefined {
  const match = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (!match) return undefined;
  const email = match[0].toLowerCase();
  // Not a real contact for the property.
  if (/(noreply|no-reply|donotreply|unsubscribe|bounce|mailer)/.test(email)) return undefined;
  return email;
}

/**
 * Mines everything obtainable from a record's own text.
 *
 * Only fields the record is actually missing are worth mining, so the caller
 * passes what it already has; a mined value never competes with an extracted
 * one. This runs over text the pipeline already stored, so it costs nothing but
 * CPU and is always the first stage tried.
 */
export function mineFromText(
  sources: Array<string | null | undefined>,
  missing: ReadonlySet<string>,
  at: string,
): MinedResult {
  const text = sources.filter(Boolean).join('\n\n');
  const facts: MinedFacts = {};
  const provenance: Record<string, FieldProvenance> = {};
  if (!text.trim()) return { facts, provenance };

  const note = (field: string, conf: number, ev?: string) => {
    provenance[field] = { src: 'mined', conf, at, ev: ev?.slice(0, 200) };
  };

  if (missing.has('beds') || missing.has('baths') || missing.has('carSpaces')) {
    const specs = mineSpecs(text);
    if (specs.beds !== undefined && missing.has('beds')) {
      facts.beds = specs.beds;
      note('beds', specs.confidence);
    }
    if (specs.baths !== undefined && missing.has('baths')) {
      facts.baths = specs.baths;
      note('baths', specs.confidence);
    }
    if (specs.carSpaces !== undefined && missing.has('carSpaces')) {
      facts.carSpaces = specs.carSpaces;
      note('carSpaces', specs.confidence);
    }
  }

  if (missing.has('landSizeSqm')) {
    const land = mineArea(text, 'land');
    if (land !== undefined) {
      facts.landSizeSqm = land;
      note('landSizeSqm', 0.8);
    }
  }

  if (missing.has('buildingAreaSqm')) {
    const building = mineArea(text, 'building');
    if (building !== undefined) {
      facts.buildingAreaSqm = building;
      note('buildingAreaSqm', 0.75);
    }
  }

  if (missing.has('priceDisplay') || missing.has('price')) {
    const price = minePrice(text);
    if (price.display && missing.has('priceDisplay')) {
      facts.priceDisplay = price.display;
      note('priceDisplay', price.confidence, price.display);
    }
    if (price.amount !== undefined && missing.has('price')) {
      facts.priceNumeric = price.amount;
      note('priceNumeric', price.confidence, price.display);
    }
  }

  if (missing.has('agentMobile')) {
    const mobile = mineMobile(text);
    if (mobile) {
      facts.agentMobile = mobile;
      note('agentMobile', 0.7);
    }
  }

  if (missing.has('agentEmail')) {
    const email = mineEmail(text);
    if (email) {
      facts.agentEmail = email;
      note('agentEmail', 0.7);
    }
  }

  const images = extractImageUrls(text);
  if (images.length > 0) {
    facts.imageUrls = images;
    note('imageUrls', 0.6, images[0]);
  }

  const links = extractListingUrls(text);
  if (links.length > 0) facts.listingUrls = links;

  return { facts, provenance };
}

/* -------------------------------------------------------------------------- */
/* Prioritisation                                                              */
/* -------------------------------------------------------------------------- */

/** Fields the enrichment pass knows how to fill, weighted by what they cost us. */
const GAP_WEIGHTS: Record<string, number> = {
  images: 40,
  price: 20,
  address: 15,
  coordinates: 10,
  agentContact: 10,
  specs: 5,
};

export interface GapInput {
  hasImages: boolean;
  hasPrice: boolean;
  hasAddress: boolean;
  hasCoordinates: boolean;
  hasAgentContact: boolean;
  hasSpecs: boolean;
}

/** How much this listing stands to gain. Higher is worked first. */
export function enrichmentGap(input: GapInput): number {
  let gap = 0;
  if (!input.hasImages) gap += GAP_WEIGHTS.images;
  if (!input.hasPrice) gap += GAP_WEIGHTS.price;
  if (!input.hasAddress) gap += GAP_WEIGHTS.address;
  if (!input.hasCoordinates) gap += GAP_WEIGHTS.coordinates;
  if (!input.hasAgentContact) gap += GAP_WEIGHTS.agentContact;
  if (!input.hasSpecs) gap += GAP_WEIGHTS.specs;
  return gap;
}

/**
 * Priority, which is the gap discounted by how soon the record disappears.
 *
 * Airtable prunes this table 30 days after a record's Created Time and the cache
 * mirrors that, so effort spent on a 29-day-old listing buys a day of benefit.
 * A record with a large gap and a month of life left is worth more than one with
 * the same gap that is about to vanish.
 */
export function enrichmentPriority(gap: number, ageDays: number, retentionDays = 30): number {
  const remaining = Math.max(0, retentionDays - Math.max(0, ageDays));
  const freshness = remaining / retentionDays;
  return Math.round(gap * (0.25 + 0.75 * freshness));
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Fields the overlay is allowed to *replace* rather than merely fill.
 *
 * Deliberately tiny. Airtable is what humans read and edit, so the overlay's job
 * is to fill holes, not to argue. The exception is the locality pair, which is
 * demonstrably contaminated by batch carry-over — and even then only when the
 * record's own values failed to reconcile against each other, which is the exact
 * condition under which they are known to be wrong.
 *
 * `address` and `suburb` are deliberately absent. A wrong address propagates
 * into dedup, geocoding, reports and generated PDFs, and there is no undo.
 */
export const OVERRIDABLE_FIELDS: ReadonlySet<string> = new Set([
  'postcode',
  'state',
  'latitude',
  'longitude',
]);

export interface MergeInput {
  /** Whether the Airtable record already has a usable value for the field. */
  airtableHas: (field: string) => boolean;
  /** True when the record's own locality failed reconciliation. */
  localityDisputed?: boolean;
}

/**
 * Whether an enriched value may be written for a field.
 *
 * The rule that matters: a stage which found nothing must never blank a field
 * that already had something. Enrichment only ever adds.
 */
export function mayApply(
  field: string,
  value: unknown,
  { airtableHas, localityDisputed = false }: MergeInput,
): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (!airtableHas(field)) return true;
  if (!OVERRIDABLE_FIELDS.has(field)) return false;
  return localityDisputed;
}

/**
 * Folds a stage's output into what the overlay already holds.
 *
 * Later stages are more expensive and better informed, so they win ties — but
 * only on fields they actually returned. A stage that failed leaves everything
 * it did not mention untouched, which is what stops a transient scrape error
 * from erasing a good mined value.
 */
export function mergeEnrichment(
  prior: Record<string, unknown>,
  priorProvenance: Record<string, FieldProvenance>,
  incoming: Record<string, unknown>,
  incomingProvenance: Record<string, FieldProvenance>,
): { values: Record<string, unknown>; provenance: Record<string, FieldProvenance> } {
  const values = { ...prior };
  const provenance = { ...priorProvenance };

  for (const [field, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === '') continue;
    const next = incomingProvenance[field];
    const held = provenance[field];
    // Keep the more confident claim; a tie goes to the newer stage.
    if (held && next && next.conf < held.conf) continue;
    values[field] = value;
    if (next) provenance[field] = next;
  }

  return { values, provenance };
}
