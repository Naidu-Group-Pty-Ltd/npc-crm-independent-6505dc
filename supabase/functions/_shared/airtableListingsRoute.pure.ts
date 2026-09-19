/**
 * Where a Listings & Overview Airtable read goes, and what it carries.
 *
 * ## Why a deployment might not hold the token at all
 *
 * The Listings and Overview pages are built from one table — `Property Intake
 * Master` in the `NPC Emails` base — and every clone shows the SAME
 * marketplace, so every clone needs the same token and the same base id. The
 * fleet-wide answer was to forward all six `AIRTABLE_*` names to every clone.
 *
 * An Airtable personal access token carries its whole scope: a set of BASES
 * and a set of PERMISSIONS, fixed when it was minted. Nothing in the
 * credential narrows it to one table. So a forwarded token on a tenant's
 * Supabase project reaches every base its scope admits — and if that scope
 * includes `data.records:write`, it can rewrite the shared intake table every
 * other clone reads. Airtable has no per-tenant sub-credential to mint.
 *
 * The credential therefore stops travelling and the CALL travels instead:
 * Mission Control holds the one token and the one base id, and runs the read
 * on a tenant's behalf, authenticated by the Mission Control key the clone
 * already has. The prime is the account holder and still reads Airtable
 * directly.
 *
 * ## The three rules
 *
 * **The direct route requires the vendor token and nothing else decides it.**
 * A deployment holding `AIRTABLE_TOKEN` is one entitled to spend it — that is
 * the prime, and any future deployment given its own Airtable account.
 *
 * **A brokered read must NOT be metered here.** Mission Control writes the
 * usage row because Mission Control made the vendor call. Metering at both
 * ends bills the tenant twice, which this platform's own rule names as worse
 * than not billing at all. `meter` is what carries that.
 *
 * **A brokered route holds no base id, structurally.** The `broker` branch of
 * `ListingsRoute` has no `baseId` field, so `listingsRequestUrl` cannot put
 * one in a brokered URL even by mistake. Mission Control's own rule is that
 * the base is its and the caller never names one; this is the clone-side half
 * of that rule, enforced by the type rather than by a comment.
 *
 * ## Reads travel. The write-back does not.
 *
 * Two functions PATCH this base: `listing-images` writes the durable image
 * URLs into the enrichment column, and `listing-enrichment` writes resolved
 * field values. Both are correct on the prime, which owns the base, and both
 * are wrong from a clone for a reason that has nothing to do with secrecy:
 * every clone reads the SAME table, and what a clone would write are signed
 * URLs into ITS OWN bucket. Publishing those into the shared record hands
 * every other tenant links that are useless to them and were never theirs to
 * hold.
 *
 * So the broker is read-only by construction and stays that way — adding a
 * write operation would hand a tenant the ability to rewrite the table every
 * other tenant reads, which is the leak this whole arrangement exists to
 * close. `resolveWritebackRoute` is the other half: a deployment that does
 * not hold the token is REFUSED with the rule, not reported as
 * misconfigured, because there is nothing here for an operator to fix.
 *
 * Pure: no Deno, so the frontend tests import it too.
 */

/** The read operations Mission Control brokers. Both ends name them explicitly. */
export const BROKERED_LISTINGS_OPERATIONS = ['tables', 'records', 'selftest'] as const;
export type BrokeredListingsOperation = (typeof BROKERED_LISTINGS_OPERATIONS)[number];

export const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

/**
 * An Airtable record id: `rec` and fourteen alphanumerics.
 *
 * This shape is why `recordIds` can cross the boundary at all. The read it
 * serves — "the photograph columns for these listings" — is expressed in
 * Airtable as `filterByFormula`, which is a QUERY LANGUAGE, and a query
 * language is exactly what a broker must not accept from a caller: it would
 * let a tenant ask the shared base anything the token can answer. So the
 * formula is never sent. The caller names records, each one is checked against
 * this pattern, and Mission Control composes the formula itself from ids that
 * can contain nothing but `rec` and alphanumerics.
 */
export const AIRTABLE_RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

/**
 * How many records one read may name.
 *
 * Airtable's own page cap is 100 and a caller with more listings than that
 * chunks. `listing-images` can claim up to 120 in a sweep, so this is a real
 * bound rather than a formality.
 */
export const MAX_RECORD_IDS = 100;

export type ListingsQuery = {
  readonly table?: string;
  readonly pageSize?: number;
  readonly offset?: string;
  readonly sortField?: string;
  readonly sortDirection?: 'asc' | 'desc';
  /** Read exactly these records. Never a formula — see `AIRTABLE_RECORD_ID`. */
  readonly recordIds?: readonly string[];
};

/**
 * The record ids that may be sent, or the reason none may.
 *
 * Refusing here rather than filtering is deliberate: a caller that asked for
 * twelve listings and silently received eleven would fingerprint the twelfth
 * as having no photographs and re-arm its schedule having done nothing, which
 * is a failure this pipeline has already had once under a different cause.
 */
export function refuseRecordIds(ids: readonly string[]): string | null {
  if (ids.length === 0) return 'no record ids were named';
  if (ids.length > MAX_RECORD_IDS) {
    return `${ids.length} record ids were named; at most ${MAX_RECORD_IDS} may be read at once`;
  }
  const bad = ids.find((id) => !AIRTABLE_RECORD_ID.test(id));
  return bad === undefined ? null : `not an Airtable record id: ${JSON.stringify(bad)}`;
}

/** Airtable's own spelling of "these records", composed only from checked ids. */
export function recordIdFormula(ids: readonly string[]): string {
  const refusal = refuseRecordIds(ids);
  if (refusal) throw new Error(`recordIdFormula refused: ${refusal}`);
  return `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
}

export type ListingsRoute =
  | {
      via: 'direct';
      /** Only the direct route knows a base id, because only it holds the token. */
      baseId: string;
      headers: Record<string, string>;
      /** The credential to redact from any error text on this route. */
      secret: string;
      /** Direct reads spend the vendor token here, so they are metered here. */
      meter: true;
    }
  | {
      via: 'broker';
      /** Mission Control's ORIGIN. Any path the setting carried is trimmed. */
      missionControlUrl: string;
      /**
       * What was trimmed, when the setting carried a path.
       *
       * Kept so a failure can SAY it rather than a repair happening silently:
       * a deployment whose `MISSION_CONTROL_URL` is `…/api` was composing
       * `…/api/api/public/listings/tables`, which Mission Control's own router
       * answers 404 — indistinguishable, before this, from Airtable's 404.
       */
      trimmedPath?: string;
      headers: Record<string, string>;
      secret: string;
      /** Mission Control meters the vendor call it makes. Never both. */
      meter: false;
    }
  | { via: 'unconfigured'; why: string };

/**
 * Read `MISSION_CONTROL_URL` as an ORIGIN, and say what was trimmed.
 *
 * Every path this module composes is rooted — `/api/public/listings/…` — so a
 * base carrying its own path is unusable by construction: the two are
 * concatenated and the result is a URL nobody serves. Measured 8 Sep 2026,
 * `https://mission-control.aurixasystems.com.au/api` composes
 * `…/api/api/public/listings/tables`, which Mission Control's router answers
 * **404** with none of its own headers on it — so the clone recorded Airtable's
 * name against Mission Control's refusal to route, and no request was ever
 * metered because none reached a handler.
 *
 * Trailing slashes were already trimmed here for the same reason; a path is
 * the same mistake one character further on. It is trimmed rather than refused
 * because refusing would take a deployment that is one concatenation from
 * correct entirely off the air — and it is REPORTED rather than trimmed
 * silently, because a repair nobody is told about is a setting that stays
 * wrong.
 */
export function missionControlOrigin(raw: string): {
  origin: string;
  trimmedPath?: string;
} {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return { origin: '' };
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, '');
    return path ? { origin: u.origin, trimmedPath: path } : { origin: u.origin };
  } catch {
    // Not parseable as a URL. Hand it back as it was: naming the setting in a
    // failure is more use than replacing it with an empty string, which reads
    // as "not configured" and sends an operator to the wrong remedy.
    return { origin: trimmed };
  }
}

export function resolveListingsRoute(input: {
  airtableToken: string | null | undefined;
  airtableBaseId: string | null | undefined;
  missionControlUrl: string | null | undefined;
  cloneApiKey: string | null | undefined;
}): ListingsRoute {
  const token = (input.airtableToken ?? '').trim();
  const baseId = (input.airtableBaseId ?? '').trim();

  if (token && baseId) {
    return {
      via: 'direct',
      baseId,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      secret: token,
      meter: true,
    };
  }

  /*
   * A token with no base id is a misconfiguration and never a reason to
   * broker: brokering it would silently read a DIFFERENT base from the one
   * this deployment was set up for, and produce a plausible marketplace of
   * somebody else's listings. Say so instead.
   */
  if (token && !baseId) {
    return {
      via: 'unconfigured',
      why: 'AIRTABLE_TOKEN is set but AIRTABLE_BASE_ID is not, so this deployment cannot say which base to read',
    };
  }

  const rawMc = (input.missionControlUrl ?? '').trim();
  const mc = missionControlOrigin(rawMc);
  const cloneKey = (input.cloneApiKey ?? '').trim();
  if (!mc.origin || !cloneKey) {
    return {
      via: 'unconfigured',
      why:
        'the Listings pipeline needs either AIRTABLE_TOKEN and AIRTABLE_BASE_ID, or ' +
        'MISSION_CONTROL_URL and MISSION_CONTROL_CLONE_API_KEY to reach the broker',
    };
  }

  return {
    via: 'broker',
    missionControlUrl: mc.origin,
    ...(mc.trimmedPath ? { trimmedPath: mc.trimmedPath } : {}),
    headers: { 'x-clone-api-key': cloneKey, Accept: 'application/json' },
    secret: cloneKey,
    meter: false,
  };
}

/** The parameters both ends carry, and nothing else. */
function appendQuery(url: URL, q: ListingsQuery, includeTable: boolean): void {
  if (includeTable && q.table) url.searchParams.set('table', q.table);
  if (q.pageSize !== undefined) url.searchParams.set('pageSize', String(q.pageSize));
  if (q.offset) url.searchParams.set('offset', q.offset);
  if (q.sortField) {
    url.searchParams.set('sortField', q.sortField);
    url.searchParams.set('sortDirection', q.sortDirection ?? 'desc');
  }
  if (q.recordIds && q.recordIds.length > 0) {
    // Ids, never the formula they become. Checked here so a caller learns at
    // its own call site, and checked again by Mission Control, because a
    // broker that trusts its callers is not a boundary.
    const refusal = refuseRecordIds(q.recordIds);
    if (refusal) throw new Error(`listingsRequestUrl refused record ids: ${refusal}`);
    url.searchParams.set('recordIds', q.recordIds.join(','));
  }
}

/**
 * The URL for one read on this route.
 *
 * On the DIRECT route this is Airtable's own shape — the base id from the
 * route, the table in the path, and Airtable's `sort[0][field]` spelling. On
 * the BROKER route it is Mission Control's, and there is no base id to put in
 * it because the route does not carry one.
 */
export function listingsRequestUrl(
  route: ListingsRoute,
  operation: BrokeredListingsOperation,
  table: string,
  q: ListingsQuery = {},
): string {
  if (route.via === 'unconfigured') {
    throw new Error(`listingsRequestUrl called on an unconfigured route: ${route.why}`);
  }

  if (route.via === 'broker') {
    const url = new URL(`${route.missionControlUrl}/api/public/listings/${operation}`);
    appendQuery(url, { ...q, table }, true);
    return url.toString();
  }

  if (operation === 'tables') {
    return `${AIRTABLE_API_BASE}/meta/bases/${encodeURIComponent(route.baseId)}/tables`;
  }
  const url = new URL(
    `${AIRTABLE_API_BASE}/${encodeURIComponent(route.baseId)}/${encodeURIComponent(table)}`,
  );
  url.searchParams.set('pageSize', String(q.pageSize ?? 100));
  if (q.offset) url.searchParams.set('offset', q.offset);
  if (q.sortField) {
    url.searchParams.set('sort[0][field]', q.sortField);
    url.searchParams.set('sort[0][direction]', q.sortDirection ?? 'desc');
  }
  if (q.recordIds && q.recordIds.length > 0) {
    // The deployment holding the token composes the formula for itself, from
    // the same checked ids the brokered route would have sent as ids.
    url.searchParams.set('filterByFormula', recordIdFormula(q.recordIds));
  }
  return url.toString();
}

/**
 * Where a write-back to the intake base goes.
 *
 * There are exactly two answers and neither is "the broker". A deployment
 * holding the token owns the base and writes directly; every other deployment
 * is refused, and the refusal names the RULE rather than a missing setting —
 * because a clone will never hold this token, so "not configured" would send
 * an operator looking for something to fix that must not exist.
 */
export type WritebackRoute =
  | {
      via: 'direct';
      baseId: string;
      headers: Record<string, string>;
      secret: string;
      meter: true;
    }
  | { via: 'refused'; why: string };

export function resolveWritebackRoute(input: {
  airtableToken: string | null | undefined;
  airtableBaseId: string | null | undefined;
}): WritebackRoute {
  const token = (input.airtableToken ?? '').trim();
  const baseId = (input.airtableBaseId ?? '').trim();
  if (token && baseId) {
    return {
      via: 'direct',
      baseId,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      secret: token,
      meter: true,
    };
  }
  return {
    via: 'refused',
    why:
      'the Property Intake Master base is the account holder\'s shared record and this ' +
      'deployment does not hold its credential, so it does not write to it — the values ' +
      'that would be written are signed URLs into this deployment\'s own storage, which no ' +
      'other reader of the base could use',
  };
}

/** The URL for one write-back. Only ever a route that holds the token. */
export function writebackRequestUrl(route: WritebackRoute, table: string): string {
  if (route.via === 'refused') {
    throw new Error(`writebackRequestUrl called on a refused route: ${route.why}`);
  }
  return `${AIRTABLE_API_BASE}/${encodeURIComponent(route.baseId)}/${encodeURIComponent(table)}`;
}

/**
 * Whether an answer came from Mission Control refusing, rather than Airtable.
 *
 * Read from the header Mission Control sets on its OWN refusals and never on
 * what it relays. Both ends can answer 401/403/429 with similar JSON and they
 * send an operator to opposite remedies — "fix the clone's Mission Control
 * key" versus "fix the Airtable token" — so this is read from the header
 * rather than guessed from a body.
 */
export function missionControlRefusal(headers: Headers): string | null {
  return headers.get('x-mission-control-refusal');
}

/**
 * Mission Control names itself on every answer its listings endpoint gives —
 * a refusal AND a relay.
 *
 * `x-mission-control-refusal` answers "did Mission Control refuse this, or did
 * Airtable?". It cannot answer the question one step further out: **did the
 * request reach Mission Control at all?** It is absent on a relayed vendor
 * failure and equally absent on a 404 from some other host that
 * `MISSION_CONTROL_URL` happens to name.
 *
 * Measured 8 Sep 2026. One clone recorded `airtable_404` on every Listings
 * sync for a morning while the two beside it were served normally, and nothing
 * from it reached Mission Control's ledger at any tick. Its deployed bundle
 * carried the broker, so it had resolved the brokered route and addressed the
 * URL it was given — something that is not Mission Control answered, and the
 * clone wrote it down as the vendor's. Every reading it had was consistent
 * with a marketplace-wide outage, so that is where it sent anyone who looked.
 *
 * This header is a POSITIVE marker of arrival, which is what lets its absence
 * mean something.
 */
export const MISSION_CONTROL_ENDPOINT_HEADER = 'x-mission-control-endpoint';

/** Did Mission Control produce this answer at all — refusal or relay? */
export function missionControlAnswered(headers: Headers): boolean {
  return headers.get(MISSION_CONTROL_ENDPOINT_HEADER) !== null;
}

/** Which end produced a failing answer. */
export type FailingEnd = 'airtable' | 'mission_control' | 'not_mission_control' | 'unconfigured';

export interface ListingsFailure {
  /** The end that answered. */
  readonly end: FailingEnd;
  /**
   * A stable code for a log line or a `last_error` column.
   *
   * Stable is the point: it is grepped and compared across ticks, so nothing
   * variable belongs in it. Anything that varies goes in `detail`.
   */
  readonly code: string;
  /** How to name that end to a person reading a message. */
  readonly service: string;
  /** Anything variable worth saying beside the code. Never a credential. */
  readonly detail?: string;
}

/**
 * Name the end that produced a failing answer, for a route WE chose.
 *
 * Three outcomes rather than the two the refusal header alone can give:
 *
 * - **`airtable`** — the direct route (only the vendor can answer), or a
 *   brokered answer Mission Control marked as its own and did not refuse.
 * - **`mission_control`** — Mission Control's own no, which is fixed in
 *   Mission Control's environment rather than on this deployment.
 * - **`not_mission_control`** — a brokered call whose answer Mission Control
 *   did not mark. The request went somewhere; that somewhere is not this
 *   endpoint. `MISSION_CONTROL_URL` is the thing to look at, and no amount of
 *   investigating Airtable will help.
 *
 * The third is the reading that did not exist, and the one a wrong
 * `MISSION_CONTROL_URL` needs.
 */
export function describeListingsFailure(
  route: ListingsRoute,
  response: { status: number; headers: Headers },
): ListingsFailure {
  if (route.via === 'unconfigured') {
    // Nothing was called, so nothing answered. Reported rather than thrown:
    // this runs on a failure path, and throwing here would replace a real
    // fault with a stack trace about the reporting of it.
    return { end: 'unconfigured', code: 'airtable_not_configured', service: 'this deployment' };
  }

  if (route.via === 'direct') {
    return {
      end: 'airtable',
      code: `airtable_${response.status}`,
      service: 'Airtable',
      /*
       * Say the ROUTE, not only the end.
       *
       * `resolveListingsRoute` prefers `direct` whenever a token AND a base id
       * are both present, and it is right to: a deployment holding the
       * credential should spend its own. But Mission Control withholding a
       * secret stops it FORWARDING one; it does not remove a value already on
       * the project. So a clone that everything believes is brokered can still
       * hold a stale pair, take the direct road, and report the vendor's
       * status for a base id nobody has looked at since.
       *
       * Measured 8 Sep 2026: one clone answered `airtable_404` on every
       * Listings sync for five hours while appearing zero times in Mission
       * Control's ledger — every reading it produced was true, and none of
       * them said which road it had taken.
       */
      detail: 'read directly, with AIRTABLE_TOKEN and AIRTABLE_BASE_ID held on this deployment',
    };
  }

  const refusal = missionControlRefusal(response.headers);
  if (refusal) {
    return {
      end: 'mission_control',
      code: `mission_control_${refusal}`,
      service: 'Mission Control',
    };
  }

  if (missionControlAnswered(response.headers)) {
    return {
      end: 'airtable',
      code: `airtable_${response.status}`,
      service: 'Airtable',
      // The other road to the same vendor status, named so the two are never
      // confused: Mission Control made this call and relayed the answer.
      detail: 'brokered by Mission Control, which relayed this answer',
    };
  }

  return {
    end: 'not_mission_control',
    code: `mission_control_unreachable_${response.status}`,
    // Name what was ADDRESSED. "Something that is not Mission Control
    // answered" narrows the search; the URL ends it — and the host is often
    // right while the setting carried a path, which reads as the opposite
    // fault if the message asserts the host is wrong.
    service: `${route.missionControlUrl} (MISSION_CONTROL_URL)`,
    detail: route.trimmedPath
      ? `MISSION_CONTROL_URL carried the path ${route.trimmedPath}, read as its origin`
      : undefined,
  };
}
