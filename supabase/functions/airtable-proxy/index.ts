import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { createCorsHeaders, verifyAuth, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { checkModuleView } from '../_shared/permissions.ts';
import { isSuperadmin, rateLimit, redactUpstreamError } from '../_shared/wp08Guards.ts';
import { projectAirtableRecord } from '../_shared/airtableListing.pure.ts';
import {
  describeListingsFailure,
  listingsRequestUrl,
  resolveListingsRoute,
  type ListingsRoute,
} from '../_shared/airtableListingsRoute.pure.ts';
import { allowlistAdmits, buildAllowlist, parseTableAliases } from '../_shared/airtableTableKey.pure.ts';

/**
 * Which end refused, so the error names it.
 *
 * Mission Control and Airtable both answer 401, 403 and 429, and the remedies
 * are opposite: one is fixed in Mission Control's environment, the other on
 * this deployment. There is a third end, and it is the one that cost a
 * morning: a brokered answer Mission Control did not MARK as its own never
 * reached Mission Control, so `MISSION_CONTROL_URL` is the thing to look at
 * and no amount of investigating Airtable will help.
 *
 * `describeListingsFailure` is the one place that separates the three, shared
 * with `listings-cache` so the proxy and the cron cannot disagree about what
 * happened to the same call. Written once here too because three branches
 * report an upstream failure and two of them used to say "Airtable" whatever
 * had happened.
 */
function refusingEnd(
  route: ListingsRoute,
  response: Response,
): { service: string; refusal: string } {
  const failure = describeListingsFailure(route, response);
  return { service: failure.service, refusal: failure.code };
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

Deno.serve(async (req) => {
  // Get origin for CORS headers
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    console.log('Airtable proxy function called');

    // AUTH (Critical 3): this proxy holds an Airtable credential that can read
    // any table in the configured base (incl. list_tables). It must never be
    // callable anonymously. Parse the body once (POST) and require a verified
    // staff human; GET callers still authenticate via the Authorization /
    // x-session-token headers.
    const supabaseAuthClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const parsedBody = req.method === 'POST'
      ? await req.json().catch(() => ({} as Record<string, any>))
      : {} as Record<string, any>;
    const auth = await verifyAuth(supabaseAuthClient, req.headers, parsedBody);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
    }

    // The Airtable listings intake data proxied here is the Property
    // Marketplace dataset — a Scale-or-add-on capability, enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabaseAuthClient, auth, 'opportunity-marketplace');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    // WP-08 — module gate: requires `listings` module view. Superadmin bypasses.
    const moduleCheck = await checkModuleView(supabaseAuthClient, auth.userId, 'listings', auth.authMethod);
    if (!moduleCheck.allowed) {
      return new Response(
        JSON.stringify({ error: moduleCheck.reason || 'You do not have access to listings.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Best-effort per-user rate limit: 120 calls / minute.
    const rl = rateLimit(`airtable:${auth.userId}`, 120, 60_000);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((rl.retryAfterMs || 1000)/1000)) } }
      );
    }

    /*
     * Where this deployment reads Airtable. The prime holds the token and goes
     * direct; a clone holds none and the CALL travels to Mission Control's
     * broker instead — see `_shared/airtableListingsRoute.pure.ts` for why the
     * credential stops there.
     */
    const route = resolveListingsRoute({
      airtableToken: Deno.env.get('AIRTABLE_TOKEN'),
      airtableBaseId: Deno.env.get('AIRTABLE_BASE_ID'),
      missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
      cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
    });
    const defaultTableName = Deno.env.get('AIRTABLE_TABLE_NAME');

    console.log('Environment check:', {
      route: route.via,
      hasDefaultTableName: !!defaultTableName,
    });

    if (route.via === 'unconfigured') {
      // Names WHICH half is missing. A deployment with no token needs Mission
      // Control's two names; one with a token needs its base id. Opposite
      // remedies, so a bare "not configured" sends an operator the wrong way.
      console.error('Airtable route unconfigured:', route.why);
      return new Response(
        JSON.stringify({ error: 'Airtable credentials not configured', detail: route.why }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request parameters from body (POST) or URL params (GET)
    let pageSize = '100';
    let offset = '';
    let sortField: string | null = null;
    let sortDirection = 'desc';
    let op: string | null = null;
    let tableOverride: string | null = null;

    if (req.method === 'POST') {
      const body = parsedBody;
      pageSize = body.pageSize?.toString() || '100';
      offset = body.offset || '';
      sortField = body.sortField || null;
      sortDirection = body.sortDirection || 'desc';
      op = body.op === 'list_tables' ? 'list_tables' : null;
      tableOverride = typeof body.tableName === 'string' && body.tableName.trim() ? body.tableName.trim() : null;
    } else {
      const url = new URL(req.url);
      pageSize = url.searchParams.get('pageSize') || '100';
      offset = url.searchParams.get('offset') || '';
      sortField = url.searchParams.get('sortField') || null;
      sortDirection = url.searchParams.get('sortDirection') || 'desc';
      op = url.searchParams.get('op') === 'list_tables' ? 'list_tables' : null;
      tableOverride = url.searchParams.get('tableName');
    }

    // WP-08 — bound page size (Airtable's own max is 100; force it).
    let pageSizeNum = parseInt(pageSize, 10);
    if (!Number.isFinite(pageSizeNum) || pageSizeNum < 1) pageSizeNum = 100;
    pageSize = String(Math.min(100, pageSizeNum));

    // WP-08 — sort direction allowlist.
    if (sortDirection !== 'asc' && sortDirection !== 'desc') sortDirection = 'desc';

    // WP-08 — resolve/enforce server-side table allowlist. The default table
    // is always allowed; additional tables must be explicitly declared in
    // AIRTABLE_TABLE_ALLOWLIST (comma-separated). `list_tables` is
    // superadmin-only.
    const superadmin = await isSuperadmin(supabaseAuthClient, auth.userId, auth.authMethod);
    const allowlistEnv = (Deno.env.get('AIRTABLE_TABLE_ALLOWLIST') || '').trim();
    // Built through the shared resolver so a deployment that allowlists table
    // *ids* still admits a caller who asked by display name, and vice versa.
    // Airtable accepts either form in a URL, so the two spellings reach here
    // interchangeably and the check has to treat them as one table.
    const tableAliases = parseTableAliases(Deno.env.get('AIRTABLE_TABLE_ALIASES'));
    const allowlist = buildAllowlist(defaultTableName, allowlistEnv, tableAliases);

    if (op === 'list_tables') {
      if (!superadmin) {
        return new Response(
          JSON.stringify({ error: 'list_tables is restricted to superadmins.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const metaUrl = listingsRequestUrl(route, 'tables', '');
      const metaRes = await fetch(metaUrl, { headers: route.headers });
      if (!metaRes.ok) {
        const errorText = await metaRes.text();
        const { service, refusal } = refusingEnd(route, metaRes);
        console.error(
          `${service} metadata error:`,
          metaRes.status,
          refusal ? `${refusal}; ${errorText}` : errorText,
        );
        return new Response(
          JSON.stringify({ error: redactUpstreamError(metaRes.status, service) }),
          { status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const metaJson = await metaRes.json();
      const tables = (metaJson.tables || []).map((t: any) => ({
        id: t.id, name: t.name, primaryFieldId: t.primaryFieldId,
      }));
      return new Response(
        JSON.stringify({ tables, defaultTableName: defaultTableName || null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tableName = tableOverride || defaultTableName;
    if (!tableName) {
      return new Response(
        JSON.stringify({ error: 'No table specified and no AIRTABLE_TABLE_NAME default configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Superadmins keep freeform access; everyone else is bound to the allowlist.
    if (!superadmin && !allowlistAdmits(allowlist, tableName)) {
      return new Response(
        JSON.stringify({ error: 'Requested table is not permitted.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Built by the route: Airtable's own shape when direct, Mission Control's
    // when brokered — and on the brokered route there is no base id to put in
    // it, because the route does not carry one.
    const airtableUrl = listingsRequestUrl(route, 'records', tableName, {
      pageSize: Number(pageSize),
      ...(offset ? { offset } : {}),
      ...(sortField
        ? { sortField, sortDirection: sortDirection === 'asc' ? 'asc' as const : 'desc' as const }
        : {}),
    });

    console.log('Making listings request via', route.via);

    let airtableResponse = await fetch(airtableUrl, { headers: route.headers });

    // Retry without sort if the chosen sort field doesn't exist on this table
    if (!airtableResponse.ok && sortField) {
      const errorText = await airtableResponse.text();
      const looksLikeUnknownSortField =
        airtableResponse.status === 422 ||
        /UNKNOWN_FIELD_NAME|INVALID_SORT_FIELD|not a valid field|unknown field/i.test(errorText);

      if (looksLikeUnknownSortField) {
        console.warn(`Sort field "${sortField}" rejected by table "${tableName}". Retrying without sort.`);
        const retryUrl = listingsRequestUrl(route, 'records', tableName, {
          pageSize: Number(pageSize),
          ...(offset ? { offset } : {}),
        });
        airtableResponse = await fetch(retryUrl, { headers: route.headers });
      } else {
        // Non-sort error — redact upstream body (WP-08).
        const { service, refusal } = refusingEnd(route, airtableResponse);
        console.error(
          `${service} API error:`,
          airtableResponse.status,
          refusal ? `${refusal}; ${errorText}` : errorText,
        );
        return new Response(
          JSON.stringify({ error: redactUpstreamError(airtableResponse.status, service) }),
          { status: airtableResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!airtableResponse.ok) {
      const errorText = await airtableResponse.text();
      const { service, refusal } = refusingEnd(route, airtableResponse);
      console.error(
        `${service} error:`,
        airtableResponse.status,
        refusal ? `${refusal}; ${errorText}` : errorText,
      );
      return new Response(
        JSON.stringify({ error: redactUpstreamError(airtableResponse.status, service) }),
        { status: airtableResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data: AirtableResponse = await airtableResponse.json();
    console.log(`Successfully fetched ${data.records.length} records from Airtable`);

    /*
     * Metered HERE only on the direct route, which is the one that spends this
     * deployment's own Airtable token. A brokered read is metered by Mission
     * Control, because Mission Control made the vendor call — logging it at
     * both ends bills the tenant twice, which this platform's own rule names
     * as worse than not billing at all.
     */
    if (route.meter) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      await logApiUsage(supabase, {
        service_name: 'airtable',
        endpoint: `/v0/${route.baseId}/${tableName}`,
        status: 'success',
        model_used: 'rest-api',
        user_id: auth.userId,
        metadata: { records_fetched: data.records.length, has_offset: !!data.offset, table: tableName, op: op || 'list' },
      });
    }

    // Transform the data to match the expected format. The projection lives in
    // `_shared/airtableListing.pure.ts` because `listings-cache` stores Airtable
    // `fields` verbatim and applies the same projection at read time; two copies
    // would drift the first time a column was renamed.
    const transformedRecords = data.records.map((record) => projectAirtableRecord(record));

    // Enhanced scoring system with weighted fields and quality penalties
    const calculateEnrichmentScore = (record: any): number => {
      let score = 0;
      
      // Critical property info (weighted higher) - 35 points max
      if (record.price && record.price > 0) score += 10; // Most important
      if (record.address) score += 8;
      if (record.suburb) score += 7;
      if (record.beds && record.beds > 0) score += 5;
      if (record.baths && record.baths > 0) score += 5;
      
      // Property details - 20 points max
      if (record.propertyType && record.propertyType !== 'Unknown') score += 4;
      if (record.carSpaces && record.carSpaces > 0) score += 3;
      if (record.landSize) score += 3;
      if (record.state) score += 3;
      if (record.zipCode) score += 3;
      if (record.lotNumber) score += 2;
      if (record.status && record.status !== 'Available') score += 2;
      
      // Agent and agency info - 15 points max
      if (record.agentName) score += 6;
      if (record.agencyName) score += 5;
      if (record.agentPhone) score += 4;
      
      // Rich content and media - 20 points max
      if (record.description && record.description.length > 100) score += 6;
      else if (record.description && record.description.length > 50) score += 3;
      if (record.summary && record.summary.length > 50) score += 4;
      if (record.images && record.images.length > 0) score += 4;
      if (record.floorplans && record.floorplans.length > 0) score += 3;
      if (record.keyEntities) score += 3;
      
      // Inspection and timing details - 10 points max
      if (record.inspectionStart) score += 4;
      if (record.inspectionEnd) score += 3;
      if (record.inspectionNotes) score += 3;
      
      // Quality and confidence metrics - 10 points max
      if (record.confidence && record.confidence > 0.8) score += 5;
      else if (record.confidence && record.confidence > 0.6) score += 3;
      else if (record.confidence && record.confidence > 0.4) score += 1;
      if (record.webLinks) score += 2;
      if (record.rawExtract && record.rawExtract.length > 200) score += 3;
      
      // Quality penalties (subtract points for poor data).
      //
      // These test for absence directly. They used to compare against the
      // literal strings the projection substituted — 'Unknown Address' and so
      // on — which the projection no longer emits, so left unchanged they would
      // simply never fire and every record would score as though its address
      // were present.
      if (!record.address) score -= 5;
      if (!record.suburb) score -= 3;
      if (!record.agentName) score -= 2;
      if (!record.agencyName) score -= 2;
      if (!record.price || record.price <= 0) score -= 8;
      
      return Math.max(0, score); // Ensure non-negative score
    };

    // Multi-strategy deduplication with fuzzy matching
    const normalizeForDuplication = (str: string | undefined | null): string => {
      if (!str) return 'unknown';
      return str.toLowerCase()
        .trim()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/\b(st|street|rd|road|ave|avenue|dr|drive|ln|lane|ct|court|pl|place)\b/g, '') // Remove street suffixes
        .trim();
    };

    // Calculate Levenshtein distance for fuzzy matching
    const levenshteinDistance = (str1: string, str2: string): number => {
      const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
      for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
      for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
      for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
          const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
          matrix[j][i] = Math.min(
            matrix[j][i - 1] + 1, // deletion
            matrix[j - 1][i] + 1, // insertion
            matrix[j - 1][i - 1] + indicator // substitution
          );
        }
      }
      return matrix[str2.length][str1.length];
    };

    // Check if two addresses are similar (fuzzy match)
    const areAddressesSimilar = (addr1: string, addr2: string): boolean => {
      const norm1 = normalizeForDuplication(addr1);
      const norm2 = normalizeForDuplication(addr2);
      
      if (norm1 === norm2) return true;
      if (norm1 === 'unknown' || norm2 === 'unknown') return false;
      
      const distance = levenshteinDistance(norm1, norm2);
      const maxLength = Math.max(norm1.length, norm2.length);
      const similarity = 1 - (distance / maxLength);
      
      return similarity >= 0.85; // 85% similarity threshold
    };

    // Group listings using multiple strategies
    const listingGroups = new Map();
    const processedRecords = new Set();
    
    // First pass: Calculate enrichment scores
    for (const record of transformedRecords) {
      (record as any).enrichmentScore = calculateEnrichmentScore(record);
    }
    
    // Second pass: Group similar listings
    for (let i = 0; i < transformedRecords.length; i++) {
      if (processedRecords.has(i)) continue;
      
      const currentRecord = transformedRecords[i];
      const group = [currentRecord];
      processedRecords.add(i);

      // A record with no address cannot be matched to anything. Two unknowns are
      // not the same property, and treating them as one is what collapsed 268
      // records into a single row.
      if (!currentRecord.address) {
        listingGroups.set(`norecord:${currentRecord.id}`, group);
        continue;
      }

      // Look for similar listings
      for (let j = i + 1; j < transformedRecords.length; j++) {
        if (processedRecords.has(j)) continue;
        
        const compareRecord = transformedRecords[j];
        let isDuplicate = false;
        
        // Strategy 1: Exact match on normalized address + suburb
        const addr1 = normalizeForDuplication(currentRecord.address);
        const addr2 = normalizeForDuplication(compareRecord.address);
        const suburb1 = normalizeForDuplication(currentRecord.suburb);
        const suburb2 = normalizeForDuplication(compareRecord.suburb);
        
        if (addr1 !== 'unknown' && addr2 !== 'unknown' && addr1 === addr2 && suburb1 === suburb2) {
          isDuplicate = true;
        }
        
        // Strategy 2: Fuzzy address match + same suburb
        if (!isDuplicate && areAddressesSimilar(currentRecord.address, compareRecord.address) && suburb1 === suburb2) {
          isDuplicate = true;
        }
        
        // Strategy 3: Same zipcode + similar beds/baths + similar property type (for cases with poor address data)
        if (!isDuplicate && 
            currentRecord.zipCode && compareRecord.zipCode && 
            currentRecord.zipCode === compareRecord.zipCode &&
            currentRecord.beds === compareRecord.beds &&
            currentRecord.baths === compareRecord.baths &&
            normalizeForDuplication(currentRecord.propertyType) === normalizeForDuplication(compareRecord.propertyType) &&
            currentRecord.propertyType !== 'Unknown') {
          isDuplicate = true;
        }
        
        if (isDuplicate) {
          group.push(compareRecord);
          processedRecords.add(j);
        }
      }
      
      // Create a key for this group (for logging purposes)
      const groupKey = `${normalizeForDuplication(currentRecord.address)}|${normalizeForDuplication(currentRecord.suburb)}|${currentRecord.beds || 'unknown'}|${currentRecord.baths || 'unknown'}`;
      listingGroups.set(groupKey, group);
    }
    
    // Rank each group and TAG the runners-up. Nothing is removed.
    //
    // This block used to keep only `records[0]` and drop the rest, which cost
    // 268 of 1,441 records on every read — the page showed 1,173 and no caller
    // could tell that a quarter of the table had been deleted from the response.
    // Two things made it that destructive: grouping runs per 100-record page, so
    // what it merges is an accident of pagination rather than a real duplicate
    // relationship; and the projection used to substitute the literal string
    // 'Unknown Address', which `normalizeForDuplication` turns into
    // 'unknown address' — passing the `!== 'unknown'` guards below and comparing
    // equal to every other address-less record, so they all collapsed into one.
    //
    // The projection no longer emits that sentinel, and grouping now skips
    // records with no address at all. But a silent drop is the wrong failure
    // mode regardless of how good the matching is, so duplicates are marked and
    // the client decides what to show.
    const deduplicatedRecords = [];
    let duplicatesFound = 0;
    let totalGroups = 0;

    for (const [key, records] of listingGroups.entries()) {
      totalGroups++;

      if (records.length > 1) {
        duplicatesFound += records.length - 1;

        // Sort by enrichment score (highest first), then by creation date (newest first)
        records.sort((a: any, b: any) => {
          const scoreDiff = b.enrichmentScore - a.enrichmentScore;
          if (scoreDiff !== 0) return scoreDiff;

          // If scores are tied, prefer listings with more recent data
          const dateA = new Date(a.createdTime).getTime();
          const dateB = new Date(b.createdTime).getTime();
          return dateB - dateA;
        });

        const selected = records[0];
        selected.duplicateCount = records.length - 1;
        for (const record of records.slice(1)) {
          record.duplicateOf = selected.id;
        }
        const scores = records.map((r: any) => r.enrichmentScore).join(', ');
        console.log(`Duplicate group "${key.substring(0, 50)}...": ${records.length} records (scores: ${scores}), best score ${selected.enrichmentScore}`);
      }

      deduplicatedRecords.push(...records);
    }

    console.log(`Deduplication summary: ${totalGroups} groups, ${duplicatesFound} tagged as duplicates of ${transformedRecords.length} total records (none removed)`);

    return new Response(
      JSON.stringify({
        records: deduplicatedRecords,
        offset: data.offset,
        total: deduplicatedRecords.length
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error in airtable-proxy:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
