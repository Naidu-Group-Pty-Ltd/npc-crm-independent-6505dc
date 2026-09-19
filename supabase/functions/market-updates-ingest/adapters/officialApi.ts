// Federal Register of Legislation — OData adapter.
//
// The Register publishes an unauthenticated OData v4 API at
// api.prod.legislation.gov.au. It is the primary legal source for Commonwealth
// instruments, so it is the one source in the registry that cannot be served by
// RSS or an HTML listing and previously had no adapter at all.
//
// Two OData quirks drive the shape of this adapter, both verified against the
// live service on 2026-08-01:
//
//   * `$orderby=makingDate desc` works, and `$filter=contains(name,'…')` works,
//     but combining `$orderby` with `$filter` returns an error, and a `$filter`
//     on makingDate silently returns zero rows. So the request asks only for the
//     most recently made titles and every subject-matter filter is applied here.
//   * The API returns registry metadata, not article text. The excerpt is
//     therefore composed from the returned fields rather than extracted from a
//     document, which is exactly the metadata-only posture the registry records
//     for this source.

import type {
  MarketSourceAdapter,
  NormalisedSourceBatch,
  NormalisedSourceItem,
  SourceConfig,
  SourceValidationResult,
} from './types.ts';
import { boundedFetch, normaliseUrl, sourceDomains } from './security.ts';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Aurixa-Market-Intelligence/2.0';
const ua = () => {
  const configured = Deno.env.get('MARKET_UPDATES_USER_AGENT');
  return configured && configured.trim().length ? configured : DEFAULT_UA;
};

const itemCap = () => Number(Deno.env.get('MARKET_UPDATES_MAX_ITEMS_PER_SOURCE') || 40);

// How many rows to ask for before subject-matter filtering. The service rejects
// `$top` above 100 outright ("The limit of '100' for Top query has been
// exceeded"), so the ceiling is the service's, not a guess — asking for more
// fails the whole fetch rather than being silently truncated.
const DEFAULT_FETCH_LIMIT = 100;
const MAX_FETCH_LIMIT = 100;

/** Public document URL for a register title, e.g. F2026L01007. */
const PUBLIC_BASE = 'https://www.legislation.gov.au';

/** Register IDs are strictly [CF]<year><letter><digits>; anything else is not linkable. */
const TITLE_ID = /^[A-Z]\d{4}[A-Z]\d{5}$/;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function readStringList(config: Record<string, unknown>, key: string): string[] {
  const raw = config[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => asString(entry).toLowerCase()).filter(Boolean);
}

function fetchLimit(config: Record<string, unknown>): number {
  const configured = Number(config.fetch_limit);
  if (!Number.isFinite(configured)) return DEFAULT_FETCH_LIMIT;
  return Math.max(1, Math.min(MAX_FETCH_LIMIT, Math.trunc(configured)));
}

/**
 * Registry metadata rendered as a short human-readable line. This is the whole
 * excerpt for the source — the API exposes no abstract, and the classifier is
 * told elsewhere never to invent one.
 */
function describe(record: Record<string, unknown>): string {
  const parts = [
    asString(record.collection) && `Collection: ${asString(record.collection)}`,
    asString(record.subCollection) && `Sub-collection: ${asString(record.subCollection)}`,
    asString(record.status) && `Status: ${asString(record.status)}`,
    record.isPrincipal === true ? 'Principal instrument' : '',
    asString(record.makingDate) && `Made: ${asString(record.makingDate).slice(0, 10)}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export class FederalLegislationApiAdapter implements MarketSourceAdapter {
  async read(source: SourceConfig): Promise<NormalisedSourceBatch> {
    const config = source.adapter_config ?? {};
    const allowed = sourceDomains(source);
    const base = (source.primary_url ?? '').replace(/\/+$/, '');
    if (!base) throw new Error('Federal Register API base URL is not configured');

    const resource = asString(config.resource) || 'Titles';
    if (!/^[A-Za-z]+$/.test(resource)) throw new Error('Federal Register API resource is not a bare entity set name');

    // `$orderby` and `$filter` cannot be combined on this service, so the request
    // carries ordering only and the keyword screen runs client-side below.
    const query = new URLSearchParams({
      '$top': String(fetchLimit(config)),
      '$orderby': `${asString(config.order_by) || 'makingDate'} desc`,
    });
    const endpoint = `${base}/${resource}?${query.toString()}`;

    const { response, body, latency } = await boundedFetch(endpoint, allowed, {
      headers: {
        accept: 'application/json;odata.metadata=minimal, application/json;q=0.9',
        'accept-language': 'en-AU,en;q=0.9',
        'user-agent': ua(),
      },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('Federal Register API returned a non-JSON response');
    }
    const records = (parsed as { value?: unknown })?.value;
    if (!Array.isArray(records)) throw new Error('Federal Register API response contained no value collection');

    // The Register publishes every Commonwealth instrument — pharmaceutical
    // listings, defence determinations and so on. Without a subject-matter screen
    // the feed would be almost entirely out of scope, so an empty keyword list is
    // treated as a misconfiguration rather than "accept everything".
    const includeKeywords = readStringList(config, 'include_keywords');
    if (!includeKeywords.length) {
      throw new Error('Federal Register adapter requires adapter_config.include_keywords');
    }
    const excludeKeywords = readStringList(config, 'exclude_keywords');
    const collections = readStringList(config, 'collections');

    const items: NormalisedSourceItem[] = [];
    for (const entry of records) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;

      const id = asString(record.id);
      const title = asString(record.name);
      if (!TITLE_ID.test(id) || !title) continue;

      const collection = asString(record.collection).toLowerCase();
      if (collections.length && !collections.includes(collection)) continue;

      const haystack = title.toLowerCase();
      if (!includeKeywords.some((keyword) => haystack.includes(keyword))) continue;
      if (excludeKeywords.some((keyword) => haystack.includes(keyword))) continue;

      const madeAt = asString(record.makingDate);
      const publishedAt = madeAt && !Number.isNaN(Date.parse(madeAt))
        ? new Date(madeAt).toISOString()
        : null;

      // Routed through normaliseUrl so the public document host is subject to the
      // same allow-list as every other fetched URL in the pipeline.
      const canonicalUrl = normaliseUrl(`${PUBLIC_BASE}/${id}`, PUBLIC_BASE, allowed);

      items.push({
        externalId: id,
        title,
        canonicalUrl,
        originalUrl: canonicalUrl,
        publishedAt,
        excerpt: describe(record) || null,
        author: null,
        category: asString(record.collection) || null,
      });

      if (items.length >= itemCap()) break;
    }

    if (!items.length) throw new Error('Federal Register API returned no in-scope instruments');

    return {
      items,
      validation: {
        valid: true,
        format: 'odata_json',
        itemCount: items.length,
        endpoint,
        httpStatus: response.status,
        latencyMs: latency,
      },
    };
  }

  async validate(source: SourceConfig): Promise<SourceValidationResult> {
    try {
      return (await this.read(source)).validation;
    } catch (error) {
      return {
        valid: false,
        format: 'odata_json',
        itemCount: 0,
        safeError: String((error as Error).message).slice(0, 240),
      };
    }
  }

  async fetch(source: SourceConfig): Promise<NormalisedSourceBatch> {
    return this.read(source);
  }
}
