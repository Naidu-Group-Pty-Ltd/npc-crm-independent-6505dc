/**
 * Command Centre — Builder Stock in the Property Marketplace.
 *
 * The internal half of the Stock List feature. Since Phase 7 of the network
 * extraction it reads the `builder_network_stock_*` MIRROR tables — the same
 * rows under the same ids, seeded from the portal tables before those are
 * dropped, and written by the Builders Network sync from then on. It still
 * writes the selection that activates the builder when a Command Centre user
 * picks a property for a client: `builder_stock_selections` is the Command
 * Centre's own record and never left.
 *
 * THREE GATES, IN ORDER, ON EVERY OPERATION:
 *   1. the internal session (`verifyAuth`), plus CSRF on mutations;
 *   2. the module permission — deny by default, `listings` to read and
 *      `clients` to write a client selection;
 *   3. the `builder_stock_marketplace` feature flag.
 *
 * (3) is here and not only in the browser. Hiding a tab is convenience; a
 * disabled feature whose endpoint still answers is not disabled.
 *
 * THE SELECTION IS RESOLVED, NEVER ACCEPTED. The request names a property and
 * a client and nothing else. Which builder organisation supplied that
 * property, which upload it came from and which builder user uploaded it are
 * all re-read from the database at write time, because a browser cannot be the
 * source of a relationship.
 *
 * WHAT MOVED WITH THE PORTAL. Supplying imagery on a builder's behalf wrote
 * the portal's image pipeline (upload registration, verification, the
 * settler's queue), and that pipeline retires with the portal — mirror rows
 * arrive already processed. Both image-supply operations refuse with the
 * network's address rather than writing to tables scheduled for deletion, and
 * the in-portal notification on a selection went with the portal it notified.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse,
} from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { builderNetworkEnabled } from '../_shared/builderNetwork.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { STOCK_IMAGE_BUCKET } from '../_shared/builderStock/fileTypes.pure.ts';
import { rankImage } from '../_shared/builderStock/imagePriority.pure.ts';
import { readAllRows } from '../_shared/builderStock/pagedRead.ts';
import {
  COMMAND_SELECTION_SELECT, COMMAND_SELECTION_STATUSES, STOCK_IMAGE_SELECT,
  RANKED_ITEM_SELECT, STOCK_ITEM_SELECT, isSelectableAvailability, stockPagination,
} from '../_shared/builderStock/projection.pure.ts';
import { applyManualStatsToAll } from '../_shared/builderStock/manualStats.pure.ts';
import { readPropertyDetail } from '../_shared/builderStock/propertyDetail.ts';
import {
  countUnreadAcknowledgementNotices, listActivatedProperties, listMyConversations, newBuilderMessages, listPropertyConversations,
  markAcknowledgementNoticesRead, readParticipantConversation,
} from '../_shared/builderStock/privateConversations.ts';
import { agencyMessageRefusal, projectConversationMessages } from '../_shared/builderStock/agencyMessages.pure.ts';
import {
  promotedOrganisations, splicePinsIntoPage, type RankedRow,
} from '../_shared/builderStock/marketplaceOrder.pure.ts';
import {
  derivativeToServe, type DisplayableImage,
} from '../_shared/builderStock/primaryImage.ts';
import {
  isMissingRankingRelation, type MirrorSource,
} from '../_shared/builderStock/mirrorAvailability.pure.ts';

const FEATURE_FLAG_KEY = 'builder_stock_marketplace';
const IMAGE_URL_TTL_SECONDS = 300;

function cleanText(value: unknown, max = 200): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The toggle, read server-side.
 *
 * Fails CLOSED: an unreadable flag row disables the surface rather than
 * opening it. A missing row is the same as `false`, which is what a deployment
 * that has never turned this on should see.
 */
async function builderStockEnabled(db: any): Promise<boolean> {
  const { data, error } = await db
    .from('feature_flags').select('value').eq('key', FEATURE_FLAG_KEY).maybeSingle();
  if (error || !data) return false;
  const value = data.value;
  return value === true || value === 'true'
    || (typeof value === 'object' && value !== null && (value as any).enabled === true);
}

/** How many invitation candidates one read asks for. */
const INVITEE_PAGE = 500;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const { error: authError, userId, authMethod } = await verifyAuth(
      supabase, req.headers, body as { session_token?: string });
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }
    const actor = { userId, authMethod };

    const listingsView = await requireModulePermission(supabase, actor, 'listings', 'can_view');
    if (!listingsView.ok) {
      return createForbiddenResponse(listingsView.error || 'Listings access required', corsHeaders);
    }

    /**
     * "Is the tab available?" — the one operation that must answer while the
     * feature is OFF, because it is what decides whether to render the tab.
     *
     * It is here rather than in the browser because the Command Centre's
     * Supabase client is anon-only: `feature_flags` grants SELECT to
     * `authenticated`, which this app's custom cookie session never becomes, so
     * a direct table read from the page returns nothing and every flag would
     * read as off. The service role inside this function is the only reader
     * that works, and the caller is still checked against `listings` above.
     */
    if (operation === 'feature_state') {
      return json({ success: true, enabled: await builderStockEnabled(supabase) });
    }

    // Gate 3. Every other operation, including the reads.
    if (!await builderStockEnabled(supabase)) {
      return json({
        error: 'Builder Stock is switched off for this workspace.',
        code: 'builder_stock_disabled',
      }, 403);
    }

    /** Load one stock item from the network mirror. Active stock only. */
    const loadItem = async (itemId: string) => {
      if (!itemId) return null;
      const { data } = await supabase
        .from('builder_network_stock_items')
        .select('*')
        .eq('id', itemId)
        .eq('lifecycle_status', 'active')
        .maybeSingle();
      return data;
    };

    /**
     * A property this deployment ever activated stays READABLE after the
     * builder stops listing it: its page and its conversation are durable
     * history. Everything else is active stock only, and every write still
     * goes through `loadItem`.
     */
    const loadReadableItem = async (itemId: string) => {
      if (!itemId) return null;
      const { data } = await supabase
        .from('builder_network_stock_items')
        .select('*')
        .eq('id', itemId)
        .maybeSingle();
      if (!data) return null;
      if (data.lifecycle_status === 'active') return data;
      const { count, error } = await supabase
        .from('builder_stock_selections')
        .select('id', { count: 'exact', head: true })
        .eq('stock_item_id', data.id);
      return !error && count ? data : null;
    };

    // =====================================================================
    // Reads
    // =====================================================================

    if (operation === 'list_stock') {
      const { page, pageSize, from, to } = stockPagination(body);
      const search = cleanText(body.search, 120);
      const organisationId = cleanText(body.organisation_id, 64);
      const availability = cleanText(body.availability_status, 40);
      const state = cleanText(body.state, 8);

      /*
       * THE ORDER IS THE NETWORK'S, AND THE PAGE SHAPE IS THIS DEPLOYMENT'S.
       *
       * `builder_network_stock_ranked` is the mirror plus the interleave bucket
       * that stops one builder owning a page — a window function, so it is part
       * of the ordering rather than a pass over rows that have already been
       * fetched, which could not help on a page that is already one builder's.
       * It drops exactly one thing: a property an operator explicitly
       * suppressed on the network.
       *
       * A row with no rank yet sorts at the NEUTRAL band with `created_at DESC`
       * behind it, so a deployment the ranking has not reached behaves exactly
       * as it did before this shipped rather than reshuffling into an arbitrary
       * order. Absent is never zero.
       */
      /*
       * `any`, as `withFilters` below and the rest of this runtime already
       * take these builders: what arrives is a filter builder, and
       * `ReturnType<typeof supabase.from>` is the QUERY builder it came from,
       * which carries no `.order`. Naming the wrong one failed to compile and
       * pushed an `as never` onto the call site to hide it.
       */
      const ordered = (query: any) => query
        .order('interleave_bucket', { ascending: true })
        .order('ranked_placement_order', { ascending: true })
        .order('ranked_band', { ascending: true })
        .order('ranked_item_score', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      /*
       * The order a deployment the ranking has not reached can actually ask
       * for. Every column `ordered` leads with is a ranking column, so using
       * it against the base table answers 42703 exactly as the view answered
       * 42P01 — the fallback would fail the same way it was added to survive.
       *
       * This is `created_at DESC`, which is what the marketplace ordered by
       * before ranking existed. It is not a good ordering — 47-builder-ranking
       * says so at length, it rewards whoever uploaded last — and it is the
       * honest one for a deployment that has no merit scores to sort on. The
       * answer says `ranked: false` so nothing presents it as merit.
       */
      const orderedUnranked = (query: any) => query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      const withFilters = (query: any) => {
        let next = query.eq('lifecycle_status', 'active');
        if (organisationId) next = next.eq('organisation_id', organisationId);
        if (availability) next = next.eq('availability_status', availability);
        if (state) next = next.eq('state', state);
        if (search) {
          const escaped = search.replace(/[%,()]/g, ' ');
          next = next.or(
            ['address_line', 'suburb', 'development_name', 'project_name', 'external_reference']
              .map((column) => `${column}.ilike.%${escaped}%`).join(','),
          );
        }
        return next;
      };

      /*
        THE RANKING IS AN IMPROVEMENT ON THE MARKETPLACE, NOT A CONDITION OF IT.

        `builder_network_stock_ranked` and the `rank_*` columns arrive with
        migration 20261202090000. Measured 19 Sep 2026, none of the three
        clones has it — the whole fleet stops at 20261123000000 — so this
        query answers PostgREST 42P01 and the tab, which has no other reading
        for a 500, said "Builder stock could not be loaded" over a mirror that
        may be perfectly full.

        A deployment without the ranking can still show a marketplace; what it
        cannot do is order it by merit. So the ranked read is attempted, a
        missing relation or column falls back to the base table in the order
        the marketplace used before ranking existed, and the answer SAYS which
        it was rather than presenting an unranked list as a ranked one.
      */
      let ranked = true;
      let { data, count, error } = await ordered(withFilters(
        supabase.from('builder_network_stock_ranked')
          .select(RANKED_ITEM_SELECT, { count: 'exact' }),
      )).range(from, to);

      if (error && isMissingRankingRelation(error)) {
        console.warn(
          '[builder-stock-marketplace] ranking not present on this deployment; '
          + 'serving the unranked marketplace:', error.message,
        );
        ranked = false;
        ({ data, count, error } = await orderedUnranked(withFilters(
          supabase.from('builder_network_stock_items')
            .select(STOCK_ITEM_SELECT, { count: 'exact' }),
        )).range(from, to));
      }

      if (error) {
        console.error('[builder-stock-marketplace] list failed', error.message);
        return json({ error: 'Builder stock could not be loaded.' }, 500);
      }

      /*
       * PINS ARE ABSOLUTE POSITIONS, SO THEY ARE PLACED AFTER THE PAGE IS CUT.
       *
       * "This builder sits at number one until the end of November" means
       * position one in the whole marketplace, not first among pinned rows — so
       * a pin at 27 has to land on whichever page holds index 26. They are read
       * separately (there are never many), spliced at their absolute positions
       * with the page's own offset applied, and the page is re-cut to its size
       * so the offsets of every later page stay true.
       *
       * A pinned row is excluded from the body query it would otherwise appear
       * in twice.
       */
      // No ranking means no pins: the column that records one does not exist.
      const pinnedRead = ranked
        ? await withFilters(
          supabase.from('builder_network_stock_ranked')
            .select(RANKED_ITEM_SELECT)
            .eq('rank_placement_kind', 'pinned'),
        ).order('rank_placement_position', { ascending: true })
        : { data: [] as unknown[], error: null };
      const pinned = (pinnedRead.data ?? []) as unknown as RankedRow[];
      const pinnedIds = new Set(pinned.map((row) => row.id));

      /*
       * NOT `body`. That name is the request payload, bound at the top of the
       * handler and read five lines into this branch — shadowing it here put
       * those reads in the temporal dead zone of this declaration, so every
       * `list_stock` call would have thrown `ReferenceError` before it reached
       * a query. The compiler saw it; a parse check could not.
       */
      const unpinned = ((data ?? []) as unknown as RankedRow[])
        .filter((row) => !pinnedIds.has(row.id));
      const paged = splicePinsIntoPage(unpinned, pinned, from, pageSize);

      const records = await decorate(supabase, paged as never[]);
      return json({
        success: true,
        records,
        /*
          WHICH ABSENCE AN EMPTY TAB IS.

          `builder_network_stock_*` is a MIRROR fed by the network's events, so
          an empty one on a clone with no link says nothing whatever about what
          builders have supplied — and the page used to read "No builder stock
          has been uploaded yet … when a builder uploads a stock list in their
          portal", pointing the reader at somebody else's deployment to fix
          something that is not broken there. See `mirrorAvailability.pure.ts`.

          Read on every list so the reading cannot go stale against the rows
          beside it; both queries are indexed single-row reads.
        */
        source: await readMirrorSource(supabase),
        /*
          Whether this marketplace is ordered by merit. False says the ranking
          migration has not reached this deployment — the list is real and the
          ORDER is not meaningful, which is a different thing from an error and
          a different thing from a ranked page.
        */
        ranked,
        /*
         * WHICH BUILDERS HOLD THE PROMOTED SLOTS IS DECIDED OVER THE WHOLE SET,
         * not per page, so it does not change as an adviser pages through.
         */
        /*
          `unpinned`, NOT `body`. The comment above renamed this array away
          from `body` to get it out of the request payload's temporal dead
          zone, and this call was left behind pointing at the payload object —
          which carries no `rank_placement_kind`, so `promotedOrganisations`
          skipped it and the list came back EMPTY on every request. A
          commercial placement that `builder_stock_item_ranks_disclosure`
          refuses to store undisclosed was then never disclosed.
        */
        promoted_organisations: promotedOrganisations(pinned.concat(unpinned)),
        pagination: {
          page, page_size: pageSize, total: count ?? 0,
          total_pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    /**
     * THE PROPERTY PAGE'S READ. The same decorated record a card is drawn
     * from, and beside it the property's photographs and documents (from the
     * media converger's tables) and its activation record. A client is named
     * only to a reader the Clients module admits — the gate `list_selections`
     * applies — and nothing here is composed by a model.
     */
    if (operation === 'get_stock_item') {
      const item = await loadReadableItem(cleanText(body.stock_item_id, 64));
      if (!item) return json({ error: 'Property not found' }, 404);
      const [record] = await decorate(supabase, [item]);
      const clientsView = await requireModulePermission(supabase, actor, 'clients', 'can_view');
      const detail = await readPropertyDetail(supabase, item, { includeClients: clientsView.ok });
      return json({ success: true, record, ...detail });
    }

    if (operation === 'list_builders') {
      // The organisations that actually have live stock, for the filter. A
      // full builder directory is not this endpoint's business.
      // Paged: the API caps a response at 1,000 rows whatever `.limit()` says,
      // and a truncated read here drops builders out of the filter entirely.
      const builderPage = await readAllRows<{ organisation_id: string }>(
        () => supabase
          .from('builder_network_stock_items')
          .select('organisation_id')
          .eq('lifecycle_status', 'active')
          .order('id', { ascending: true }));
      const ids = Array.from(new Set(builderPage.rows.map((row) => row.organisation_id)));
      if (!ids.length) return json({ success: true, records: [] });
      const { data: organisations } = await supabase
        .from('builder_network_stock_organisations')
        .select('id, legal_name, trading_name')
        .in('id', ids);
      return json({ success: true, records: organisations ?? [] });
    }

    if (operation === 'image_url') {
      const { data: image } = await supabase
        .from('builder_network_stock_item_images')
        .select('id, stock_item_id, source_stage, verification_status, processing_status, storage_bucket, storage_path, external_url, source_detail')
        .eq('id', cleanText(body.image_id, 64))
        .maybeSingle();
      if (!image) return json({ error: 'Image not found' }, 404);

      /**
       * THE RULE IS ENFORCED WHERE THE BYTES ARE SERVED, not only where the
       * pointer is chosen.
       *
       * `primary_image_id` decides what a card asks for, and `primaryImage.ts`
       * is careful about how it is chosen — but this endpoint took any image id
       * and minted a signed URL for it on a service-role client. That included
       * the rows the re-audit had just DEMOTED for being unprovable, which is
       * precisely the class of picture the whole rule exists to keep off a
       * client's screen, and images belonging to stock no marketplace surface
       * will list. The same predicate the card applies is applied here, so
       * "no proven primary means no image" holds at the boundary that actually
       * hands over bytes.
       */
      /*
       * THE SAME PREDICATE THE CARD APPLIES, WHICH IS NOW THE RANKING. A
       * verified web photograph and a Street View still of the property's own
       * address are card images, so this endpoint must be able to sign them —
       * and it must still refuse everything else, including the 439
       * `unverified` search rows that have never been checked against a
       * property and every demoted source row. `rankImage` answers null for
       * all of them. See `imagePriority.pure.ts`.
       */
      if (!rankImage(image as DisplayableImage)) {
        return json({ error: 'Image not found' }, 404);
      }
      /**
       * An image the document carried but attributed to NOBODY is stored
       * against the upload with a null `stock_item_id` — the page declining to
       * say whose house that is. It belongs to no property, so it is served to
       * nobody, and asking the question explicitly beats sending `id=eq.null`.
       */
      if (!image.stock_item_id) return json({ error: 'Image not found' }, 404);
      const { data: owner } = await supabase
        .from('builder_network_stock_items')
        .select('id')
        .eq('id', image.stock_item_id)
        .eq('lifecycle_status', 'active')
        .maybeSingle();
      if (!owner) return json({ error: 'Image not found' }, 404);

      if (image.external_url && !image.storage_path) {
        return json({ success: true, url: image.external_url, external: true });
      }

      /**
       * THE FROZEN DERIVATIVE, WHEN THERE IS ONE — NEVER A REPAIR AT REQUEST
       * TIME.
       *
       * Where the builder laid a promotional graphic over their own photograph,
       * the repair ran once, in the settler, and the result is an object in the
       * bucket. This endpoint reads a record and signs a path; it decodes
       * nothing, calls no model and generates nothing. A card that triggered a
       * repair would repair the same picture on every render, spend a vendor
       * key every time, and hand two viewers two different images.
       *
       * `derivativeToServe` is built from the same calls the card's own filter
       * makes, so the two cannot disagree about which object this is. It
       * resolves only while the record still names the SHA-256 the row holds,
       * so a replaced original falls back to the original — which the gate
       * above has already decided is displayable. And it resolves to NOTHING
       * for an image whose original is itself judged clean (an eligible
       * verdict or a clearance beside an old repair): the builder's own file
       * outranks a repaired copy of it wherever both stand, exactly as the
       * card ordering already prefers clean-original rows.
       */
      const derivative = derivativeToServe(image);
      const bucket = derivative?.storage_bucket
        || image.storage_bucket || STOCK_IMAGE_BUCKET;
      const path = derivative?.storage_path || image.storage_path;

      const { data: signed, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, IMAGE_URL_TTL_SECONDS);
      if (error || !signed?.signedUrl) return json({ error: 'The image could not be prepared' }, 502);
      return json({
        success: true,
        url: signed.signedUrl,
        expires_in: IMAGE_URL_TTL_SECONDS,
        // Disclosed rather than hidden: a repaired photograph is the builder's
        // own picture with an overlay removed, and a surface that wants to say
        // so can.
        sanitized: derivative ? derivative.transformation : null,
      });
    }

    if (operation === 'search_clients') {
      // The picker for "select for a client". Gated on the CLIENTS module, not
      // on listings — a user who may see the marketplace is not thereby
      // entitled to a directory of clients. Two columns and no more.
      const clientsView = await requireModulePermission(supabase, actor, 'clients', 'can_view');
      if (!clientsView.ok) {
        return createForbiddenResponse(clientsView.error || 'Client access required', corsHeaders);
      }
      const search = cleanText(body.search, 80);
      let query = supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email')
        .order('primary_surname', { ascending: true })
        .limit(25);
      if (search) {
        const escaped = search.replace(/[%,()]/g, ' ');
        query = query.or(
          ['primary_first_name', 'primary_surname', 'primary_email']
            .map((column) => `${column}.ilike.%${escaped}%`).join(','),
        );
      }
      const { data } = await query;
      return json({ success: true, records: data ?? [] });
    }

    if (operation === 'list_selections') {
      // Gated on the CLIENTS module, like `search_clients` and unlike the
      // stock reads: this returns `client_id`, the client's name and the
      // Command Centre's `internal_notes`. `listings.can_view` alone was
      // enough to reach all three, which let a user with Marketplace access
      // but no Clients access read both.
      const clientsView = await requireModulePermission(supabase, actor, 'clients', 'can_view');
      if (!clientsView.ok) {
        return createForbiddenResponse(clientsView.error || 'Client access required', corsHeaders);
      }

      const { page, pageSize, from, to } = stockPagination(body);
      const clientId = cleanText(body.client_id, 64);
      const stockItemId = cleanText(body.stock_item_id, 64);

      let query = supabase
        .from('builder_stock_selections')
        .select(COMMAND_SELECTION_SELECT, { count: 'exact' });
      if (clientId) query = query.eq('client_id', clientId);
      if (stockItemId) query = query.eq('stock_item_id', stockItemId);

      const { data, count } = await query
        .order('selected_at', { ascending: false })
        .range(from, to);

      const selections = data ?? [];
      const itemIds = Array.from(new Set(selections.map((row: any) => row.stock_item_id)));
      const clientIds = Array.from(new Set(selections.map((row: any) => row.client_id)));
      const organisationIds = Array.from(new Set(selections.map((row: any) => row.organisation_id)));

      const [{ data: items }, { data: clients }, { data: organisations }] = await Promise.all([
        itemIds.length
          ? supabase.from('builder_network_stock_items').select(STOCK_ITEM_SELECT).in('id', itemIds)
          : Promise.resolve({ data: [] }),
        clientIds.length
          ? supabase.from('clients')
            .select('id, primary_first_name, primary_surname').in('id', clientIds)
          : Promise.resolve({ data: [] }),
        organisationIds.length
          ? supabase.from('builder_network_stock_organisations')
            .select('id, legal_name, trading_name').in('id', organisationIds)
          : Promise.resolve({ data: [] }),
      ]);

      const itemById = new Map((items ?? []).map((row: any) => [row.id, row]));
      const clientById = new Map((clients ?? []).map((row: any) => [row.id, row]));
      const organisationById = new Map((organisations ?? []).map((row: any) => [row.id, row]));

      return json({
        success: true,
        records: selections.map((row: any) => ({
          ...row,
          stock_item: itemById.get(row.stock_item_id) ?? null,
          client: clientById.get(row.client_id) ?? null,
          builder_organisation: organisationById.get(row.organisation_id) ?? null,
        })),
        pagination: {
          page, page_size: pageSize, total: count ?? 0,
          total_pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
        },
      });
    }

    /*
     * =====================================================================
     * Supplying a picture on the builder's behalf — MOVED
     * =====================================================================
     *
     * These two operations were the Command Centre performing the Builder
     * Portal's own act: registering an object with the portal's image
     * pipeline (upload row, verification, the settler's queue). Phase 7 of
     * the network extraction deletes that pipeline with the portal — the
     * mirror's rows arrive already processed from the Builders Network — so
     * writing to it here would be writing to tables scheduled for deletion,
     * work nothing would ever settle. The permission gate stays so an
     * unauthorised probe sees exactly what it always saw.
     */
    if (operation === 'supply_builder_image' || operation === 'create_builder_image_upload') {
      const listingsEdit = await requireModulePermission(supabase, actor, 'listings', 'can_edit');
      if (!listingsEdit.ok) {
        return createForbiddenResponse(
          listingsEdit.error || 'Listing edit access required', corsHeaders);
      }
      return json({
        error: 'Stock imagery is managed on the Builders Network now. '
          + 'Ask the builder to update their property\'s photographs at '
          + 'builders.aurixasystems.com.au — the marketplace serves the network\'s imagery.',
        code: 'builder_stock_images_moved',
      }, 410);
    }

    // =====================================================================
    // The builder conversation — messages about an activated property,
    // carried to the builder over the signed network. Read under the Listings
    // gate every operation passes; writing needs Listings edit. The sender is
    // the session's user; the property is a lookup key the SQL re-resolves.
    // =====================================================================

    const conversationRefusal = (error: { message?: string } | null) => {
      const refusal = agencyMessageRefusal(String(error?.message ?? ''));
      if (refusal) return json({ success: false, error: refusal.error, code: refusal.code }, refusal.status);
      console.error('[builder-stock-marketplace] builder message failed', error?.message);
      return json({ success: false, error: 'The message could not be saved. Try again shortly.' }, 503);
    };
    const uuidOf = (value: unknown): string | null => {
      const text = cleanText(value, 64).toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) ? text : null;
    };

    // =====================================================================
    // Builder conversations — one private conversation per activation
    // (docs/builder-portal/52). Membership decides every read and write; the
    // SQL is the authority and each operation names only a conversation (and,
    // to invite, a colleague). The actor is always the session's user.
    // =====================================================================
    const notAParticipant = () => json({
      success: false, code: 'not_a_participant', error: 'You are not in this conversation.',
    }, 403);

    if (operation === 'list_builder_portal_activations') {
      // Taken BEFORE the read: marking read later reaches only what this list could show.
      const asOf = new Date().toISOString();
      const read = await listActivatedProperties(supabase, { viewerUserId: userId });
      if (!read.ok) return json({ success: false, error: 'activations_could_not_be_read' }, 503);
      return json({ success: true, activations: read.activations, as_of: asOf });
    }

    // The Builder Portal badge: the reader's own unread acknowledgements,
    // counted here because the bell holds only its newest fifty.
    if (operation === 'count_activation_acknowledgements') {
      const read = await countUnreadAcknowledgementNotices(supabase, { viewerUserId: userId });
      if (!read.ok) return json({ success: false, error: 'acknowledgements_could_not_be_counted' }, 503);
      return json({ success: true, count: read.count });
    }

    if (operation === 'mark_activation_acknowledgements_read') {
      const asOf = typeof body.as_of === 'string' ? body.as_of : '';
      if (!Number.isFinite(Date.parse(asOf))) return json({ success: false, error: 'as_of_required' }, 400);
      const done = await markAcknowledgementNoticesRead(supabase, { viewerUserId: userId, asOf });
      if (!done.ok) return json({ success: false, error: 'acknowledgements_could_not_be_marked' }, 503);
      return json({ success: true });
    }

    // The "new message from <builder>" popup: builder messages that arrived
    // after the cursor, in the reader's own conversations. Read-only.
    if (operation === 'list_new_builder_messages') {
      const since = typeof body.since === 'string' && Number.isFinite(Date.parse(body.since)) ? body.since : null;
      const read = await newBuilderMessages(supabase, { viewerUserId: userId, since });
      if (!read.ok) return json({ success: false, error: 'messages_could_not_be_read' }, 503);
      return json({ success: true, cursor: read.cursor, messages: read.messages });
    }

    if (operation === 'list_my_builder_conversations') {
      const stockItemId = uuidOf(body.stock_item_id);
      const read = stockItemId
        ? await listPropertyConversations(supabase, { stockItemId, viewerUserId: userId })
        : await listMyConversations(supabase, { viewerUserId: userId });
      if (!read.ok) return json({ success: false, error: 'conversations_could_not_be_read' }, 503);
      return json({ success: true, conversations: read.conversations });
    }

    if (operation === 'get_builder_conversation') {
      const conversationId = uuidOf(body.conversation_id);
      if (!conversationId) return json({ error: 'Conversation not found' }, 404);
      // A history cursor, where one is asked for: the page before that message.
      const read = await readParticipantConversation(supabase, {
        conversationId, viewerUserId: userId, beforeMessageId: uuidOf(body.before_message_id),
      });
      if (!read.ok) {
        if (read.reason === 'not_found') return json({ error: 'Conversation not found' }, 404);
        if (read.reason === 'not_a_participant') return notAParticipant();
        return json({ success: false, error: 'conversation_could_not_be_read' }, 503);
      }
      const listingsEdit = await requireModulePermission(supabase, actor, 'listings', 'can_edit');
      const networkOn = await builderNetworkEnabled(supabase);
      // Every gate the send, retry and invite functions enforce, so no button
      // is offered that the server would refuse.
      const canSend = read.open && listingsEdit.ok && networkOn;
      const mine = read.participants.filter((p) => p.side === 'command_centre');
      // Live is the database's rule for leaving: the conversation is open.
      // Only then must someone on this side stay.
      const live = read.open;
      return json({
        success: true,
        conversation_id: read.conversation_id,
        stock_item_id: read.stock_item_id,
        address: read.address,
        lot_number: read.lot_number,
        builder_name: read.builder_name,
        open: read.open,
        closed_reason: read.closed_reason,
        can_send: canSend,
        can_invite: read.open && listingsEdit.ok && networkOn,
        // A live conversation keeps someone on this side; a closed one can be
        // left freely. The server decides again when asked.
        can_leave: !live || mine.length > 1,
        participants: read.participants,
        messages: read.messages.map((message) => ({ ...message, can_retry: message.can_retry && canSend })),
        has_earlier: read.has_earlier,
        earlier_cursor: read.earlier_cursor,
      });
    }

    if (operation === 'send_builder_message') {
      const listingsEdit = await requireModulePermission(supabase, actor, 'listings', 'can_edit');
      if (!listingsEdit.ok) {
        return createForbiddenResponse(listingsEdit.error || 'Listing edit access required', corsHeaders);
      }
      const conversationId = uuidOf(body.conversation_id);
      if (!conversationId) return json({ error: 'Conversation not found' }, 404);
      const clientMessageId = uuidOf(body.client_message_id);
      if (!clientMessageId) {
        return json({ success: false, error: 'A message needs its own id.', code: 'invalid_message' }, 400);
      }
      const { data, error } = await supabase.rpc('builder_network_post_message', {
        _conversation_id: conversationId,
        _sender_user_id: userId,
        _client_message_id: clientMessageId,
        _body: String(body.body ?? '').slice(0, 8000),
      });
      if (error) return conversationRefusal(error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      return json({ success: true, message: row ? projectConversationMessages([row], userId)[0] : null });
    }

    if (operation === 'retry_builder_message') {
      const listingsEdit = await requireModulePermission(supabase, actor, 'listings', 'can_edit');
      if (!listingsEdit.ok) {
        return createForbiddenResponse(listingsEdit.error || 'Listing edit access required', corsHeaders);
      }
      const messageId = uuidOf(body.message_id);
      if (!messageId) return json({ error: 'Message not found' }, 404);
      const { data, error } = await supabase.rpc('builder_network_retry_message', {
        _message_id: messageId,
        _sender_user_id: userId,
      });
      if (error) return conversationRefusal(error);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      return json({ success: true, message: row ? projectConversationMessages([row], userId)[0] : null });
    }

    if (operation === 'list_builder_conversation_invitees') {
      const conversationId = uuidOf(body.conversation_id);
      if (!conversationId) return json({ error: 'Conversation not found' }, 404);
      // Every eligible colleague, read a page at a time: a response ceiling
      // must never make somebody uninvitable.
      const invitees: Array<{ user_id: string; display_name: string }> = [];
      for (let from = 0; ; from += INVITEE_PAGE) {
        const { data, error } = await supabase.rpc('builder_network_invite_candidates', {
          _conversation_id: conversationId,
          _actor_user_id: userId,
        }).range(from, from + INVITEE_PAGE - 1);
        if (error) return conversationRefusal(error);
        const page = (data ?? []) as Array<{ user_id: string; display_name: string }>;
        invitees.push(...page.map((row) => ({ user_id: String(row.user_id), display_name: String(row.display_name) })));
        if (page.length < INVITEE_PAGE) break;
      }
      return json({ success: true, invitees });
    }

    if (operation === 'invite_builder_conversation_participant') {
      const listingsEdit = await requireModulePermission(supabase, actor, 'listings', 'can_edit');
      if (!listingsEdit.ok) {
        return createForbiddenResponse(listingsEdit.error || 'Listing edit access required', corsHeaders);
      }
      const conversationId = uuidOf(body.conversation_id);
      const inviteeId = uuidOf(body.invitee_user_id);
      if (!conversationId) return json({ error: 'Conversation not found' }, 404);
      if (!inviteeId) {
        return json({ success: false, code: 'invitee_not_eligible', error: 'That person cannot be added to this conversation.' }, 422);
      }
      // The invitee is a lookup key: whether they may join is decided by the
      // database from this workspace's own rows.
      const { data, error } = await supabase.rpc('builder_network_invite_participant', {
        _conversation_id: conversationId,
        _actor_user_id: userId,
        _invitee_user_id: inviteeId,
      });
      if (error) return conversationRefusal(error);
      return json({ success: true, result: String(data) });
    }

    if (operation === 'leave_builder_conversation') {
      const conversationId = uuidOf(body.conversation_id);
      if (!conversationId) return json({ error: 'Conversation not found' }, 404);
      // Leaving names only the person leaving: there is no operation that
      // removes somebody else.
      const { data, error } = await supabase.rpc('builder_network_leave_conversation', {
        _conversation_id: conversationId,
        _actor_user_id: userId,
      });
      if (error) return conversationRefusal(error);
      return json({ success: true, result: String(data) });
    }

    // =====================================================================
    // The selection — the write that activates the builder
    // =====================================================================

    if (operation === 'select_for_client') {
      const clientsEdit = await requireModulePermission(supabase, actor, 'clients', 'can_edit');
      if (!clientsEdit.ok) {
        return createForbiddenResponse(
          clientsEdit.error || 'Client edit access required', corsHeaders);
      }

      const item = await loadItem(cleanText(body.stock_item_id, 64));
      if (!item) return json({ error: 'Property not found' }, 404);
      if (!isSelectableAvailability(item.availability_status)) {
        return json({
          error: 'That property is no longer available.',
          code: 'not_available',
        }, 409);
      }

      // The client id is validated against the database, not trusted.
      const clientId = cleanText(body.client_id, 64);
      const { data: client } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname')
        .eq('id', clientId)
        .maybeSingle();
      if (!client) return json({ error: 'Client not found' }, 404);

      // A live selection already exists for this pair.
      const { data: existing } = await supabase
        .from('builder_stock_selections')
        .select(COMMAND_SELECTION_SELECT)
        .eq('stock_item_id', item.id)
        .eq('client_id', client.id)
        .neq('status', 'withdrawn')
        .maybeSingle();
      if (existing) {
        return json({
          success: true, record: existing, already_selected: true,
        });
      }

      const { data: selection, error } = await supabase
        .from('builder_stock_selections')
        .insert({
          stock_item_id: item.id,
          // Resolved, not accepted. The database trigger checks it again.
          organisation_id: item.organisation_id,
          source_upload_id: item.upload_id ?? null,
          // Also resolved from the item, never from the request. The mirror
          // carries the uploader on the item itself (`created_by_builder_user_id`,
          // stamped at intake) — the upload row it once cross-read retires with
          // the portal's pipeline.
          builder_project_id: item.builder_project_id ?? null,
          originating_builder_user_id: item.created_by_builder_user_id ?? null,
          client_id: client.id,
          selected_by_user_id: userId,
          status: 'selected',
          internal_notes: cleanText(body.notes, 2000) || null,
          builder_reference: cleanText(body.builder_reference, 120) || null,
        })
        .select(COMMAND_SELECTION_SELECT)
        .single();
      if (error) {
        console.error('[builder-stock-marketplace] selection insert failed', error.message);
        return json({ error: 'The selection could not be saved.' }, 400);
      }

      /*
       * The in-portal notification went with the portal: `builder_notifications`
       * had no reader once /builder/* moved to the Builders Network, so writing
       * one would tell nobody anything. The selection row IS the activation —
       * telling the builder over the network connection is the sync's job once
       * E4 ships, not a write into a feed nobody can open.
       */
      return json({ success: true, record: selection });
    }

    if (operation === 'set_selection_status') {
      const clientsEdit = await requireModulePermission(supabase, actor, 'clients', 'can_edit');
      if (!clientsEdit.ok) {
        return createForbiddenResponse(
          clientsEdit.error || 'Client edit access required', corsHeaders);
      }

      const status = cleanText(body.status, 40);
      if (!(COMMAND_SELECTION_STATUSES as readonly string[]).includes(status)) {
        return json({ error: 'That status is not recognised' }, 400);
      }

      const selectionId = cleanText(body.selection_id, 64);
      const { data: selection } = await supabase
        .from('builder_stock_selections')
        .select('id, status')
        .eq('id', selectionId)
        .maybeSingle();
      if (!selection) return json({ error: 'Selection not found' }, 404);

      const { data, error } = await supabase
        .from('builder_stock_selections')
        .update({
          status,
          withdrawn_at: status === 'withdrawn' ? new Date().toISOString() : null,
          ...(body.notes !== undefined ? { internal_notes: cleanText(body.notes, 2000) || null } : {}),
        })
        .eq('id', selection.id)
        .select(COMMAND_SELECTION_SELECT)
        .single();
      if (error) return json({ error: 'The selection could not be updated.' }, 400);
      return json({ success: true, record: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[builder-stock-marketplace] unhandled', error);
    return new Response(
      JSON.stringify(internalError(error, 'builder-stock-marketplace')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

/** Images and builder identity for a page of stock. Two queries, not 2N. */
/**
 * What this workspace can say about the link its stock mirror is fed by.
 *
 * Deliberately narrow: the CONNECTION's state and whether anything has ever
 * arrived. Nothing here decides what to render — `readStockEmptyState` does
 * that, once, so the tab and any future surface cannot word the same absence
 * two ways.
 *
 * Both reads FAIL to `unknown` rather than to `none`: "we could not tell" and
 * "there is no link" send an administrator to opposite places, and only one of
 * them is a job.
 */
async function readMirrorSource(supabase: any): Promise<MirrorSource> {
  try {
    const [connectionRead, freshest] = await Promise.all([
      supabase
        .from('builder_network_connections')
        .select('state')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('builder_network_stock_items')
        .select('last_seen_at')
        .not('last_seen_at', 'is', null)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (connectionRead.error) {
      console.warn('[builder-stock-marketplace] connection read failed', connectionRead.error.message);
      return { connection: 'unknown', lastSyncedAt: null };
    }

    const state = connectionRead.data?.state as string | undefined;
    const connection: MirrorSource['connection'] = state === 'active'
      ? 'active'
      : state === 'revoked'
        ? 'revoked'
        // No row at all is a workspace that was never linked. An 'invited' row
        // is a link nobody has completed, which delivers nothing either — the
        // same thing to read and the same act to finish.
        : state === undefined || state === 'invited'
          ? 'none'
          : 'unknown';

    return {
      connection,
      lastSyncedAt: freshest.error ? null : (freshest.data?.last_seen_at ?? null),
    };
  } catch (e) {
    console.warn('[builder-stock-marketplace] mirror source read threw', e);
    return { connection: 'unknown', lastSyncedAt: null };
  }
}

async function decorate(supabase: any, items: any[]): Promise<any[]> {
  if (!items.length) return [];
  /*
   * THE BUILDER'S OWN FIGURES, LAID OVER THE DOCUMENT'S, ONCE AND HERE.
   *
   * Applied to the incoming rows rather than inside the mapper below, so
   * everything downstream — the spread, the eligibility reading, anything
   * added later — sees the effective property rather than the extraction.
   * Both read paths do exactly this, and the "every read path
   * applies the overlay" case in `builderStockManualStats.test.ts` reads both
   * sources and fails either one that stops.
   */
  items = applyManualStatsToAll(items);
  const ids = items.map((item) => item.id);
  const organisationIds = Array.from(new Set(items.map((item) => item.organisation_id)));

  const [{ data: images }, { data: organisations }, { data: selections }] = await Promise.all([
    supabase.from('builder_network_stock_item_images')
      .select(STOCK_IMAGE_SELECT)
      .in('stock_item_id', ids)
      .order('position', { ascending: true }),
    supabase.from('builder_network_stock_organisations')
      .select('id, legal_name, trading_name')
      .in('id', organisationIds),
    // No `client_id`. The card needs to know a property IS spoken for and at
    // what stage, not for whom — and `list_stock` is reachable on
    // `listings.can_view` alone, which does not entitle the caller to client
    // identifiers. `list_selections` is where a selection's client is read,
    // behind the Clients module.
    supabase.from('builder_stock_selections')
      .select('id, stock_item_id, status, selected_at')
      .in('stock_item_id', ids)
      .neq('status', 'withdrawn'),
  ]);

  const imagesByItem = new Map<string, any[]>();
  for (const image of images ?? []) {
    const list = imagesByItem.get(image.stock_item_id) ?? [];
    list.push(image);
    imagesByItem.set(image.stock_item_id, list);
  }
  const organisationById = new Map((organisations ?? []).map((row: any) => [row.id, row]));
  const selectionsByItem = new Map<string, any[]>();
  for (const selection of selections ?? []) {
    const list = selectionsByItem.get(selection.stock_item_id) ?? [];
    list.push(selection);
    selectionsByItem.set(selection.stock_item_id, list);
  }

  return items.map((item) => ({
    ...item,
    images: imagesByItem.get(item.id) ?? [],
    builder_organisation: organisationById.get(item.organisation_id) ?? null,
    selections: selectionsByItem.get(item.id) ?? [],
  }));
}
