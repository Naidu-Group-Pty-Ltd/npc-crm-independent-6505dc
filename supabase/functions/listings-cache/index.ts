import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createForbiddenResponse,
  createUnauthorizedResponse,
  createCorsHeaders,
} from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import {
  listingsRequestUrl,
  describeListingsFailure,
  resolveListingsRoute,
  type ListingsRoute,
} from '../_shared/airtableListingsRoute.pure.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  enforceActorQuota,
  enforceIpQuota,
  fetchWithTimeout,
  getClientIp,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import {
  assessRetention,
  orderLooksSorted,
  planReconciliation,
  planRetention,
  toCacheRow,
  type CachedListingRow,
  type VanishedRow,
} from '../_shared/listingsCache.pure.ts';
import {
  allowlistAdmits,
  buildAllowlist,
  canonicalTableKey,
  looksLikeTableId,
  normaliseName,
  parseTableAliases,
} from '../_shared/airtableTableKey.pure.ts';
import { INTAKE_SORT_FIELD } from '../_shared/airtableIntakeFields.pure.ts';

/**
 * Server-side listings cache.
 *
 * Overview and Listings both need the whole property table. Reading it from
 * Airtable costs `ceil(N/100)` **sequential** round trips — the offset for page
 * N+1 only exists once page N has returned — and every user paid that, on every
 * device, every time. A browser cache could not fix it: it does nothing for a
 * first visit, a new device, or a cleared profile, which is most of the load
 * that actually hurts.
 *
 *   op: 'read'  (a signed-in user) — one Postgres read returns the whole set.
 *   op: 'sync'  (service role, cron) — walks Airtable once for everybody and
 *               brings the cache in line, deletions included.
 *
 * The cache **archives** Airtable; it used to mirror it, and that was the bug.
 * Airtable prunes the intake table 30 days after a record's Created Time
 * because it is a working table, and the reconciliation step propagated every
 * one of those deletions — so the product's whole inventory sat on a thirty-day
 * fuse with no copy anywhere. 148 listings on 2026-08-19 were 51 by 2026-08-25,
 * all from one evening's intake, with the next purge due to take those too.
 *
 * The purge stays; it is doing its job. What changed is what a vanished row
 * MEANS: aged out of the window → kept and stamped `archived_at`; gone while
 * still inside it → deleted, because somebody deleted it. `planRetention` draws
 * that line.
 *
 * Reconciliation is still the most dangerous code in this file — it is the one
 * operation that can destroy data for every user at once, on a schedule,
 * unattended — so whether it runs at all is still decided by
 * `planReconciliation` from evidence, and is still refused by default.
 */

const CIRCUIT_SCOPE = 'listings_cache_read';

/** Airtable's own per-request ceiling. */
const AIRTABLE_PAGE_SIZE = 100;
/**
 * Walk safety stop. Well past the current 1,441 records, and its only job is to
 * stop a paging bug looping forever. Hitting it marks the walk incomplete, which
 * blocks reconciliation — an early exit must never look like a deletion.
 */
const MAX_PAGES = 200;
/** Rows per Postgres round trip. */
const WRITE_CHUNK = 500;
/** PostgREST caps a single select; the read pages through with `.range()`. */
const READ_PAGE = 1000;

interface SyncState {
  record_count: number | null;
}

/* -------------------------------------------------------------------------- */
/* Table identity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Display name → table id, learned from Airtable and held for the isolate's
 * lifetime.
 *
 * The alternative was a new env var every deployment would have to set before
 * the fix took effect. Asking Airtable is self-configuring: the schema endpoint
 * is the authority on what a table is called, the answer never changes in
 * practice, and one request per cold isolate is nothing against the fifteen this
 * whole function exists to remove.
 */
let aliasCache: Map<string, string> | null = null;

async function tableAliases(): Promise<Map<string, string>> {
  if (aliasCache) return aliasCache;

  // An explicit override skips the lookup entirely, for a deployment that would
  // rather not grant schema access or wants to pin the mapping.
  const configured = parseTableAliases(Deno.env.get('AIRTABLE_TABLE_ALIASES'));
  if (configured.size > 0) {
    aliasCache = configured;
    return aliasCache;
  }

  const route = currentRoute();
  if (route.via === 'unconfigured') return new Map();

  try {
    const response = await fetchWithTimeout(
      listingsRequestUrl(route, 'tables', ''),
      { headers: route.headers },
      10_000,
    );
    if (!response.ok) {
      // Not fatal. Resolution falls back to the raw string, which is what the
      // code did before this existed — but name which end declined, for the
      // same reason the records walk does.
      const failure = describeListingsFailure(route, response);
      console.warn(
        '[listings-cache] table metadata unavailable',
        failure.detail ? `${failure.code}; ${failure.detail}` : failure.code,
      );
      return new Map();
    }
    const payload = (await response.json()) as { tables?: Array<{ id?: string; name?: string }> };
    const learned = new Map<string, string>();
    for (const table of payload.tables ?? []) {
      if (table?.id && table?.name && looksLikeTableId(table.id)) {
        learned.set(normaliseName(table.name), table.id);
      }
    }
    // Only cache a useful answer, so a transient empty response does not pin an
    // empty map for the isolate's whole life.
    if (learned.size > 0) aliasCache = learned;
    return learned;
  } catch (error) {
    console.warn('[listings-cache] table metadata lookup failed', redactError(error));
    return new Map();
  }
}

/* -------------------------------------------------------------------------- */
/* Airtable                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The route this deployment reads Airtable on.
 *
 * Resolved from the environment on every call rather than cached: a clone that
 * is given its own token later must start using it without a redeploy, and the
 * read is four `Deno.env.get`s.
 */
function currentRoute(): ListingsRoute {
  return resolveListingsRoute({
    airtableToken: Deno.env.get('AIRTABLE_TOKEN'),
    airtableBaseId: Deno.env.get('AIRTABLE_BASE_ID'),
    missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
    cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
  });
}

interface AirtableConfig {
  /**
   * Where this deployment reads Airtable: directly with its own token, or
   * through Mission Control's broker when it holds none. Resolved ONCE by the
   * caller and carried, so a walk cannot take a different route page to page.
   */
  route: ListingsRoute;
  table: string;
}

interface WalkResult {
  records: Array<{ id: string; createdTime?: string; fields?: Record<string, unknown> }>;
  complete: boolean;
  sorted: boolean;
  error: string | null;
}

/**
 * Reads the entire table, newest first.
 *
 * `complete` is the field that matters: it is false whenever the walk stopped
 * for any reason other than Airtable saying there is no more data — an HTTP
 * error, a timeout, the page cap. Everything downstream treats an incomplete
 * walk as "these records might exist and I simply did not see them", which is
 * the difference between a cache that mirrors deletions and one that invents
 * them.
 */
async function walkAirtable(config: AirtableConfig): Promise<WalkResult> {
  const records: WalkResult['records'] = [];
  let offset: string | undefined;
  let sortRejected = false;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages += 1;
    const url = listingsRequestUrl(config.route, 'records', config.table, {
      pageSize: AIRTABLE_PAGE_SIZE,
      ...(offset ? { offset } : {}),
      ...(sortRejected ? {} : { sortField: INTAKE_SORT_FIELD, sortDirection: 'desc' as const }),
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { headers: config.route.via === 'unconfigured' ? {} : config.route.headers },
        20_000,
      );
    } catch (error) {
      return { records, complete: false, sorted: !sortRejected, error: redactError(error) };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // A table without a `Created` field rejects the sort. `airtable-proxy`
      // retries without it and tells the caller nothing; here the retry is the
      // same but the fact is carried out to the sync row, because a walk that
      // silently stopped being newest-first breaks the client's incremental
      // path even though it does not break this one.
      const unknownSortField =
        !sortRejected &&
        (response.status === 422 ||
          /UNKNOWN_FIELD_NAME|INVALID_SORT_FIELD|not a valid field|unknown field/i.test(body));
      if (unknownSortField) {
        sortRejected = true;
        pages -= 1;
        continue;
      }
      /*
       * Say which END answered, because the remedies are opposite and there
       * are THREE of them.
       *
       * `airtable_401` is what this used to write for both "Airtable rejected
       * the token Mission Control holds" and "Mission Control rejected this
       * clone's key" — the first is fixed in Mission Control's environment,
       * the second on this deployment. Measured 8 Sep 2026 on NPC Test: the
       * first brokered read wrote `airtable_401`, which happened to be true,
       * but it was true by luck and the same six characters would have been
       * written had the key been wrong.
       *
       * The third reading is the one that cost a morning. A brokered answer
       * Mission Control did not MARK never reached Mission Control at all, and
       * on 8 Sep one clone read its own wrong `MISSION_CONTROL_URL` as
       * `airtable_404` on every tick while the two beside it were served
       * normally. `describeListingsFailure` is the one place that separates
       * the three, so this walk and the metadata lookup above cannot disagree.
       */
      const failure = describeListingsFailure(config.route, response);
      return {
        records,
        complete: false,
        sorted: !sortRejected,
        // The sync row is the only record an operator sees for a cron-driven
        // read, so what VARIES travels with the stable code rather than only
        // reaching a log nothing in the product renders.
        error: failure.detail ? `${failure.code}; ${failure.detail}` : failure.code,
      };
    }

    const payload = (await response.json()) as {
      records?: WalkResult['records'];
      offset?: string;
    };
    records.push(...(payload.records ?? []));

    offset = payload.offset;
    // No offset is Airtable saying "that was everything" — the only clean exit.
    if (!offset) return { records, complete: true, sorted: !sortRejected, error: null };
  }

  return { records, complete: false, sorted: !sortRejected, error: 'page_cap_reached' };
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

type Supabase = ReturnType<typeof createClient>;

interface HeldRows {
  /** listing_id → fingerprint, for deciding what has to be rewritten. */
  fingerprints: Map<string, string | null>;
  /** Rows currently marked archived, so a record that comes back can be revived. */
  archived: Set<string>;
}

/** Every row currently held for a table, paged past PostgREST's cap. */
async function loadHeldRows(supabase: Supabase, tableKey: string): Promise<HeldRows> {
  const fingerprints = new Map<string, string | null>();
  const archived = new Set<string>();
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('listings_cache')
      .select('listing_id, fingerprint, archived_at')
      .eq('table_key', tableKey)
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`fingerprint_read_failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      listing_id: string;
      fingerprint: string | null;
      archived_at: string | null;
    }>;
    for (const row of rows) {
      fingerprints.set(row.listing_id, row.fingerprint);
      if (row.archived_at) archived.add(row.listing_id);
    }
    if (rows.length < READ_PAGE) return { fingerprints, archived };
  }
}

/**
 * Un-archives records the walk saw again.
 *
 * Airtable never reissues a record id, so this only fires when somebody
 * restores one from the trash — but an archived row that is live again must say
 * so, or the next reconciliation would skip it (it selects live rows only) and
 * it would sit archived forever while Airtable holds it.
 */
async function reviveArchived(
  supabase: Supabase,
  tableKey: string,
  ids: string[],
): Promise<number> {
  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const { error } = await supabase
      .from('listings_cache')
      .update({ archived_at: null })
      .eq('table_key', tableKey)
      .in('listing_id', ids.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`revive_failed: ${error.message}`);
  }
  return ids.length;
}

async function writeChanged(supabase: Supabase, rows: CachedListingRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await supabase
      .from('listings_cache')
      .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: 'listing_id' });
    if (error) throw new Error(`upsert_failed: ${error.message}`);
  }
}

/**
 * Re-stamps records the walk saw but which have not changed.
 *
 * This is what makes a 15-minute sync affordable: an unchanged record costs one
 * timestamp in a bulk update instead of rewriting a JSONB blob of 205 fields.
 * It is also load-bearing for correctness — reconciliation deletes by
 * `last_verified_at`, so a record that was seen and skipped still has to be
 * stamped or the next sweep would delete it.
 */
async function stampUnchanged(
  supabase: Supabase,
  tableKey: string,
  ids: string[],
  verifiedAt: string,
): Promise<void> {
  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const { error } = await supabase
      .from('listings_cache')
      .update({ last_verified_at: verifiedAt })
      .eq('table_key', tableKey)
      .in('listing_id', ids.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`stamp_failed: ${error.message}`);
  }
}

async function recordSyncState(
  supabase: Supabase,
  tableKey: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('listings_cache_sync')
    .upsert({ table_key: tableKey, ...patch }, { onConflict: 'table_key' });
}

interface SyncOutcome {
  fetched: number;
  archived: number;
  revived: number;
  withheld: number;
  retentionEffective: boolean;
  changed: number;
  unchanged: number;
  deleted: number;
  reconciled: boolean;
  reconcileReason: string;
  sorted: boolean;
  status: string;
  error: string | null;
}

async function runSync(
  supabase: Supabase,
  config: AirtableConfig,
  tableKey: string,
): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString();

  const { data: stateRow } = await supabase
    .from('listings_cache_sync')
    .select('record_count')
    .eq('table_key', tableKey)
    .maybeSingle();
  const previousCount = (stateRow as SyncState | null)?.record_count ?? null;

  await recordSyncState(supabase, tableKey, { status: 'syncing', last_sync_at: startedAt });

  const walk = await walkAirtable(config);

  // Deduplicate by id and drop anything without a usable one. Airtable does not
  // repeat a record within a walk, but an offset served during a concurrent
  // write can, and a duplicate would make the upsert conflict with itself.
  const rowsById = new Map<string, CachedListingRow>();
  for (const record of walk.records) {
    const row = toCacheRow(record, tableKey, startedAt);
    if (row) rowsById.set(row.listing_id, row);
  }
  const rows = Array.from(rowsById.values());

  const held = await loadHeldRows(supabase, tableKey);
  const changed: CachedListingRow[] = [];
  const unchanged: string[] = [];
  const revived: string[] = [];
  for (const row of rows) {
    if (held.fingerprints.get(row.listing_id) === row.fingerprint) unchanged.push(row.listing_id);
    else changed.push(row);
    if (held.archived.has(row.listing_id)) revived.push(row.listing_id);
  }

  await writeChanged(supabase, changed);
  await stampUnchanged(supabase, tableKey, unchanged, startedAt);
  await reviveArchived(supabase, tableKey, revived);

  const verdict = planReconciliation({
    walkComplete: walk.complete,
    fetchedCount: rows.length,
    previousCount,
  });

  let deleted = 0;
  let archived = 0;
  let withheld = 0;
  let withheldNote: string | null = null;
  if (verdict.allowed) {
    /*
     * Anything not re-stamped by this run is gone from Airtable — and what that
     * MEANS is the difference between a mirror and an archive.
     *
     * This used to delete all of it, which is why the marketplace was emptying
     * itself: Airtable prunes the intake table at thirty days because it is a
     * working table, and propagating that left the product with a thirty-day
     * fuse and no copy anywhere. 148 listings on 2026-08-19 were 51 by
     * 2026-08-25, and the next purge was due to take those too.
     *
     * The purge is not the bug. Mirroring it is. So a row that aged out is kept
     * and stamped `archived_at`; a row that disappeared while still inside the
     * window was deleted on purpose and is still removed. `planRetention` draws
     * that line and explains where it leans at the boundary.
     */
    const { data, error } = await supabase
      .from('listings_cache')
      .select('listing_id, created_time')
      .eq('table_key', tableKey)
      .lt('last_verified_at', startedAt)
      .is('archived_at', null);
    if (error) throw new Error(`reconcile_failed: ${error.message}`);

    const plan = planRetention((data ?? []) as VanishedRow[], Date.parse(startedAt) || Date.now(), {
      // The removal cap is measured against what this walk actually saw, so a
      // walk that missed most of the table cannot delete what it missed.
      liveCount: rows.length,
    });
    if (plan.note) console.warn('[listings-cache] retention', plan.note);

    for (let i = 0; i < plan.archive.length; i += WRITE_CHUNK) {
      const { error: archiveError } = await supabase
        .from('listings_cache')
        .update({ archived_at: startedAt })
        .eq('table_key', tableKey)
        .in('listing_id', plan.archive.slice(i, i + WRITE_CHUNK));
      if (archiveError) throw new Error(`archive_failed: ${archiveError.message}`);
    }
    archived = plan.archive.length;

    for (let i = 0; i < plan.remove.length; i += WRITE_CHUNK) {
      const { error: deleteError } = await supabase
        .from('listings_cache')
        .delete()
        .eq('table_key', tableKey)
        .in('listing_id', plan.remove.slice(i, i + WRITE_CHUNK));
      if (deleteError) throw new Error(`reconcile_failed: ${deleteError.message}`);
    }
    deleted = plan.remove.length;
    withheld = plan.withheld;
    withheldNote = plan.note;
  }

  /*
   * Is the purge still running? Asserted from its effect, because the
   * automation lives in Airtable and cannot be read from here: if it runs
   * daily, nothing the walk sees is ever much older than thirty days.
   */
  const oldestLive = rows.reduce<string | null>((oldest, row) => {
    if (!row.created_time) return oldest;
    return oldest === null || row.created_time < oldest ? row.created_time : oldest;
  }, null);
  const retention = assessRetention(oldestLive, Date.parse(startedAt) || Date.now());

  const sorted = orderLooksSorted(rows.slice(0, 200).map((row) => row.created_time));
  const status = walk.complete ? (verdict.allowed ? 'ok' : 'partial') : 'partial';
  const notes = [
    walk.error,
    verdict.allowed ? null : `reconcile skipped: ${verdict.reason}`,
    sorted ? null : 'walk did not come back newest-first',
    retention.effective ? null : retention.reason,
    withheldNote,
  ].filter(Boolean) as string[];

  await recordSyncState(supabase, tableKey, {
    last_sync_at: startedAt,
    // Only a clean, fully reconciled run may move the baseline the next run
    // compares against. A partial run that wrote here would teach the guard a
    // count it never actually verified.
    ...(status === 'ok'
      ? { last_full_sync_at: startedAt, record_count: rows.length }
      : {}),
    status,
    reconciled: verdict.allowed,
    archived_count: archived,
    oldest_live_created_time: oldestLive,
    retention_effective: retention.effective,
    retention_note: retention.reason.slice(0, 300),
    error_count: notes.length,
    last_error: notes.length ? notes.join('; ').slice(0, 500) : null,
  });

  return {
    fetched: rows.length,
    changed: changed.length,
    unchanged: unchanged.length,
    deleted,
    archived,
    revived: revived.length,
    withheld,
    retentionEffective: retention.effective,
    reconciled: verdict.allowed,
    reconcileReason: verdict.reason,
    sorted,
    status,
    error: notes.length ? notes.join('; ') : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

interface ReadRow {
  listing_id: string;
  fields: Record<string, unknown>;
  created_time: string | null;
}

/**
 * The whole cached set for one table, newest first.
 *
 * Returned as Airtable-shaped records rather than projected listings: the
 * projection is pure and the client already owns a copy of it, so sending
 * `fields` alone halves the payload against sending both, and keeps this
 * function free of any opinion about how a listing is displayed.
 */
async function readCache(supabase: Supabase, tableKey: string) {
  const records: Array<{ id: string; createdTime: string | null; fields: Record<string, unknown> }> =
    [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('listings_cache')
      .select('listing_id, fields, created_time')
      .eq('table_key', tableKey)
      .order('created_time', { ascending: false, nullsFirst: false })
      .order('listing_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`read_failed: ${error.message}`);
    const rows = (data ?? []) as ReadRow[];
    for (const row of rows) {
      records.push({
        id: row.listing_id,
        createdTime: row.created_time,
        fields: row.fields ?? {},
      });
    }
    if (rows.length < READ_PAGE) return records;
  }
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const op = typeof body.op === 'string' ? body.op : 'read';

    if (killSwitchActive('LISTINGS_CACHE_KILL_SWITCH')) {
      return j({ success: false, error: 'temporarily_unavailable' }, 503);
    }

    const defaultTable = (Deno.env.get('AIRTABLE_TABLE_NAME') || '').trim();
    const requested = typeof body.tableName === 'string' ? body.tableName.trim() : '';

    // Both sides of the storage key and the allowlist go through the same
    // resolution. Cron passes no table name and so writes under the configured
    // default (an id); the Listings page passes the display name. Without this
    // they were two different keys for one table, the read matched nothing, and
    // the client silently fell back to walking Airtable.
    const aliases = await tableAliases();
    const tableKey = canonicalTableKey({ requested, fallback: defaultTable, aliases });
    if (!tableKey) return j({ success: false, error: 'no_table_configured' }, 400);

    // Same allowlist the proxy enforces, so the cache cannot become a way to
    // read a table the proxy would have refused.
    const allowlist = buildAllowlist(defaultTable, Deno.env.get('AIRTABLE_TABLE_ALLOWLIST'), aliases);
    if (!allowlistAdmits(allowlist, tableKey)) {
      return j({ success: false, error: 'table_not_permitted' }, 403);
    }

    /* -- Cron / service-role sync ---------------------------------------- */
    if (op === 'sync') {
      // Carries no user; only reachable with the service-role key, which cron
      // holds and a browser never does.
      const authHeader = req.headers.get('authorization') || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
        return createUnauthorizedResponse('Service role required', corsHeaders);
      }

      const route = currentRoute();
      if (route.via === 'unconfigured') {
        // Names WHICH half is missing rather than a bare "not configured":
        // a deployment with no token needs Mission Control's two names, and
        // one with a token needs its base id. Opposite remedies.
        return j({ success: false, error: 'airtable_not_configured', detail: route.why }, 500);
      }

      try {
        const outcome = await runSync(supabase, { route, table: tableKey }, tableKey);
        return j({ success: true, op, tableKey, ...outcome });
      } catch (error) {
        const message = redactError(error);
        await recordSyncState(supabase, tableKey, {
          status: 'failed',
          reconciled: false,
          last_error: message.slice(0, 500),
        });
        return j({ success: false, op, error: message }, 502);
      }
    }

    /* -- User-facing read ------------------------------------------------- */
    const { error: authError, userId, authMethod } = await verifyAuth(
      supabase,
      req.headers,
      body as { session_token?: string },
    );
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }
    const permission = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'listings',
      'can_view',
    );
    if (!permission.ok) {
      return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);
    }

    const actorQuota = await enforceActorQuota(supabase, userId, CIRCUIT_SCOPE, {
      limit: 60,
      windowMs: 60_000,
    });
    const ipQuota = await enforceIpQuota(supabase, getClientIp(req), CIRCUIT_SCOPE, {
      limit: 120,
      windowMs: 60_000,
    });
    if (!actorQuota.ok || !ipQuota.ok) return j({ success: false, error: 'rate_limited' }, 429);

    /**
     * One record, for a deep link.
     *
     * `/listings/:id` opened in a fresh tab has no warm cache and no in-memory
     * set to read from. Without this it would have to pull the whole table —
     * or, worse, fall back to walking Airtable — to render a single property.
     */
    if (op === 'record') {
      const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : '';
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(listingId)) {
        return j({ success: false, error: 'invalid_listing_id' }, 400);
      }
      const { data: row, error: rowError } = await supabase
        .from('listings_cache')
        .select('listing_id, fields, created_time')
        .eq('listing_id', listingId)
        .eq('table_key', tableKey)
        .maybeSingle();
      if (rowError) return j({ success: false, error: 'read_failed' }, 500);
      if (!row) return j({ success: false, error: 'not_found' }, 404);

      const record = row as { listing_id: string; fields: Record<string, unknown>; created_time: string | null };
      const { data: overlay } = await supabase
        .from('listing_enrichment')
        .select('values, provenance, status, last_enriched_at')
        .eq('listing_id', listingId)
        .maybeSingle();

      return j({
        success: true,
        op,
        tableKey,
        record: {
          id: record.listing_id,
          createdTime: record.created_time,
          fields: record.fields ?? {},
        },
        enrichment: overlay ?? null,
      });
    }

    const records = await readCache(supabase, tableKey);
    const { data: state } = await supabase
      .from('listings_cache_sync')
      .select(
        'last_sync_at, last_full_sync_at, status, reconciled, record_count, ' +
          'archived_count, oldest_live_created_time, retention_effective, retention_note',
      )
      .eq('table_key', tableKey)
      .maybeSingle();

    return j({
      success: true,
      op: 'read',
      tableKey,
      records,
      total: records.length,
      // Surfaced rather than swallowed: a caller that gets an empty set because
      // the cache has never synced should be able to tell that apart from a
      // table that genuinely has no listings.
      //
      // `record_count` is what Airtable still holds; `total` is what this store
      // serves, and the two now differ by the archive. `retention_effective`
      // carries the answer to "is the 30-day purge still running", which is
      // otherwise unobservable from anywhere in this product.
      sync: state ?? null,
    });
  } catch (error) {
    console.error('[listings-cache] unhandled', redactError(error));
    return j({ success: false, error: 'internal_error' }, 500);
  }
});
