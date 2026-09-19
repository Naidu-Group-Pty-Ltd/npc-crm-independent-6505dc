// Canonical Market News archive transport.
// A versioned function name deliberately avoids legacy deployment bundles that
// returned `Unknown action` for the current archive contract.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 16_384;

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  let correlationId = crypto.randomUUID();
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      'x-correlation-id': correlationId,
    },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  if (req.method !== 'POST') return json({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);

  const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return new Response(parsed.error.body, {
      status: parsed.error.status,
      headers: { ...Object.fromEntries(parsed.error.headers), ...cors, 'x-correlation-id': correlationId },
    });
  }
  const body = parsed.value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid request', code: 'invalid_request' }, 400);
  }
  if (typeof body.correlation_id === 'string' && UUID.test(body.correlation_id)) {
    correlationId = body.correlation_id;
  }

  const sb = admin();
  let auth = await verifyAuth(sb, req.headers, {});
  if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId || auth.userId === 'service_role') {
    return json({ error: 'Authentication required', code: 'auth_required', retryable: false }, 401);
  }

  // Market News Feed is a Scale-or-add-on capability — enforced server-side.
  const entitlement = await requireWorkspaceCapability(sb, auth, 'market-updates');
  if (!entitlement.ok) return entitlementDeniedResponse(entitlement, cors);

  const viewPermission = await requireModulePermission(
    sb,
    { userId: auth.userId, authMethod: auth.authMethod },
    'market_updates',
    'can_view',
  );
  if (!viewPermission.ok) {
    return json({ error: 'Market News Feed view permission is required.', code: 'view_required', retryable: false }, 403);
  }

  if (body.action !== 'set_archive_state') {
    return json({ error: 'Unknown action', code: 'invalid_request', retryable: false }, 400);
  }

  const updateId = typeof body.updateId === 'string' ? body.updateId : '';
  if (!UUID.test(updateId) || typeof body.archived !== 'boolean') {
    return json({ error: 'A valid update ID and archive state are required.', code: 'invalid_request', retryable: false }, 400);
  }

  const editPermission = await requireModulePermission(
    sb,
    { userId: auth.userId, authMethod: auth.authMethod },
    'market_updates',
    'can_edit',
  );
  if (!editPermission.ok) {
    return json({ error: 'Market News Feed edit permission is required.', code: 'edit_required', retryable: false }, 403);
  }

  const { data: existing, error: readError } = await sb
    .from('market_updates')
    .select('id,status,archived_at,pre_archive_status')
    .eq('id', updateId)
    .maybeSingle();
  if (readError) {
    console.error(JSON.stringify({ function: 'market-news-archive-v2', stage: 'read', correlation_id: correlationId, code: readError.code }));
    return json({ error: 'The market news item could not be loaded.', code: 'read_failed', retryable: true }, 500);
  }
  if (!existing) return json({ error: 'The market news item was not found.', code: 'not_found', retryable: false }, 404);

  const wantsArchived = body.archived;
  if (wantsArchived === Boolean(existing.archived_at)) {
    return json({
      id: updateId,
      isArchived: wantsArchived,
      archivedAt: existing.archived_at,
      outcome: wantsArchived ? 'already_archived' : 'already_restored',
      correlationId,
    });
  }

  const now = new Date().toISOString();
  const restoredStatus = existing.pre_archive_status ?? existing.status ?? 'published';
  let mutation = sb.from('market_updates').update(wantsArchived
    ? { archived_at: now, archived_by: auth.userId, pre_archive_status: existing.status, decisioned_at: now, updated_at: now }
    : { archived_at: null, archived_by: null, pre_archive_status: null, status: restoredStatus, decisioned_at: now, updated_at: now })
    .eq('id', updateId);
  mutation = wantsArchived ? mutation.is('archived_at', null) : mutation.not('archived_at', 'is', null);

  const { data: updated, error: writeError } = await mutation.select('id,archived_at').maybeSingle();
  if (writeError) {
    console.error(JSON.stringify({ function: 'market-news-archive-v2', stage: 'write', correlation_id: correlationId, code: writeError.code }));
    return json({ error: 'The archive state could not be updated.', code: 'write_failed', retryable: true }, 500);
  }
  if (!updated) {
    return json({ error: 'The market news item changed before the operation completed.', code: 'state_changed', retryable: true }, 409);
  }

  return json({
    id: updateId,
    isArchived: wantsArchived,
    archivedAt: updated.archived_at,
    outcome: wantsArchived ? 'archived' : 'restored',
    correlationId,
  });
});