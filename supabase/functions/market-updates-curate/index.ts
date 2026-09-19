// Operator archive/restore for the Market Updates feed. Archived rows retain
// their identity and dedupe keys for 30 days, then the database retention job
// permanently removes them. Writes stay behind the service role and a
// deny-by-default market_updates can_edit check.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';
import { logMarketEvent, marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';

const UPDATE_COLUMNS = 'id,title,status,archived_at,archived_by,pre_archive_status,decisioned_at,updated_at';
const MAX_REQUEST_BYTES = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, cors: Record<string,string>, correlationId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type':'application/json', 'cache-control':'private, no-store', 'x-correlation-id':correlationId },
  });
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  let correlationId = marketCorrelationId(req.headers);
  if (req.method === 'OPTIONS') return new Response(null, { headers:cors });
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  if (req.method !== 'POST') return json({ error:'Method not allowed', correlation_id:correlationId }, 405, cors, correlationId);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false } });

  let auth = await verifyAuth(sb, req.headers, {});
  const parsed = await enforceJsonBodyLimit<unknown>(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return new Response(parsed.error.body, {
      status: parsed.error.status,
      headers: { ...Object.fromEntries(parsed.error.headers), ...cors, 'x-correlation-id':correlationId },
    });
  }
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return json({ error:'Invalid request', code:'invalid_request', correlation_id:correlationId }, 400, cors, correlationId);
  }
  const body = parsed.value as Record<string, unknown>;
  correlationId = marketCorrelationId(req.headers, body);
  if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error:'Authentication required', code:'market_updates_auth_required', correlation_id:correlationId, retryable:false }, 401, cors, correlationId);

  const permission = await requireModulePermission(sb, { userId:auth.userId, authMethod:auth.authMethod }, 'market_updates', 'can_edit');
  if (!permission.ok) return json({ error:'Market Updates edit permission required', code:'market_updates_edit_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);

  const requestedAction = String(body.action ?? '');
  // Keep `hide` as a temporary API alias while the Phase 4 frontend rolls from
  // Remove to Archive. It performs the same server-authoritative archive.
  const action = requestedAction === 'hide' ? 'archive' : requestedAction;
  if (action !== 'archive' && action !== 'restore' && action !== 'publish') {
    return json({ error:'Unknown action', code:'invalid_action', correlation_id:correlationId }, 400, cors, correlationId);
  }
  const updateId = typeof body.updateId === 'string' ? body.updateId : '';
  if (!UUID.test(updateId)) return json({ error:'Invalid update ID', code:'invalid_request', correlation_id:correlationId }, 400, cors, correlationId);


  const { data: existing, error: readError } = await sb.from('market_updates')
    .select('id,status,archived_at,archived_by,pre_archive_status,visibility')
    .eq('id', updateId)
    .maybeSingle();
  if (readError) {
    console.error(JSON.stringify({ function:'market-updates-curate', stage:action, correlation_id:correlationId, error_class:'database_read_failed' }));
    return json({ error:'Market update could not be loaded.', code:'market_updates_read_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
  }
  if (!existing) return json({ error:'Market update not found', code:'not_found', correlation_id:correlationId, retryable:false }, 404, cors, correlationId);

  // Operator promotion of a held candidate. Shadow-visibility rows are never
  // promotable — the database check constraint forbids a published shadow row,
  // and promoting one would defeat the measurement shadow mode exists for.
  if (action === 'publish') {
    if (existing.status === 'published') {
      return json({ update:existing, action, outcome:'already_published', correlation_id:correlationId }, 200, cors, correlationId);
    }
    if (existing.status !== 'candidate' || existing.archived_at || existing.visibility !== 'public') {
      return json({ error:'Only a live held candidate can be published.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
    }
    const publishedAt = new Date().toISOString();
    const { data:publishedRow, error:publishError } = await sb.from('market_updates')
      .update({ status:'published', publication_reason:'operator_manual_publication', candidate_reason:null, decisioned_at:publishedAt, updated_at:publishedAt })
      .eq('id', updateId).eq('status', 'candidate').is('archived_at', null).eq('visibility', 'public')
      .select(UPDATE_COLUMNS).maybeSingle();
    if (publishError) {
      console.error(JSON.stringify({ function:'market-updates-curate', stage:'publish', correlation_id:correlationId, error_class:'database_update_failed' }));
      return json({ error:'Market update could not be published.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
    }
    if (!publishedRow) {
      const { data:current } = await sb.from('market_updates').select(UPDATE_COLUMNS).eq('id', updateId).maybeSingle();
      if (current?.status === 'published') return json({ update:current, action, outcome:'already_published', correlation_id:correlationId }, 200, cors, correlationId);
      return json({ error:'Market update changed before the request completed.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
    }
    logMarketEvent('info', { function:'market-updates-curate', stage:'publish', correlation_id:correlationId, status:'completed', update_id:updateId, previous_status:existing.status });
    return json({ update:publishedRow, action, outcome:'published', correlation_id:correlationId }, 200, cors, correlationId);
  }


  if (action === 'archive' && existing.archived_at) {
    return json({ update:existing, action, outcome:'already_archived', correlation_id:correlationId }, 200, cors, correlationId);
  }
  if (action === 'restore' && !existing.archived_at) {
    if (existing.status === 'published') {
      return json({ update:existing, action, outcome:'already_restored', correlation_id:correlationId }, 200, cors, correlationId);
    }
    return json({ error:'Market update cannot be restored from its current state.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
  }
  if (action === 'archive' && existing.status !== 'published') {
    return json({ error:'Only a published market update can be archived.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
  }

  const now = new Date().toISOString();
  const patch = action === 'archive'
    ? { archived_at:now, archived_by:auth.userId, pre_archive_status:existing.status, decisioned_at:now, updated_at:now }
    : { archived_at:null, archived_by:null, pre_archive_status:null, decisioned_at:now, updated_at:now };

  const updateQuery = action === 'restore'
    ? sb.from('market_updates').update(patch).eq('id', updateId).not('archived_at', 'is', null)
    : sb.from('market_updates').update(patch).eq('id', updateId).eq('status', 'published').is('archived_at', null);
  const { data, error } = await updateQuery.select(UPDATE_COLUMNS).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ function:'market-updates-curate', stage:action, correlation_id:correlationId, error_class:'database_update_failed' }));
    return json({ error:'Market update visibility could not be changed.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
  }
  if (!data) {
    // Resolve a concurrent duplicate into an idempotent outcome. If the row was
    // removed by an exceptional administrative operation between the initial
    // read and this re-read, restoration reports that explicitly.
    const { data:current, error:currentError } = await sb.from('market_updates')
      .select(UPDATE_COLUMNS).eq('id', updateId).maybeSingle();
    if (currentError) return json({ error:'Market update state could not be confirmed.', code:'market_updates_read_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
    if (!current) return json({ error:'Market update was not found.', code:'not_found_or_purged', correlation_id:correlationId, retryable:false }, 404, cors, correlationId);
    if (action === 'archive' && current.archived_at) return json({ update:current, action, outcome:'already_archived', correlation_id:correlationId }, 200, cors, correlationId);
    if (action === 'restore' && !current.archived_at && current.status === 'published') return json({ update:current, action, outcome:'already_restored', correlation_id:correlationId }, 200, cors, correlationId);
    return json({ error:'Market update changed before the request completed.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
  }

  logMarketEvent('info', { function:'market-updates-curate', stage:action, correlation_id:correlationId, status:'completed', update_id:updateId, previous_status:existing.status });
  return json({ update:data, action, outcome:action === 'archive' ? 'archived' : 'restored', correlation_id:correlationId }, 200, cors, correlationId);
});
