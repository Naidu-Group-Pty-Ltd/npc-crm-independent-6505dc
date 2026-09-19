// WP-06 Phase A — object-level storage authorization primitives.
//
// Central resolver for the sensitive-bucket set. `secure-storage` calls
// `authorizeObjectAccess()` for every download/signedUrl/delete/list on a
// sensitive bucket; producers (upload paths) call `createStorageBinding()`
// so the object becomes authorizable on read.
//
// Contract (fail-closed):
//   - If a binding row exists for (bucket, path): authorization is decided
//     from the binding (client assignment / owner / sharing). Deny → 404.
//   - If no binding exists AND the bucket is on the legacy allow-list:
//     fall back to the existing per-bucket module gate in `secure-storage`.
//     A telemetry event is emitted so we can measure backfill progress.
//   - If no binding exists AND the bucket is NOT on the legacy allow-list:
//     deny (404). New/uploads MUST call `createStorageBinding()`.
//
// This module purposely avoids importing frontend types; edge-function only.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type StorageSensitivity = 'sensitive' | 'restricted' | 'internal' | 'public_asset';

/**
 * Sensitivity classification per bucket. Keep this in sync with the
 * BUCKET_POLICIES map in `secure-storage/index.ts`.
 */
export const BUCKET_SENSITIVITY: Record<string, StorageSensitivity> = {
  'client-files':         'sensitive',
  'client-documents':     'sensitive',
  'formara-forms':         'sensitive',
  'vownet-forms':         'sensitive', // legacy pre-rename bucket
  'investment-reports':   'sensitive',
  'quantitative-reports': 'sensitive',
  'qa_exports':           'sensitive',
  'email-attachments':    'restricted',
  'branding-assets':      'public_asset',
  'report-templates':     'public_asset',
};

/**
 * During Phase A, sensitive buckets without a binding still fall back to the
 * legacy per-bucket module gate. Track which buckets are still on the legacy
 * fallback so we can prioritise backfill and later remove the fallback.
 */
// Phase C complete: all sensitive objects require a canonical binding. The
// Phase-B migration backfills legacy rows; a missing binding now fails closed.
export const LEGACY_FALLBACK_BUCKETS = new Set<string>();

export interface StorageBinding {
  id: string;
  bucket: string;
  object_path: string;
  resource_type: string;
  resource_id: string | null;
  client_id: string | null;
  owner_user_id: string | null;
  sensitivity: StorageSensitivity;
  created_by: string | null;
  created_at: string;
}

export interface CreateBindingInput {
  bucket: string;
  object_path: string;
  resource_type: string;         // e.g. 'client_file', 'investment_report', 'email_attachment'
  resource_id?: string | null;
  client_id?: string | null;
  owner_user_id?: string | null;
  sensitivity?: StorageSensitivity;
  created_by?: string | null;
}

export interface AuthorizeContext {
  actorId: string;
  isSuperadmin: boolean;
  isInternalService: boolean;
  authMethod?: string;
}

export interface AuthorizeResult {
  allowed: boolean;
  /** For fail-closed responses: `secure-storage` must return 404 on deny. */
  reason?: string;
  binding?: StorageBinding;
  /** True when no binding was found and legacy per-bucket gate must run. */
  legacyFallback?: boolean;
}

export async function getStorageBinding(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<StorageBinding | null> {
  const { data, error } = await supabase
    .from('storage_object_bindings')
    .select('*')
    .eq('bucket', bucket)
    .eq('object_path', path)
    .maybeSingle();
  if (error) {
    console.error('[storageAuthz] getBinding error:', error.message);
    return null;
  }
  return (data as StorageBinding | null) ?? null;
}

/**
 * Create an immutable binding. Callers MUST invoke this inside the same
 * server-side flow that uploaded the object, so partial-failure cleanup can
 * roll back both the object and the binding.
 */
export async function createStorageBinding(
  supabase: SupabaseClient,
  input: CreateBindingInput,
): Promise<{ ok: true; binding: StorageBinding } | { ok: false; error: string }> {
  const sensitivity: StorageSensitivity =
    input.sensitivity ?? BUCKET_SENSITIVITY[input.bucket] ?? 'sensitive';
  const { data, error } = await supabase
    .from('storage_object_bindings')
    .insert(
      {
        bucket: input.bucket,
        object_path: input.object_path,
        resource_type: input.resource_type,
        resource_id: input.resource_id ?? null,
        client_id: input.client_id ?? null,
        owner_user_id: input.owner_user_id ?? null,
        sensitivity,
        created_by: input.created_by ?? null,
      })
    .select('*')
    .single();
  if (error) {
    console.error('[storageAuthz] createBinding error:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, binding: data as StorageBinding };
}

export async function deleteStorageBinding(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<void> {
  const { error } = await supabase
    .from('storage_object_bindings')
    .delete()
    .eq('bucket', bucket)
    .eq('object_path', path);
  if (error) console.error('[storageAuthz] deleteBinding error:', error.message);
}

/**
 * Rollback helper — deletes a storage object AND its binding row. Callers use
 * this when a follow-up step (DB insert, further validation) fails after a
 * successful upload, so we never leave orphan objects the caller can no
 * longer reach through the authorized read path.
 */
export async function rollbackStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<void> {
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch (err) {
    console.error('[storageAuthz] rollback remove failed:', (err as Error).message);
  }
  await deleteStorageBinding(supabase, bucket, path);
}

/**
 * Resolve the allowed object paths for a `list` operation on a sensitive
 * bucket. The caller must supply a resource identifier (`clientId` for
 * client-scoped buckets, or `ownerUserId` for owner-scoped ones). Returns
 * only the bindings the actor is authorized to see under the same rules as
 * `authorizeObjectAccess`.
 */
export async function authorizedBindingsForList(
  supabase: SupabaseClient,
  bucket: string,
  ctx: AuthorizeContext,
  scope: { clientId?: string | null; ownerUserId?: string | null },
): Promise<StorageBinding[]> {
  if (!scope.clientId && !scope.ownerUserId) return [];
  let query = supabase.from('storage_object_bindings').select('*').eq('bucket', bucket);
  if (scope.clientId)    query = query.eq('client_id', scope.clientId);
  if (scope.ownerUserId) query = query.eq('owner_user_id', scope.ownerUserId);
  const { data, error } = await query.limit(500);
  if (error || !data) return [];
  if (ctx.isSuperadmin || ctx.isInternalService) return data as StorageBinding[];
  const allowed: StorageBinding[] = [];
  for (const b of data as StorageBinding[]) {
    if (b.owner_user_id && b.owner_user_id === ctx.actorId) { allowed.push(b); continue; }
    if (b.client_id) {
      const { data: created } = await supabase
        .from('clients').select('id').eq('id', b.client_id).eq('created_by', ctx.actorId).maybeSingle();
      if (created) { allowed.push(b); continue; }
      const { data: assigned } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id').eq('client_id', b.client_id).eq('finance_user_id', ctx.actorId).maybeSingle();
      if (assigned) { allowed.push(b); continue; }
    }
  }
  return allowed;
}

/**
 * Object-level authorization.
 *
 * When a binding exists, deny unless one of:
 *   - actor is superadmin or internal service;
 *   - actor owns the object (`owner_user_id`);
 *   - actor has an active assignment to the bound `client_id` (via
 *     `finance_portal_client_assignments` OR `clients.created_by`).
 *
 * If no binding exists and the bucket is on the legacy allow-list, signal
 * `legacyFallback: true` so `secure-storage` runs its existing module gate.
 */
export async function authorizeObjectAccess(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  ctx: AuthorizeContext,
): Promise<AuthorizeResult> {
  if (ctx.isInternalService || ctx.isSuperadmin) {
    // Try to attach the binding for audit context, but do not require it.
    const binding = await getStorageBinding(supabase, bucket, path);
    return { allowed: true, binding: binding ?? undefined };
  }

  const binding = await getStorageBinding(supabase, bucket, path);
  if (!binding) {
    if (LEGACY_FALLBACK_BUCKETS.has(bucket)) {
      return { allowed: true, legacyFallback: true };
    }
    return { allowed: false, reason: 'no_binding' };
  }

  // Owner path — direct ownership always wins.
  if (binding.owner_user_id && binding.owner_user_id === ctx.actorId) {
    return { allowed: true, binding };
  }

  // Client-scoped path — actor must have an assignment / created the client.
  if (binding.client_id) {
    const { data: created } = await supabase
      .from('clients')
      .select('id')
      .eq('id', binding.client_id)
      .eq('created_by', ctx.actorId)
      .maybeSingle();
    if (created) return { allowed: true, binding };

    const { data: assigned } = await supabase
      .from('finance_portal_client_assignments')
      .select('client_id')
      .eq('client_id', binding.client_id)
      .eq('finance_user_id', ctx.actorId)
      .maybeSingle();
    if (assigned) return { allowed: true, binding };
  }

  return { allowed: false, reason: 'not_authorized', binding };
}
