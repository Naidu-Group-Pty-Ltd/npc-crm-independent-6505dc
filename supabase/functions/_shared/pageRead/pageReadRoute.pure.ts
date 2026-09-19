/**
 * How this deployment reads a listing PAGE, and why a clone holds no key for it.
 *
 * ## The defect this exists for
 *
 * `scrape-property-listing` reads the listing page through Firecrawl, and
 * where that returns nothing it asks the model to FIND the listing by web
 * search instead. The 19 Sep 2026 clone audit reported the consequence: a
 * 13 Silky Oak Court URL answered with 10 Railway Avenue at $725,000.
 *
 * `FIRECRAWL_API_KEY` is an Integrations-page credential no clone is
 * provisioned with, so on a clone the page is NEVER read and every scrape is
 * that fallback. And the keyless fallback cannot stand in for it: measured
 * from the production egress on 19 Sep 2026, `r.jina.ai` returns **HTTP 200
 * carrying an "Access Denied" body** for both realestate.com.au and
 * domain.com.au — both portals WAF-block it. `isBadScrapeContent` correctly
 * rejects that, so the clone falls through to the model every time. There is
 * no free path to these pages.
 *
 * ## So the credential stops travelling and the CALL travels
 *
 * The same answer `AIRTABLE_TOKEN` and the Didit application key already
 * reached, for the same reason and with the same shape: Mission Control holds
 * the one key and performs the read on a tenant's behalf, authenticated by the
 * Mission Control key the clone already has. The prime holds the credential
 * and still calls Firecrawl directly.
 *
 * Handing every clone its own Firecrawl key would be the alternative, and it
 * is worse on every axis: a key per tenant to mint, rotate and revoke; a
 * spend-bearing credential sitting on tenant projects; and a clone provisioned
 * tomorrow still starting with no page-read capability at all.
 *
 * ## The rules
 *
 * **The direct route requires the vendor key and nothing else decides it.** A
 * deployment holding `FIRECRAWL_API_KEY` is one entitled to spend it.
 *
 * **A brokered read is NOT metered here.** Mission Control writes the usage
 * row because Mission Control made the vendor call. Both ends billing is worse
 * than neither — this platform's own rule.
 *
 * **The broker re-asserts the host allow-list; it does not trust its caller.**
 * A brokered page read is a request to fetch a URL somebody else named, which
 * is an SSRF surface and a way to spend the prime's credits on anything at
 * all. `PROPERTY_LISTING_HOSTS` is the one list, exported here so the clone's
 * `urlPolicy.ts` and Mission Control's handler enforce the identical rule
 * rather than two that drift. It is deliberately the narrow eight-portal list
 * and not `listingUrlPolicy.pure.ts`'s permissive one: that module's own
 * header says widening the hosts widens what can be billed.
 *
 * **No route is a supported state, not a failure.** A deployment with neither
 * the key nor Mission Control behaves exactly as it does today — the reader
 * fallback, then the model, under the provenance warning the surface already
 * draws. Nothing regresses; what changes is that a clone with Mission Control
 * stops needing a credential.
 *
 * Pure + deterministic + JSON-safe: no Deno, no network, no clocks.
 */

/**
 * The portals a page read may target.
 *
 * The single source for both the clone-side normaliser and the broker's own
 * check. Adding a host here widens what the prime's Firecrawl credits can be
 * spent on, by any tenant, so it is a deliberate act and not a convenience.
 */
export const PROPERTY_LISTING_HOSTS = [
  'allhomes.com.au',
  'commercialrealestate.com.au',
  'domain.com.au',
  'onthehouse.com.au',
  'property.com.au',
  'realcommercial.com.au',
  'realestate.com.au',
  'view.com.au',
] as const;

export function isPropertyListingHost(hostname: string): boolean {
  const normalised = hostname.toLowerCase().replace(/\.$/, '');
  return PROPERTY_LISTING_HOSTS.some(
    (host) => normalised === host || normalised.endsWith(`.${host}`),
  );
}

/**
 * Why this URL may not be read, or null when it may.
 *
 * Returns a reason rather than throwing so the broker can answer with it, and
 * refuses rather than repairing: a URL the caller did not mean is not one to
 * guess at when the guess is billable.
 */
export function refusePageReadUrl(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return 'no URL was given';
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return 'a page read must use HTTPS';
  if (url.username || url.password) return 'a page read URL may carry no credentials';
  if (url.port) return 'a page read URL may name no port';
  if (!isPropertyListingHost(url.hostname)) return 'unsupported property listing host';
  return null;
}

export type PageReadRoute =
  | {
      via: 'direct';
      /** The credential to redact from any error text on this route. */
      secret: string;
      headers: Record<string, string>;
      /** A direct read spends the vendor key here, so it is metered here. */
      meter: true;
    }
  | {
      via: 'broker';
      /** Mission Control's ORIGIN. Any path the setting carried is trimmed. */
      missionControlUrl: string;
      /** What was trimmed, so a failure can SAY it rather than repair silently. */
      trimmedPath?: string;
      headers: Record<string, string>;
      secret: string;
      /** Mission Control meters the vendor call it makes. Never both. */
      meter: false;
    }
  | { via: 'none'; why: string };

/** The path Mission Control serves a brokered page read on. Named once. */
export const BROKERED_PAGE_READ_PATH = '/api/public/page/read';

/**
 * Read a Mission Control base as an ORIGIN, reporting any path it carried.
 *
 * Every path composed here is rooted, so a base carrying its own path composes
 * a URL nobody serves — the exact fault the Airtable broker hit in production,
 * where `…/api` produced `…/api/api/public/listings/tables` and a 404 that
 * looked like the vendor's.
 */
export function pageReadOrigin(raw: string): { origin: string; trimmedPath?: string } {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return { origin: '' };
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, '');
    return path ? { origin: u.origin, trimmedPath: path } : { origin: u.origin };
  } catch {
    return { origin: trimmed };
  }
}

export function resolvePageReadRoute(input: {
  firecrawlKey: string | null | undefined;
  missionControlUrl: string | null | undefined;
  cloneApiKey: string | null | undefined;
}): PageReadRoute {
  const key = (input.firecrawlKey ?? '').trim();
  if (key) {
    return {
      via: 'direct',
      secret: key,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      meter: true,
    };
  }

  const mc = pageReadOrigin(input.missionControlUrl ?? '');
  const cloneKey = (input.cloneApiKey ?? '').trim();
  if (!mc.origin || !cloneKey) {
    return {
      via: 'none',
      why:
        'this deployment holds no FIRECRAWL_API_KEY and cannot reach Mission Control '
        + '(MISSION_CONTROL_URL and MISSION_CONTROL_CLONE_API_KEY), so a listing page '
        + 'cannot be read directly',
    };
  }

  return {
    via: 'broker',
    missionControlUrl: mc.origin,
    ...(mc.trimmedPath ? { trimmedPath: mc.trimmedPath } : {}),
    headers: { 'Content-Type': 'application/json', 'x-clone-api-key': cloneKey },
    secret: cloneKey,
    meter: false,
  };
}

/** Where a brokered read is sent. Composed only from a resolved origin. */
export function brokeredPageReadUrl(route: Extract<PageReadRoute, { via: 'broker' }>): string {
  return `${route.missionControlUrl}${BROKERED_PAGE_READ_PATH}`;
}
