import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { isSuperadmin, logSecurityEvent } from '../_shared/auth_v2.ts';
import { checkPermission, checkModuleView } from '../_shared/permissions.ts';
import { authorizeObjectAccess, authorizedBindingsForList, createStorageBinding, deleteStorageBinding, rollbackStorageObject, BUCKET_SENSITIVITY } from '../_shared/storageAuthz.ts';
import { requireModulePermission } from '../_shared/authz.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Per-bucket security policy (Security Remediation Phase 3 / STOR-001).
// - operations: the only operations this proxy will perform on the bucket
// - permissionTable: table name mapped through the module permission matrix
//   for write/delete gating (superadmins bypass inside checkPermission)
// - superadminDelete: delete additionally requires superadmin
// - publicUrl is ONLY available for explicitly public buckets
interface BucketPolicy {
  operations: string[];
  permissionTable?: string;
  /**
   * Module key required to READ (download/list/signedUrl/publicUrl) from this
   * bucket. Reads previously had no authorization — any authenticated user
   * could pull any object in an allowed bucket. When set, non-internal reads
   * require can_view on this module (superadmin/service bypass; unregistered
   * module stays open for legacy compatibility). Low-sensitivity/public buckets
   * (branding-assets, report-templates, investment-reports) intentionally omit
   * it so their asset reads stay broadly available.
   */
  readModuleKey?: string;
  superadminDelete?: boolean;
  allowPublicUrl?: boolean;
  /** SVG allowed only on staff-managed asset buckets (branding/templates) */
  allowSvg?: boolean;
  maxUploadBytes: number;
}

const DEFAULT_MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB binary

const BUCKET_POLICIES: Record<string, BucketPolicy> = {
  'client-files':         { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'client_files', readModuleKey: 'client_management', maxUploadBytes: DEFAULT_MAX_UPLOAD },
  'client-documents':     { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'client_files', readModuleKey: 'client_management', maxUploadBytes: DEFAULT_MAX_UPLOAD },
  'formara-forms':         { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'client_files', readModuleKey: 'client_management', maxUploadBytes: DEFAULT_MAX_UPLOAD },
  // Legacy pre-rename bucket: read-only so historical client forms remain retrievable.
  'vownet-forms':         { operations: ['download', 'signedUrl', 'list'], permissionTable: 'client_files', readModuleKey: 'client_management', maxUploadBytes: DEFAULT_MAX_UPLOAD },
  // investment-reports is PRIVATE (STOR-005). Report PDFs and hero/visual
  // assets are served via short-lived signed URLs (report pipeline + hero
  // functions sign from storage_path); publicUrl is no longer offered.
  'investment-reports':   { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'investment_reports', readModuleKey: 'reports', superadminDelete: true, maxUploadBytes: DEFAULT_MAX_UPLOAD },
  'quantitative-reports': { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'investment_reports', readModuleKey: 'reports', superadminDelete: true, maxUploadBytes: DEFAULT_MAX_UPLOAD },
  // report-templates is a public bucket whose asset URLs are embedded in
  // rendered templates; publicUrl remains available (no client PII stored).
  'report-templates':     { operations: ['upload', 'download', 'delete', 'signedUrl', 'list', 'publicUrl'], permissionTable: 'report_templates', allowPublicUrl: true, allowSvg: true, maxUploadBytes: 50 * 1024 * 1024 },
  'branding-assets':      { operations: ['upload', 'download', 'delete', 'signedUrl', 'list', 'publicUrl'], permissionTable: 'branding_profiles', superadminDelete: true, allowPublicUrl: true, allowSvg: true, maxUploadBytes: 10 * 1024 * 1024 },
  'qa_exports':           { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'report_qa_conversations', readModuleKey: 'report_qa', superadminDelete: true, maxUploadBytes: DEFAULT_MAX_UPLOAD },
  'email-attachments':    { operations: ['upload', 'download', 'delete', 'signedUrl', 'list'], permissionTable: 'email_copilot_emails', readModuleKey: 'email_copilot', maxUploadBytes: DEFAULT_MAX_UPLOAD },
};

// Content types that may execute in a browser or shell — rejected on upload.
const FORBIDDEN_CONTENT_TYPES = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml',
  'text/javascript', 'application/javascript', 'application/x-javascript',
  'application/x-msdownload', 'application/x-msdos-program',
  'application/x-sh', 'application/x-bat', 'application/hta',
]);
const FORBIDDEN_EXTENSIONS = /\.(html?|xhtml|svg|js|mjs|exe|dll|bat|cmd|sh|ps1|hta|scr|com|jar)$/i;

const MAX_SIGNED_URL_TTL = 900; // 15 minutes

/**
 * Validate a caller-supplied object path. The proxy still accepts full paths
 * for compatibility, but traversal / absolute / control-character input is
 * rejected outright.
 */
function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.includes('..')) return false;
  // Reject percent-encoded separators/traversal and control characters
  if (/%2e|%2f|%5c/i.test(path)) return false;
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return false;
  return true;
}

function jsonResponse(body: Record<string, unknown>, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function safeFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'upload.bin';
  const base = raw.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'upload.bin';
  return base.slice(0, 120);
}

/**
 * Does this caller administer branding? Superadmin, or `white_label` can_edit —
 * the same gate `manage-branding` uses to persist the row. Requiring superadmin
 * here meant a delegated brand administrator could edit the draft but never
 * upload the artwork it referenced.
 */
async function canAdministerBranding(supabase: any, actorId: string) {
  if (await isSuperadmin(supabase, actorId)) return true;
  for (const moduleKey of ['white_label', 'platform_administration']) {
    const perm = await requireModulePermission(supabase, { userId: actorId, authMethod: 'human' }, moduleKey, 'can_edit');
    if (perm.ok) return true;
  }
  return false;
}

/**
 * May this user manage report templates?
 *
 * The same shape as `canAdministerBranding`, for the same reason: a template
 * being CREATED has no row to be owned by yet — the file is uploaded and the
 * `report_templates` row is written from the result — so there is nothing to
 * bind to and the permission has to stand in its place. `report_templates` is
 * governed by the `templates` module.
 */
async function canManageTemplates(supabase: any, actorId: string) {
  if (await isSuperadmin(supabase, actorId)) return true;
  for (const moduleKey of ['templates', 'platform_administration']) {
    const perm = await requireModulePermission(supabase, { userId: actorId, authMethod: 'human' }, moduleKey, 'can_edit');
    if (perm.ok) return true;
  }
  return false;
}

/**
 * Resolve browser upload binding fields exclusively from authoritative rows.
 *
 * Two different questions about a client are answered here and they are not the
 * same question:
 *
 *  - `clientId` is **who this upload is authorised against**. The caller named
 *    a client, so the canonical ownership check runs before the object is
 *    written and an arbitrary client UUID cannot be attached.
 *  - `objectClientId` is **whose file this object is**. It is recorded on the
 *    `storage_object_bindings` row so the client's own staff can read it back
 *    later, and it authorises nothing at upload time.
 *
 * They are the same value everywhere the caller supplies the client. They part
 * company on `investment-reports`, where the caller names a *report* and the
 * client is derived from it — see that branch.
 */
async function resolveHumanUploadBinding(supabase: any, bucket: string, resourceId: unknown, actorId: string) {
  if (bucket === 'branding-assets') {
    if (!(await canAdministerBranding(supabase, actorId))) return { ok: false as const, reason: 'branding_permission_required' };
    return { ok: true as const, resourceType: 'branding_asset', resourceId: null, clientId: null, objectClientId: null, ownerUserId: actorId };
  }

  if (bucket === 'report-templates') {
    // Editing an existing template binds to that template. Creating one cannot:
    // the uploader writes the file first and the row from the result, so at
    // upload time there is no row. Permission stands in for ownership there,
    // exactly as it does for branding.
    if (typeof resourceId === 'string' && /^[0-9a-f-]{36}$/i.test(resourceId)) {
      const { data, error } = await supabase.from('report_templates').select('id, created_by').eq('id', resourceId).maybeSingle();
      if (error) return { ok: false as const, reason: 'resource_lookup_failed' };
      if (data) {
        return { ok: true as const, resourceType: 'report_template', resourceId: data.id, clientId: null, objectClientId: null, ownerUserId: data.created_by };
      }
    }
    if (!(await canManageTemplates(supabase, actorId))) return { ok: false as const, reason: 'template_permission_required' };
    return { ok: true as const, resourceType: 'report_template', resourceId: null, clientId: null, objectClientId: null, ownerUserId: actorId };
  }

  if (typeof resourceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(resourceId)) return { ok: false as const, reason: 'resource_required' };
  if (bucket === 'qa_exports') {
    const { data, error } = await supabase.from('report_qa_conversations').select('id, created_by, client_id').eq('id', resourceId).maybeSingle();
    if (error) return { ok: false as const, reason: 'resource_lookup_failed' };
    if (!data) return { ok: false as const, reason: 'resource_not_found' };
    return { ok: true as const, resourceType: 'report_qa_conversation', resourceId: data.id, clientId: data.client_id, objectClientId: data.client_id, ownerUserId: data.created_by };
  }
  if (bucket === 'investment-reports') {
    // `investment_reports` has neither `client_id` nor `created_by`; it names
    // them `client_property_id` and `generated_by`. PostgREST answers 42703 for
    // a column that does not exist, the discarded `error` left `data` null, and
    // a *failed read* was then reported as an *absent row* — so every human
    // upload to this bucket was refused 403 "Invalid upload resource". That is
    // what reached an adviser as "PDF generation failed. Please try again." on
    // the Cash Flow Analysis send-to-client. Same class as
    // `_shared/aml/caseTenant.ts`.
    const { data, error } = await supabase
      .from('investment_reports')
      .select('id, client_property_id')
      .eq('id', resourceId)
      .maybeSingle();
    if (error) return { ok: false as const, reason: 'resource_lookup_failed' };
    if (!data) return { ok: false as const, reason: 'resource_not_found' };

    // Authorisation for this bucket is the `reports` module, and it has already
    // run: the write gate above requires `can_edit` on it before a binding is
    // resolved at all, and reads require `can_view` on the same module. So the
    // upload binds to the actor.
    //
    // It deliberately does NOT bind to `generated_by`. That column is not an
    // access control: the report library is listed by module permission rather
    // than by who generated a row, so a colleague may open this very report on
    // the Cash Flow Analysis page — and it is nullable, so a bulk-generated
    // report has nobody in it. Binding to it would refuse both, as a bare
    // "Not found", for an act the page itself offers.
    //
    // The report's client is recorded on the binding rather than checked here.
    // A report reaches a client through the property it was written about;
    // `client_property_id` is null for a report drawn from a listing or a bare
    // address, which is the ordinary case and not a failure.
    let objectClientId: string | null = null;
    if (data.client_property_id) {
      const { data: property, error: propertyError } = await supabase
        .from('client_properties')
        .select('client_id')
        .eq('id', data.client_property_id)
        .maybeSingle();
      if (propertyError) return { ok: false as const, reason: 'resource_lookup_failed' };
      objectClientId = property?.client_id || null;
    }

    return {
      ok: true as const,
      resourceType: 'investment_report',
      resourceId: data.id,
      clientId: null,
      objectClientId,
      ownerUserId: actorId,
    };
  }
  // Client/document uploads use the client record itself as the authoritative
  // resource; callers never provide owner or client metadata separately.
  const { data, error } = await supabase.from('clients').select('id, created_by, assigned_team_user_id').eq('id', resourceId).maybeSingle();
  if (error) return { ok: false as const, reason: 'resource_lookup_failed' };
  if (data) {
    return { ok: true as const, resourceType: 'client', resourceId: data.id, clientId: data.id, objectClientId: data.id, ownerUserId: data.created_by || data.assigned_team_user_id || null };
  }

  // An attachment to the user's own agent conversation. Tried only after the
  // client lookup misses, so every existing binding resolves exactly as before.
  // Scoped to conversations the actor owns: a staff member may attach a file to
  // their own chat and to nobody else's.
  const { data: conversation, error: conversationError } = await supabase
    .from('agent_conversations')
    .select('id, user_id')
    .eq('id', resourceId)
    .eq('user_id', actorId)
    .maybeSingle();
  if (conversationError) return { ok: false as const, reason: 'resource_lookup_failed' };
  if (conversation) {
    return { ok: true as const, resourceType: 'agent_conversation', resourceId: conversation.id, clientId: null, objectClientId: null, ownerUserId: conversation.user_id };
  }

  return { ok: false as const, reason: 'resource_not_found' };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();

    const {
      operation,  // 'upload', 'download', 'delete', 'signedUrl', 'list', 'publicUrl'
      bucket,
      path,
      file_data,      // Base64 encoded file content for upload
      content_type,   // MIME type for upload
      expires_in,     // Seconds for signed URL
      upsert,         // Boolean for upload
      // WP-06 Phase B — binding metadata (upload) / list scope
      resource_type,
      resource_id,
      client_id: bindingClientId,
      owner_user_id: bindingOwnerUserId,
      list_client_id,
      list_owner_user_id,
    } = body;

    // Validate authentication (JWT first, then session token)
    const sessionResult = await verifyAuth(supabase, req.headers, body);
    if (sessionResult.error) {
      console.log(`[Secure Storage] Auth failed: ${sessionResult.error}`);
      return createUnauthorizedResponse(sessionResult.error, corsHeaders);
    }
    const actorId = sessionResult.userId!;
    const isInternal = sessionResult.authMethod === 'service_role';

    console.log(`[Secure Storage] User ${sessionResult.username || actorId} - ${operation} on ${bucket}/${typeof path === 'string' ? path : '[multi]'}`);

    // Validate bucket against the policy map (deny by default)
    const policy = bucket ? BUCKET_POLICIES[bucket] : undefined;
    if (!policy) {
      return jsonResponse({ success: false, error: 'Invalid bucket' }, corsHeaders, 400);
    }

    // Validate operation against the bucket policy (deny by default)
    if (typeof operation !== 'string' || !policy.operations.includes(operation)) {
      await logSecurityEvent(supabase, {
        action: `storage.${operation}`, decision: 'deny', reason_code: 'operation_not_allowed',
        actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
        target_type: 'bucket', target_id: bucket,
      });
      return jsonResponse({ success: false, error: 'Operation not permitted for this bucket' }, corsHeaders, 403);
    }

    // Validate paths for every operation that takes one
    const rawPaths: unknown[] = operation === 'delete' && Array.isArray(path) ? path : path !== undefined && path !== null && path !== '' ? [path] : [];
    for (const p of rawPaths) {
      if (!isSafePath(p)) {
        await logSecurityEvent(supabase, {
          action: `storage.${operation}`, decision: 'deny', reason_code: 'unsafe_path',
          actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
          target_type: 'bucket', target_id: bucket,
        });
        return jsonResponse({ success: false, error: 'Invalid path' }, corsHeaders, 400);
      }
    }

    // Permission gating for mutating operations (internal service calls bypass)
    if (!isInternal && (operation === 'upload' || operation === 'delete')) {
      // Branding artwork is governed by the Branding module itself, not by a
      // table in the permission matrix — `branding_profiles` is unmapped there,
      // so routing it through checkPermission() denied every non-superadmin.
      if (bucket === 'branding-assets') {
        if (!(await canAdministerBranding(supabase, actorId))) {
          await logSecurityEvent(supabase, {
            action: `storage.${operation}`, decision: 'deny', reason_code: 'branding_permission_required',
            actor_type: 'human', actor_id: actorId, target_type: 'bucket', target_id: bucket,
          });
          return createForbiddenResponse('You do not have permission to manage branding assets', corsHeaders);
        }
        if (operation === 'delete' && !(await isSuperadmin(supabase, actorId))) {
          return createForbiddenResponse('Delete on this bucket requires superadmin', corsHeaders);
        }
      } else {
      const writeModule = bucket === 'qa_exports' ? 'report_qa'
        : bucket === 'investment-reports' || bucket === 'quantitative-reports' ? 'reports'
        : 'clients';
      const modulePerm = await requireModulePermission(supabase, { userId: actorId, authMethod: 'human' }, writeModule, operation === 'delete' ? 'can_delete' : 'can_edit');
      if (!modulePerm.ok) return createForbiddenResponse('Permission denied', corsHeaders);
      if (operation === 'delete' && policy.superadminDelete) {
        if (!(await isSuperadmin(supabase, actorId))) {
          await logSecurityEvent(supabase, {
            action: 'storage.delete', decision: 'deny', reason_code: 'superadmin_required',
            actor_type: 'human', actor_id: actorId, target_type: 'bucket', target_id: bucket,
          });
          return createForbiddenResponse('Delete on this bucket requires superadmin', corsHeaders);
        }
      } else if (policy.permissionTable) {
        const permOp = operation === 'delete' ? 'delete' : 'create';
        const perm = await checkPermission(supabase, actorId, policy.permissionTable, permOp, sessionResult.authMethod);
        if (!perm.allowed) {
          await logSecurityEvent(supabase, {
            action: `storage.${operation}`, decision: 'deny', reason_code: 'module_permission_denied',
            actor_type: 'human', actor_id: actorId, target_type: 'bucket', target_id: bucket,
          });
          return createForbiddenResponse(perm.reason || 'Permission denied', corsHeaders);
        }
      }
      }
    }


    // Read-side authorization (EC-5): download/list/signedUrl/publicUrl were
    // previously unauthorized beyond "is authenticated". Require can_view on the
    // bucket's governing module so a caller without that module cannot read its
    // objects. (Object-level ownership — tying a specific path to the caller's
    // client assignment / report ownership — is the deeper follow-up; this
    // closes the any-authenticated-staff read hole.)
    if (!isInternal && policy.readModuleKey &&
        (operation === 'download' || operation === 'list' || operation === 'signedUrl' || operation === 'publicUrl')) {
      // requireRegistered=true: an unregistered module key must fail closed.
      // It previously fell open, and every client-document bucket named a
      // module key ('clients') that does not exist in dashboard_modules — the
      // registered key is 'client_management'. The gate below was therefore
      // authorizing nothing at all for exactly the buckets holding client PII.
      const readPerm = await checkModuleView(supabase, actorId, policy.readModuleKey, sessionResult.authMethod, true);
      if (!readPerm.allowed) {
        await logSecurityEvent(supabase, {
          action: `storage.${operation}`, decision: 'deny', reason_code: 'read_permission_denied',
          actor_type: 'human', actor_id: actorId, target_type: 'bucket', target_id: bucket,
        });
        return createForbiddenResponse(readPerm.reason || 'Read permission denied', corsHeaders);
      }
    }


    // WP-06 object-level authorization: for sensitive buckets, resolve the
    // storage_object_bindings ledger and deny (as 404) when the caller is not
    // tied to the bound resource. Legacy paths without a binding fall through
    // to the existing per-bucket module gate above (see LEGACY_FALLBACK_BUCKETS).
    const sensitivity = BUCKET_SENSITIVITY[bucket];
    const isObjectOp =
      operation === 'download' || operation === 'signedUrl' ||
      operation === 'delete'   || operation === 'publicUrl';
    if (!isInternal && sensitivity && sensitivity !== 'public_asset' && isObjectOp) {
      const targets: string[] = operation === 'delete' && Array.isArray(path)
        ? path.filter((p): p is string => typeof p === 'string')
        : (typeof path === 'string' && path ? [path] : []);
      const superadmin = await isSuperadmin(supabase, actorId);
      for (const p of targets) {
        const authz = await authorizeObjectAccess(supabase, bucket, p, {
          actorId, isSuperadmin: superadmin, isInternalService: false, authMethod: sessionResult.authMethod,
        });
        if (!authz.allowed) {
          await logSecurityEvent(supabase, {
            action: `storage.${operation}`, decision: 'deny',
            reason_code: authz.reason || 'object_authz_denied',
            actor_type: 'human', actor_id: actorId,
            target_type: 'storage_object', target_id: `${bucket}/${p}`,
          });
          // Return 404 to avoid enumerating object existence.
          return jsonResponse({ success: false, error: 'Not found' }, corsHeaders, 404);
        }
        if (authz.legacyFallback) {
          await logSecurityEvent(supabase, {
            action: `storage.${operation}`, decision: 'allow',
            reason_code: 'legacy_fallback_no_binding',
            actor_type: 'human', actor_id: actorId,
            target_type: 'storage_object', target_id: `${bucket}/${p}`,
          });
        }
      }
    }

    // Handle operations
    switch (operation) {
      case 'upload': {
        if (!file_data || typeof file_data !== 'string') {
          return jsonResponse({ success: false, error: 'Missing file_data' }, corsHeaders, 400);
        }

        // Human callers cannot choose paths, overwrite flags, binding type,
        // owner, or client. Those fields are derived below from a server-side
        // authoritative resource row. Internal producers retain their explicit
        // paths while still creating an immutable binding.
        let uploadPath = path as string;
        let uploadBinding: any = null;
        if (!isInternal) {
          // `upsert` is meaningless for a human caller because the destination
          // path is server-generated and unique, so an overwrite can never
          // happen. Rejecting the flag outright only broke callers that passed
          // it defensively (the Branding page did) — ignore it instead.
          uploadBinding = await resolveHumanUploadBinding(supabase, bucket, resource_id, actorId);
          if (!uploadBinding.ok) {
            // A read that FAILED is not a resource that is ABSENT. Answering a
            // database fault with 403 tells the operator they are not allowed
            // to do something they are allowed to do, and there is nothing to
            // retry; 503 says what it is and that trying again may work.
            if (uploadBinding.reason === 'resource_lookup_failed') {
              return jsonResponse(
                { success: false, error: 'The record this upload belongs to could not be read. Please try again.' },
                corsHeaders,
                503,
              );
            }
            return jsonResponse(
              { success: false, error: uploadBinding.reason === 'branding_permission_required'
                ? 'You do not have permission to manage branding assets'
                : uploadBinding.reason === 'template_permission_required'
                  ? 'You do not have permission to manage report templates'
                  : uploadBinding.reason === 'resource_required'
                    ? 'This upload did not say which record it belongs to'
                    : 'Invalid upload resource' },
              corsHeaders,
              403,
            );
          }

          // The probe has no binding; use the canonical client ownership check
          // directly so an arbitrary client UUID cannot be attached.
          if (uploadBinding.clientId) {
            const { data: client, error: clientError } = await supabase.from('clients').select('created_by, assigned_team_user_id').eq('id', uploadBinding.clientId).maybeSingle();
            // Again: a read that failed is not a client who is absent. This one
            // discarded its error too, so a database fault answered "Not found".
            if (clientError) return jsonResponse({ success: false, error: 'The client record could not be read. Please try again.' }, corsHeaders, 503);
            if (!client || (client.created_by !== actorId && client.assigned_team_user_id !== actorId && !(await isSuperadmin(supabase, actorId)))) return jsonResponse({ success: false, error: 'Not found' }, corsHeaders, 404);
          } else if (uploadBinding.ownerUserId !== actorId && !(await isSuperadmin(supabase, actorId))) {
            return jsonResponse({ success: false, error: 'Not found' }, corsHeaders, 404);
          }
          uploadPath = `${uploadBinding.clientId || uploadBinding.objectClientId || uploadBinding.ownerUserId || actorId}/${crypto.randomUUID()}-${safeFileName(path)}`;
        }

        // Enforce size cap BEFORE decoding (base64 is ~4/3 of binary size)
        const approxBytes = Math.floor(file_data.length * 3 / 4);
        if (approxBytes > policy.maxUploadBytes) {
          await logSecurityEvent(supabase, {
            action: 'storage.upload', decision: 'deny', reason_code: 'size_limit',
            actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
            target_type: 'bucket', target_id: bucket, metadata: { approxBytes },
          });
          return jsonResponse({ success: false, error: 'File exceeds size limit for this bucket' }, corsHeaders, 413);
        }

        // Block browser-executable / active content on all buckets
        const declaredType = (content_type || 'application/octet-stream').toLowerCase().split(';')[0].trim();
        const svgAttempt = declaredType === 'image/svg+xml' || /\.svg$/i.test(uploadPath);
        const blocked = svgAttempt
          ? !policy.allowSvg
          : (FORBIDDEN_CONTENT_TYPES.has(declaredType) || FORBIDDEN_EXTENSIONS.test(path));
        if (blocked) {
          await logSecurityEvent(supabase, {
            action: 'storage.upload', decision: 'deny', reason_code: 'forbidden_content_type',
            actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
            target_type: 'bucket', target_id: bucket, metadata: { declaredType },
          });
          return jsonResponse({ success: false, error: 'This file type is not permitted' }, corsHeaders, 415);
        }

        const fileBytes = base64Decode(file_data);

        const { data, error } = await supabase.storage
          .from(bucket)
          .upload(uploadPath, fileBytes, {
            contentType: content_type || 'application/octet-stream',
            upsert: isInternal ? upsert === true : false,
          });

        if (error) {
          console.error(`[Secure Storage] Upload error:`, error);
          return jsonResponse({ success: false, error: 'Upload failed' }, corsHeaders, 500);
        }

        // WP-06 Phase B — persist a storage_object_bindings row so this object
        // is authorizable on future reads. Sensitive buckets require a resource
        // reference (client_id OR owner_user_id); if the caller omitted both we
        // fall back to owner_user_id = actorId and log `binding_owner_fallback`
        // so producers still-missing metadata are visible in telemetry.
        const sensitivityAtUpload = BUCKET_SENSITIVITY[bucket];
        if (sensitivityAtUpload && sensitivityAtUpload !== 'public_asset') {
          const resolvedOwner = isInternal ? (typeof bindingOwnerUserId === 'string' ? bindingOwnerUserId : null) : uploadBinding.ownerUserId;
          const bindingRes = await createStorageBinding(supabase, {
            bucket,
            object_path: data.path,
            resource_type: isInternal ? (typeof resource_type === 'string' && resource_type ? resource_type : 'generic') : uploadBinding.resourceType,
            resource_id: isInternal ? (typeof resource_id === 'string' ? resource_id : null) : uploadBinding.resourceId,
            // `objectClientId` rather than `clientId`: what this object is
            // about, not what the upload was authorised against. They differ
            // only on `investment-reports` — see `resolveHumanUploadBinding`.
            client_id: isInternal ? (typeof bindingClientId === 'string' ? bindingClientId : null) : uploadBinding.objectClientId,
            owner_user_id: resolvedOwner,
            sensitivity: sensitivityAtUpload,
            created_by: isInternal ? null : actorId,
          });
          if (!bindingRes.ok) {
            // Rollback: remove the just-uploaded object so we never leave an
            // orphan that reads cannot authorize against.
            await rollbackStorageObject(supabase, bucket, data.path);
            await logSecurityEvent(supabase, {
              action: 'storage.upload', decision: 'deny', reason_code: 'binding_create_failed',
              actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
              target_type: 'storage_object', target_id: `${bucket}/${data.path}`,
            });
            return jsonResponse({ success: false, error: 'Upload failed' }, corsHeaders, 500);
          }
        }

        console.log(`[Secure Storage] Uploaded: ${bucket}/${path}`);
        return jsonResponse({ success: true, data: { path: data.path, fullPath: data.fullPath } }, corsHeaders);
      }

      case 'download': {
        if (!path) {
          return jsonResponse({ success: false, error: 'Missing path' }, corsHeaders, 400);
        }

        const { data, error } = await supabase.storage
          .from(bucket)
          .download(path);

        if (error) {
          console.error(`[Secure Storage] Download error:`, error);
          return jsonResponse({ success: false, error: 'Download failed' }, corsHeaders, 500);
        }

        // Convert blob to base64 for transport — chunked to avoid call stack overflow on large files
        const arrayBuffer = await data.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const CHUNK = 8192;
        let binaryStr = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binaryStr += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
        }
        const base64 = btoa(binaryStr);

        console.log(`[Secure Storage] Downloaded: ${bucket}/${path}`);
        return jsonResponse({
          success: true,
          data: { content: base64, contentType: data.type, size: data.size }
        }, corsHeaders);
      }

      case 'delete': {
        if (!path) {
          return jsonResponse({ success: false, error: 'Missing path' }, corsHeaders, 400);
        }

        const paths = (Array.isArray(path) ? path : [path]) as string[];

        const { error } = await supabase.storage
          .from(bucket)
          .remove(paths);

        if (error) {
          console.error(`[Secure Storage] Delete error:`, error);
          return jsonResponse({ success: false, error: 'Delete failed' }, corsHeaders, 500);
        }

        // WP-06: clean up bindings for the deleted objects (best-effort).
        for (const p of paths) {
          await deleteStorageBinding(supabase, bucket, p);
        }

        await logSecurityEvent(supabase, {
          action: 'storage.delete', decision: 'allow',
          actor_type: isInternal ? 'internal_service' : 'human', actor_id: actorId,
          target_type: 'bucket', target_id: bucket, metadata: { count: paths.length },
        });
        console.log(`[Secure Storage] Deleted: ${bucket}/${paths.join(', ')}`);
        return jsonResponse({ success: true, data: { deleted: paths } }, corsHeaders);
      }

      case 'signedUrl': {
        if (!path) {
          return jsonResponse({ success: false, error: 'Missing path' }, corsHeaders, 400);
        }

        // Cap TTL: short-lived URLs limit leak impact (STOR-004)
        const requestedTtl = Number(expires_in) || 3600;
        const ttl = Math.min(Math.max(requestedTtl, 60), MAX_SIGNED_URL_TTL);

        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, ttl);

        if (error) {
          console.error(`[Secure Storage] Signed URL error:`, error);
          return jsonResponse({ success: false, error: 'Could not create signed URL' }, corsHeaders, 500);
        }

        console.log(`[Secure Storage] Created signed URL: ${bucket}/${path} (ttl=${ttl}s)`);
        return jsonResponse({ success: true, data: { signedUrl: data.signedUrl } }, corsHeaders);
      }

      case 'list': {
        // WP-06 Phase B — sensitive buckets require a resource scope so the
        // caller cannot enumerate objects outside their assignment. We resolve
        // the authorized set from storage_object_bindings, then intersect with
        // the physical storage.list results. Public-asset buckets keep the
        // existing prefix-based behaviour.
        const sensitivityAtList = BUCKET_SENSITIVITY[bucket];
        const requiresScope = !isInternal && sensitivityAtList && sensitivityAtList !== 'public_asset';
        if (requiresScope) {
          const scopeClient = typeof list_client_id === 'string' ? list_client_id : null;
          const scopeOwner  = typeof list_owner_user_id === 'string' ? list_owner_user_id : null;
          if (!scopeClient && !scopeOwner) {
            await logSecurityEvent(supabase, {
              action: 'storage.list', decision: 'deny', reason_code: 'list_scope_required',
              actor_type: 'human', actor_id: actorId, target_type: 'bucket', target_id: bucket,
            });
            return jsonResponse({ success: false, error: 'A resource scope is required to list this bucket' }, corsHeaders, 400);
          }
          const superadminForList = await isSuperadmin(supabase, actorId);
          const bindings = await authorizedBindingsForList(supabase, bucket, {
            actorId, isSuperadmin: superadminForList, isInternalService: false, authMethod: sessionResult.authMethod,
          }, { clientId: scopeClient, ownerUserId: scopeOwner });
          console.log(`[Secure Storage] Listed (scoped): ${bucket} client=${scopeClient} owner=${scopeOwner} (${bindings.length} items)`);
          return jsonResponse({
            success: true,
            data: { files: bindings.map((b) => ({ name: b.object_path, id: b.id, metadata: { resource_type: b.resource_type, resource_id: b.resource_id } })) },
          }, corsHeaders);
        }

        const { data, error } = await supabase.storage
          .from(bucket)
          .list(typeof path === 'string' ? path : '', { limit: 100, offset: 0 });

        if (error) {
          console.error(`[Secure Storage] List error:`, error);
          return jsonResponse({ success: false, error: 'List failed' }, corsHeaders, 500);
        }

        console.log(`[Secure Storage] Listed: ${bucket}/${path || ''} (${data?.length || 0} items)`);
        return jsonResponse({ success: true, data: { files: data } }, corsHeaders);
      }

      case 'publicUrl': {
        // Policy-gated: only buckets explicitly marked public (branding assets)
        if (!policy.allowPublicUrl) {
          return createForbiddenResponse('Public URLs are not available for this bucket', corsHeaders);
        }
        if (!path) {
          return jsonResponse({ success: false, error: 'Missing path' }, corsHeaders, 400);
        }

        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(path);

        console.log(`[Secure Storage] Public URL: ${bucket}/${path}`);
        return jsonResponse({ success: true, data: { publicUrl: data.publicUrl } }, corsHeaders);
      }

      default:
        return jsonResponse({ success: false, error: 'Unknown operation' }, corsHeaders, 400);
    }

  } catch (error) {
    console.error('[Secure Storage] Error:', error);
    // Generic public error; details stay in server logs (ERR-001)
    return jsonResponse({ success: false, error: 'Internal error' }, corsHeaders, 500);
  }
});
