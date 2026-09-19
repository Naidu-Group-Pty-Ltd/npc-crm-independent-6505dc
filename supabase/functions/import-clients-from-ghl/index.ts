import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { enforceRawBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { mapWithConcurrency } from '../_shared/boundedConcurrency.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/**
 * A wall-clock budget, so `maxPages` stops being the only thing that ends a
 * walk.
 *
 * A page is four statements plus a bounded-concurrency set of updates, so a
 * few thousand contacts fit comfortably — but an account this never finishes
 * must say so rather than be cut off by the platform mid-page, because a run
 * the platform kills reports nothing at all and the caller cannot tell it
 * from one that completed.
 */
const BUDGET_MS = 95_000;

/** Non-destructive patches differ per row, so they are parallelised rather than batched. */
const UPDATE_CONCURRENCY = 8;

interface GHLContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  dateAdded: string;
  customFields?: Array<{
    id: string;
    /** v2 of the API returns `key`; v1 returned only `id`. Both are read. */
    key?: string;
    value: string;
  }>;
  tags?: string[];
  /**
   * GHL's own attribution for the contact, used as the fallback `utm_source`.
   * It was read by the import from the first version and never declared here,
   * so `contact.source` was two standing `TS2339`s — the code was right and
   * the type was wrong.
   */
  source?: string | null;
}

interface GHLContactsResponse {
  contacts: GHLContact[];
  meta: {
    total: number;
    nextPageUrl: string | null;
    startAfterId: string | null;
    startAfter: number | null;
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const startedAt = Date.now();
  const outOfBudget = () => Date.now() - startedAt > BUDGET_MS;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[import-clients-from-ghl] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      console.error('GHL credentials not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel credentials not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The signature covers a hash of the raw bytes, so the body is read once
    // as text and parsed from that — `req.json()` consumes the stream and
    // leaves nothing for `verifySignedInternal` to hash.
    const bounded = await enforceRawBodyLimit(req, 8192);
    if (!bounded.ok) return bounded.error;
    let body: any = {};
    try { body = bounded.raw ? JSON.parse(bounded.raw) : {}; } catch { body = {}; }

    /*
     * A scheduled caller, because nothing scheduled could reach this before.
     *
     * This import ran only when somebody opened the Clients page, and the
     * periodic auto-sync beside it asked for five pages — exactly the 500
     * contacts the NPC Client Dashboard held on 13 Sep 2026, against 776 in
     * the same GHL location on the prime. The conversation sync follows
     * contacts, so 276 missing clients were also ~960 missing conversations.
     *
     * `cron_invoke_signed_function` sends a signed internal envelope and the
     * anon key for the gateway — no user JWT — so the admin path below could
     * never have admitted it. The admin path is untouched: a person running
     * this by hand still has to be an admin.
     */
    const internal = await verifySignedInternal(supabase, req, bounded.raw, ['pg_cron']);
    if (!internal.ok) {
      // SECURITY: Verify authentication (admin-only for import operations)
      const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
      if (authError) {
        console.log('[import-clients-from-ghl] Auth failed:', authError);
        return createUnauthorizedResponse(authError, corsHeaders);
      }
      console.log('[import-clients-from-ghl] Authenticated user:', userId);

      // Check if user is admin (import operations should be admin-only)
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['superadmin', 'admin'])
        .single();

      if (!roleData) {
        console.log('[import-clients-from-ghl] User is not admin');
        return new Response(JSON.stringify({
          error: 'Unauthorized: Admin access required',
          success: false
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log(`[import-clients-from-ghl] Signed internal caller: ${internal.actorId}`);
    }

    const {
      resumeFromId = null,
      resumeFrom = null,
      // 50 pages is 5,000 contacts. The old 10 was chosen against a page that
      // cost 200-400 serialized queries; a page is four statements now, so the
      // wall clock above is the real limit and this is only a ceiling.
      maxPages = 50,
    } = body;

    /*
     * Clearing is a HUMAN act, and never a scheduled one.
     *
     * `clearExisting` deletes every client before re-importing. A scheduled
     * caller that could ask for that turns one bad GHL response into an empty
     * Clients page with nobody watching, so the flag is read from the body
     * only on the operator path.
     */
    const clearExisting: boolean = internal.ok ? false : (body?.clearExisting === true);

    console.log(
      `Starting GHL contact import. Clear existing: ${clearExisting}, Resume from: ${resumeFromId || 'start'} (${resumeFrom || 'no-timestamp'}), Max pages: ${maxPages}`,
    );

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    };

    // Clear existing clients ONLY if requested AND this is the first batch (no resumeFromId)
    if (clearExisting && !resumeFromId) {
      console.log('Clearing existing client data...');
      
      // Delete in order due to foreign key constraints
      await supabase.from('client_tag_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_activities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_reminders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_files').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_notes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_liabilities').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_assets').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_income').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_employment').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_properties').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('client_import_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('clients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      console.log('Existing client data cleared');
    }

    // Process contacts page by page - SAVE IMMEDIATELY after each page
    // NOTE: GHL pagination requires BOTH startAfter (timestamp cursor) and startAfterId (tie-breaker).
    let startAfterId: string | null = resumeFromId;
    let startAfter: number | null = typeof resumeFrom === 'number' ? resumeFrom : null;
    let pageCount = 0;
    let totalImported = 0;
    let totalErrors = 0;
    const errors: string[] = [];
    let totalFromApi = 0;

    let stoppedOnBudget = false;

    while (pageCount < maxPages) {
      // Asked BEFORE a page is fetched, so a page is never half-written. The
      // cursor below still points at the last page that completed, so the
      // caller resumes exactly here.
      if (outOfBudget()) {
        stoppedOnBudget = true;
        console.log(`[import-clients-from-ghl] wall-clock budget reached after ${pageCount} page(s)`);
        break;
      }
      pageCount++;

      // Build request using both cursors (startAfter + startAfterId)
      let url = `${GHL_API_BASE}/contacts/?locationId=${locationId}&limit=100`;
      if (typeof startAfter === 'number') url += `&startAfter=${startAfter}`;
      if (startAfterId) url += `&startAfterId=${startAfterId}`;

      console.log(`Fetching GHL contacts page ${pageCount}: ${url}`);

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`GHL API error: ${response.status} - ${errorText}`);
        throw new Error(`GHL API error: ${response.status} - ${errorText}`);
      }

      const data: GHLContactsResponse = await response.json();
      const contacts = data.contacts || [];

      // Capture total from first page only if starting fresh
      if (pageCount === 1 && !resumeFromId && data.meta?.total) {
        totalFromApi = data.meta.total;
        console.log(`GHL reports total contacts: ${totalFromApi}`);
      }

      console.log(
        `Received ${contacts.length} contacts from GHL (page ${pageCount}). meta.startAfter=${data.meta?.startAfter ?? 'null'} meta.startAfterId=${data.meta?.startAfterId ?? 'null'}`,
      );

      if (contacts.length === 0) {
        console.log('No more contacts to fetch');
        startAfter = null;
        startAfterId = null;
        break;
      }

      /**
       * THIS PAGE USED TO COST 2-4 SEQUENTIAL ROUND TRIPS PER CONTACT.
       *
       * Per contact it ran, one after another: a SELECT by `ghl_contact_id`,
       * then for a miss a SELECT by `primary_email`, then an INSERT or UPDATE,
       * then sometimes an INSERT into `lead_source_attributions`. At 100
       * contacts a page that is 200-400 serialized queries, each paying the
       * full edge-to-Postgres latency, and none of them depending on the one
       * before it.
       *
       * It is now four statements plus a bounded parallel update:
       *   1. one SELECT ... IN over the page's ghl_contact_ids
       *   2. one SELECT ... IN over the emails not matched by (1)
       *   3. one bulk INSERT of the genuinely new clients
       *   4. one bulk INSERT of their attributions
       * with the non-destructive UPDATEs — which cannot be batched, because
       * each patch is computed against that row's own current values — run
       * `UPDATE_CONCURRENCY` at a time instead of one at a time.
       *
       * Two things this must not lose. Per-contact ERROR REPORTING: a bulk
       * insert fails whole, so a failure falls back to inserting that page's
       * rows individually, which is slow exactly once and keeps every good row
       * and names the bad one. And DEDUPLICATION WITHIN THE PAGE: the old code
       * re-queried for every contact, so two GHL contacts sharing an email in
       * the same page could not both be treated as new. A batched read is
       * taken once, before any write, so the page has to carry that rule
       * itself — `seenEmails` below — or the import creates the duplicate it
       * exists to prevent.
       */
      let savedCount = 0;

      const EXISTING_COLUMNS =
        'id, primary_first_name, primary_surname, primary_email, primary_mobile, current_address, current_suburb, current_state, current_postcode, country';

      const ghlAddressOf = (contact: GHLContact) =>
        [contact.address1, contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ') || null;

      const clientDataOf = (contact: GHLContact) => ({
        primary_first_name: contact.firstName || 'Unknown',
        primary_surname: contact.lastName || 'Unknown',
        primary_email: contact.email || null,
        primary_mobile: contact.phone || null,
        current_address: ghlAddressOf(contact),
        current_suburb: contact.city || null,
        current_state: contact.state || null,
        current_postcode: contact.postalCode || null,
        country: contact.country || 'Australia',
        ghl_contact_id: contact.id,
        ghl_sync_status: 'synced',
        ghl_last_synced_at: new Date().toISOString(),
      });

      // Non-destructive update payload for EXISTING clients.
      // GHL is not the source of truth for a client record that staff maintain
      // in the Command Centre: a background auto-sync must never revert a
      // locally edited address, name, email or phone with a stale GHL value.
      // Only fill fields that are currently blank. New clients (insert path)
      // seed everything.
      const buildNonDestructivePatch = (contact: GHLContact, existing: Record<string, any> | null) => {
        const patch: Record<string, any> = {
          ghl_contact_id: contact.id,
          ghl_sync_status: 'synced',
          ghl_last_synced_at: new Date().toISOString(),
        };
        const candidates: Record<string, any> = {
          primary_first_name: contact.firstName || null,
          primary_surname: contact.lastName || null,
          primary_email: contact.email || null,
          primary_mobile: contact.phone || null,
          current_address: ghlAddressOf(contact),
          current_suburb: contact.city || null,
          current_state: contact.state || null,
          current_postcode: contact.postalCode || null,
          country: contact.country || null,
        };
        for (const [key, value] of Object.entries(candidates)) {
          if (value === null || value === undefined || value === '') continue;
          const current = existing?.[key];
          if (current === null || current === undefined || current === '') {
            patch[key] = value;
          }
        }
        return patch;
      };

      const attributionOf = (contact: GHLContact, clientId: string) => {
        const field = (key: string) =>
          contact.customFields?.find((f) => f.key === key || f.id === key)?.value || null;
        const utmSource = field('utm_source') || contact.source || null;
        const utmMedium = field('utm_medium');
        const utmCampaign = field('utm_campaign');
        const utmContent = field('utm_content');
        const utmTerm = field('utm_term');
        if (!(utmSource || utmMedium || utmCampaign || utmContent || contact.source)) return null;
        return {
          client_id: clientId,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
          utm_content: utmContent,
          utm_term: utmTerm,
          source_type: 'webhook_auto',
          ghl_contact_id: contact.id,
          attributed_at: contact.dateAdded || new Date().toISOString(),
        };
      };

      // ---- 1. One read: everything on this page we already hold by GHL id ----
      const pageGhlIds = contacts.map((c) => c.id).filter(Boolean);
      const byGhlId = new Map<string, any>();
      if (pageGhlIds.length > 0) {
        const { data: rows, error } = await supabase
          .from('clients')
          .select(`${EXISTING_COLUMNS}, ghl_contact_id`)
          .in('ghl_contact_id', pageGhlIds);
        // A failed read is not an empty result. Continuing would treat every
        // contact on the page as new and insert a duplicate of each.
        if (error) throw new Error(`Could not read existing clients by GHL id: ${error.message}`);
        for (const r of rows ?? []) if ((r as any).ghl_contact_id) byGhlId.set((r as any).ghl_contact_id, r);
      }

      // ---- 2. One read: of the rest, which emails do we already hold? ----
      const unmatched = contacts.filter((c) => !byGhlId.has(c.id));
      const pageEmails = [...new Set(unmatched.map((c) => c.email).filter(Boolean))] as string[];
      const byEmail = new Map<string, any>();
      if (pageEmails.length > 0) {
        const { data: rows, error } = await supabase
          .from('clients')
          .select(`${EXISTING_COLUMNS}, ghl_contact_id`)
          .in('primary_email', pageEmails);
        if (error) throw new Error(`Could not read existing clients by email: ${error.message}`);
        for (const r of rows ?? []) {
          const key = String((r as any).primary_email || '').toLowerCase();
          if (key) byEmail.set(key, r);
        }
      }

      // ---- 3. Partition ----
      const toUpdate: Array<{ contact: GHLContact; existing: Record<string, any> }> = [];
      const toInsert: GHLContact[] = [];
      // Within-page duplicate guard. The old per-contact re-query made this
      // impossible by accident; a batched read has to do it on purpose.
      const seenEmails = new Set<string>();

      for (const contact of contacts) {
        const existingByGhlId = byGhlId.get(contact.id);
        if (existingByGhlId) {
          toUpdate.push({ contact, existing: existingByGhlId });
          continue;
        }
        const emailKey = String(contact.email || '').toLowerCase();
        if (emailKey) {
          const existingByEmail = byEmail.get(emailKey);
          if (existingByEmail) {
            console.log(
              `Found existing client with email ${contact.email}, updating ghl_contact_id from ${existingByEmail.ghl_contact_id} to ${contact.id}`,
            );
            toUpdate.push({ contact, existing: existingByEmail });
            continue;
          }
          if (seenEmails.has(emailKey)) {
            // A second GHL contact carrying an email already claimed earlier in
            // THIS page. Inserting it would manufacture the duplicate this
            // import exists to collapse.
            console.log(`Skipping in-page duplicate email ${contact.email} (contact ${contact.id})`);
            continue;
          }
          seenEmails.add(emailKey);
        }
        toInsert.push(contact);
      }

      // ---- 4. Updates: cannot be batched, so run them in parallel ----
      if (toUpdate.length > 0) {
        const updated = await mapWithConcurrency(toUpdate, UPDATE_CONCURRENCY, async ({ contact, existing }) => {
          const { error } = await supabase
            .from('clients')
            .update(buildNonDestructivePatch(contact, existing))
            .eq('id', existing.id);
          if (error) throw new Error(error.message);
        });
        savedCount += updated.succeeded;
        for (const r of updated.results) {
          if (r.error) {
            console.error(`Error updating client ${r.item.contact.id}:`, r.error);
            errors.push(`Contact ${r.item.contact.id}: ${r.error}`);
            totalErrors++;
          }
        }
      }

      // ---- 5. Inserts: one statement, falling back to per-row on failure ----
      const insertedIdByGhlId = new Map<string, string>();
      if (toInsert.length > 0) {
        const { data: inserted, error: bulkError } = await supabase
          .from('clients')
          .insert(toInsert.map(clientDataOf))
          .select('id, ghl_contact_id');

        if (!bulkError) {
          savedCount += inserted?.length ?? 0;
          for (const row of inserted ?? []) {
            if ((row as any).ghl_contact_id) insertedIdByGhlId.set((row as any).ghl_contact_id, (row as any).id);
          }
        } else {
          // A bulk insert fails WHOLE, so one bad row would discard 99 good
          // ones and report a single opaque message. Fall back to per-row so
          // the page still lands and the offender is named — slow, but only on
          // the page that actually had a problem.
          console.warn(`Bulk insert failed (${bulkError.message}); retrying ${toInsert.length} row(s) individually`);
          const one = await mapWithConcurrency(toInsert, UPDATE_CONCURRENCY, async (contact) => {
            const { data, error } = await supabase
              .from('clients')
              .insert(clientDataOf(contact))
              .select('id')
              .single();
            if (error) throw new Error(error.message);
            return data?.id as string;
          });
          savedCount += one.succeeded;
          for (const r of one.results) {
            if (r.error) {
              console.error(`Error inserting client ${r.item.id}:`, r.error);
              errors.push(`Contact ${r.item.id}: ${r.error}`);
              totalErrors++;
            } else if (r.value) {
              insertedIdByGhlId.set(r.item.id, r.value);
            }
          }
        }
      }

      // ---- 6. Attributions: one statement for the whole page ----
      // A type predicate rather than `.filter(Boolean)`: the latter does not
      // narrow, so the array stays `(T | null)[]` and the insert call rejects it.
      const attributions = toInsert
        .map((contact) => {
          const id = insertedIdByGhlId.get(contact.id);
          return id ? attributionOf(contact, id) : null;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
      if (attributions.length > 0) {
        const { error: attrError } = await supabase.from('lead_source_attributions').insert(attributions);
        // Attribution is metadata about a client that was already saved.
        // Never fail the import over it — that was the old behaviour too.
        if (attrError) console.warn(`Failed to save ${attributions.length} attribution(s):`, attrError.message);
      }

      totalImported += savedCount;
      console.log(`Saved page ${pageCount}: ${savedCount} clients (total: ${totalImported})`)

      const nextStartAfter = data.meta?.startAfter ?? null;
      const nextStartAfterId = data.meta?.startAfterId ?? null;

      // Safety: if API returns the same cursor, stop to prevent infinite loops
      if (nextStartAfter === startAfter && nextStartAfterId === startAfterId) {
        console.warn(
          `Pagination cursor did not advance (startAfter=${startAfter}, startAfterId=${startAfterId}). Stopping to prevent infinite loop.`,
        );
        startAfter = null;
        startAfterId = null;
        break;
      }

      startAfter = nextStartAfter;
      startAfterId = nextStartAfterId;

      // If API doesn't provide a next cursor, we're done
      if (startAfter === null && !startAfterId) {
        console.log('Reached end of contacts (no next cursor)');
        break;
      }

      console.log(`Next page cursor: startAfter=${startAfter ?? 'null'}, startAfterId=${startAfterId ?? 'null'}`);
    }

    const hasMore = !!startAfterId || typeof startAfter === 'number';

    console.log(
      `Batch complete. Imported: ${totalImported}, Errors: ${totalErrors}, Has more: ${hasMore}, Next cursor: startAfter=${startAfter ?? 'null'}, startAfterId=${startAfterId ?? 'null'}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: hasMore
          ? `Imported ${totalImported} clients. More contacts available...`
          : `Import complete! Imported ${totalImported} clients.`,
        stats: {
          imported: totalImported,
          errors: totalErrors,
          totalFromApi,
          pagesProcessed: pageCount,
        },
        hasMore,
        // Which of the three stops ended this pass. `pagesProcessed ===
        // maxPages` and a budget stop are different facts about the same
        // unfinished walk, and an operator reading "More contacts available"
        // cannot tell them apart without this.
        stoppedOnBudget,
        durationMs: Date.now() - startedAt,
        nextResumeId: startAfterId,
        nextResume: startAfter,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );

  } catch (error) {
    console.error('Error in import-clients-from-ghl:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'import-clients-from-ghl'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
