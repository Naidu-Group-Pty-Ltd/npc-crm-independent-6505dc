// WP-09A — Generated documents + DocuSign (hardened)
// - Explicit input schemas per action
// - Server-side bucket allowlist (caller `bucket` ignored)
// - Resource-ownership access checks (client_id / deal_id)
// - Status finite-state machine
// - Immutable server-only fields (docusign_*, signed_*, sent_at/viewed_at/signed_at/voided_at, audit, generated_by)
// - Idempotency key + PDF hash for send_freeform
// - Recipient/tab bounds; recipient emails validated
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission, permForAction } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { getDocuSignAccessToken, getDocuSignRestBaseUrl } from '../_shared/docusign-auth.ts';
import { buildFreeformEnvelope, pdfBytesToBase64, type FreeformRecipient, type FreeformTab } from '../_shared/docusign-freeform.ts';
import { isSuperadmin } from '../_shared/wp08Guards.ts';
import { requireStepUp } from '../_shared/stepUp.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  GENERATED_DOC_BUCKET_ALLOWLIST, resolveDocumentBucket,
  isValidDocTransition, type DocStatus,
  DOC_SERVICE_ONLY_FIELDS, DOC_UPDATE_ALLOWED_FIELDS,
  resolveGeneratedDocumentAccess,
  pickAllowed, sha256Hex, normalizeIdempotencyKey,
  MAX_FREEFORM_RECIPIENTS, MAX_FREEFORM_TABS, validateEmail,
} from '../_shared/wp09Guards.ts';

interface Body {
  action: 'list' | 'get' | 'create' | 'update' | 'update_status' | 'append_audit' | 'list_signature_events' | 'delete' | 'save_signing_layout' | 'send_freeform' | 'check_status' | 'envelope_details' | 'download_signed';
  id?: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  session_token?: string;
  signing_recipients?: FreeformRecipient[];
  signing_layout?: FreeformTab[];
  email_subject?: string;
  email_blurb?: string;
  idempotency_key?: string;
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body: Body = await req.json();
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error || 'Auth required', cors);

    const authz = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'agreements',
      permForAction(body.action),
    );
    if (!authz.ok) {
      await logSecurityEvent(supabase, {
        action: `generated_documents.${body.action}`,
        decision: 'deny', reason_code: authz.reason_code,
        actor_type: 'human', actor_id: auth.userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', cors);
    }

    const isSuper = await isSuperadmin(supabase, auth.userId, auth.authMethod);

    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    // Fetch-and-authorize helper used by every id-scoped action.
    const loadAndAuthorize = async () => {
      if (!body.id) return { err: j({ success: false, error: 'Missing id' }, 400) as Response };
      const { data: doc, error } = await supabase
        .from('generated_documents').select('*').eq('id', body.id).maybeSingle();
      if (error) return { err: j({ success: false, error: error.message }, 500) };
      if (!doc) return { err: j({ success: false, error: 'Not found' }, 404) };
      const access = await resolveGeneratedDocumentAccess(supabase, auth.userId!, isSuper, doc);
      if (!access.ok) {
        await logSecurityEvent(supabase, {
          action: `generated_documents.${body.action}`, decision: 'deny',
          reason_code: 'resource_denied', actor_type: 'human', actor_id: auth.userId!,
          resource_id: body.id,
        } as any);
        return { err: createForbiddenResponse('Access denied', cors) };
      }
      return { doc };
    };

    switch (body.action) {
      case 'list': {
        let q = supabase.from('generated_documents').select('*').order('created_at', { ascending: false }).limit(500);
        const f = body.filters || {};
        if (f.client_id) q = q.eq('client_id', f.client_id);
        if (f.deal_id) q = q.eq('deal_id', f.deal_id);
        if (f.submission_id) q = q.eq('submission_id', f.submission_id);
        if (f.status) q = q.eq('status', f.status);
        if (f.template_type) q = q.eq('template_type', f.template_type);
        // Non-superadmin: scope to caller's docs OR their assigned clients.
        if (!isSuper) q = q.eq('generated_by', auth.userId!);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'get': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        return j({ success: true, data: r.doc });
      }

      case 'create': {
        const payload = pickAllowed(body.data, DOC_UPDATE_ALLOWED_FIELDS, DOC_SERVICE_ONLY_FIELDS);
        const insertRow = {
          ...payload,
          generated_by: auth.userId,
          status: 'draft',
        };
        const { data, error } = await supabase.from('generated_documents').insert(insertRow).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'update': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const payload = pickAllowed(body.data, DOC_UPDATE_ALLOWED_FIELDS, DOC_SERVICE_ONLY_FIELDS);
        if (Object.keys(payload).length === 0) return j({ success: false, error: 'No allowed fields to update' }, 400);
        const { data, error } = await supabase.from('generated_documents').update(payload).eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'update_status': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const nextStatus = String(body.data?.status || '') as DocStatus;
        if (!isValidDocTransition(r.doc.status as DocStatus, nextStatus)) {
          return j({ success: false, error: `Invalid transition ${r.doc.status} → ${nextStatus}` }, 409);
        }
        // Human callers cannot set signed/voided directly — those come from DocuSign flows.
        if (['sent', 'signed', 'viewed', 'voided', 'delivered', 'declined'].includes(nextStatus) && !isSuper) {
          return j({ success: false, error: 'Status change reserved for envelope events' }, 403);
        }
        const updates: Record<string, any> = { status: nextStatus };
        const { data, error } = await supabase.from('generated_documents').update(updates).eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        // Server-side audit
        const auditArr = Array.isArray(r.doc.audit) ? r.doc.audit : [];
        auditArr.push({ ts: new Date().toISOString(), user_id: auth.userId, event: 'status_change', from: r.doc.status, to: nextStatus });
        await supabase.from('generated_documents').update({ audit: auditArr }).eq('id', body.id!);
        return j({ success: true, data });
      }

      case 'append_audit': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const note = typeof body.data?.note === 'string' ? body.data.note.slice(0, 1000) : '';
        const eventType = typeof body.data?.event_type === 'string' ? body.data.event_type.slice(0, 64) : 'note';
        const audit = Array.isArray(r.doc.audit) ? r.doc.audit : [];
        audit.push({ ts: new Date().toISOString(), user_id: auth.userId, event: eventType, note });
        const { data, error } = await supabase.from('generated_documents').update({ audit }).eq('id', body.id!).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'delete': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        if (['sent', 'signed'].includes(r.doc.status)) return j({ success: false, error: 'Cannot delete sent/signed document' }, 409);
        const { error } = await supabase.from('generated_documents').delete().eq('id', body.id!);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data: { ok: true } });
      }

      case 'list_signature_events': {
        const f = body.filters || {};
        let q = supabase.from('document_signature_events').select('*').order('occurred_at', { ascending: false }).limit(200);
        if (f.document_id) q = q.eq('document_id', f.document_id);
        else if (f.compliance_record_id) q = q.eq('compliance_record_id', f.compliance_record_id);
        else if (f.envelope_id) q = q.eq('docusign_envelope_id', f.envelope_id);
        else return j({ success: false, error: 'Filter required' }, 400);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'save_signing_layout': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const recipients = (body.signing_recipients ?? []).slice(0, MAX_FREEFORM_RECIPIENTS);
        const tabs = (body.signing_layout ?? []).slice(0, MAX_FREEFORM_TABS);
        const { error } = await supabase.from('generated_documents').update({
          signing_recipients: recipients,
          signing_layout: tabs,
          signing_prepared_at: new Date().toISOString(),
        }).eq('id', body.id!);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }

      case 'send_freeform': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const doc = r.doc;
        // Step-up gate for money/legally-binding actions
        if (!isSuper) {
          const gate = await requireStepUp(supabase, {
            userId: auth.userId,
            capability: 'docusign.send',
            req,
            body,
          });
          if (gate) return gate;
        }
        if (['sent', 'signed', 'voided'].includes(doc.status) && !body.idempotency_key) {
          return j({ success: false, error: 'Document already sent; provide idempotency_key to retry' }, 409);
        }
        const idem = normalizeIdempotencyKey(body.idempotency_key);
        if (idem && doc.metadata?.last_idempotency_key === idem && doc.docusign_envelope_id) {
          return j({ success: true, envelope_id: doc.docusign_envelope_id, status: doc.docusign_status, idempotent: true });
        }
        const recipients = body.signing_recipients ?? [];
        const tabs = body.signing_layout ?? [];
        if (recipients.length === 0 || recipients.length > MAX_FREEFORM_RECIPIENTS) return j({ success: false, error: `1-${MAX_FREEFORM_RECIPIENTS} recipients required` }, 400);
        if (tabs.length === 0 || tabs.length > MAX_FREEFORM_TABS) return j({ success: false, error: 'Invalid tab count' }, 400);
        for (const rec of recipients) {
          if (!validateEmail(rec.email) || !rec.name || rec.name.length > 200) {
            return j({ success: false, error: 'Recipient invalid name/email' }, 400);
          }
        }
        if (!doc.pdf_storage_path) return j({ success: false, error: 'PDF not ready' }, 409);

        // Server-derived bucket (caller value ignored)
        const bucket = resolveDocumentBucket(doc.template_type);
        if (!GENERATED_DOC_BUCKET_ALLOWLIST.has(bucket)) return j({ success: false, error: 'Bucket not allowed' }, 500);

        const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(doc.pdf_storage_path);
        if (dlErr || !blob) return j({ success: false, error: `Failed to load PDF: ${dlErr?.message}` }, 500);
        const pdfBytes = new Uint8Array(await blob.arrayBuffer());
        const pdfHash = await sha256Hex(pdfBytes);

        // If document was approved and pdf_hash captured, ensure it matches (tamper check)
        if (doc.pdf_hash && doc.pdf_hash !== pdfHash) {
          return j({ success: false, error: 'PDF has changed since approval', code: 'pdf_hash_mismatch' }, 409);
        }

        const accountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
        if (!accountId) return j({ success: false, error: 'DocuSign not configured', requires_setup: true }, 422);
        let token: string;
        try { token = await getDocuSignAccessToken(); }
        catch (e: any) { return j({ success: false, error: `DocuSign auth: ${e.message}` }, 401); }

        const envelope = buildFreeformEnvelope({
          pdfBase64: pdfBytesToBase64(pdfBytes),
          documentName: `${doc.title || 'Document'}.pdf`,
          recipients, tabs,
          emailSubject: (body.email_subject || `${doc.title || 'Document for signature'}`).slice(0, 200),
          emailBlurb: (body.email_blurb || 'Please review and sign the attached document.').slice(0, 4000),
        });
        const url = `${getDocuSignRestBaseUrl()}/v2.1/accounts/${accountId}/envelopes`;
        const dsRes = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(envelope),
        });
        const txt = await dsRes.text();
        let dsData: any;
        try { dsData = JSON.parse(txt); }
        catch { return j({ success: false, error: `DocuSign non-JSON (${dsRes.status})` }, 502); }
        if (!dsRes.ok) {
          console.error('[generated-docs freeform] envelope failed:', txt.substring(0, 1000));
          return j({ success: false, error: `DocuSign rejected the request` }, dsRes.status);
        }
        const audit = Array.isArray(doc.audit) ? doc.audit : [];
        audit.push({ ts: new Date().toISOString(), user_id: auth.userId, event: 'sent', envelope_id: dsData.envelopeId, pdf_hash: pdfHash, recipients: recipients.length });
        const { error: persistError } = await supabase.from('generated_documents').update({
          status: 'sent',
          docusign_envelope_id: dsData.envelopeId,
          docusign_status: dsData.status,
          sent_at: new Date().toISOString(),
          sent_to: recipients.map(r => r.email),
          signing_recipients: recipients,
          signing_layout: tabs,
          signing_prepared_at: new Date().toISOString(),
          pdf_hash: pdfHash,
          audit,
          metadata: { ...(doc.metadata || {}), last_idempotency_key: idem },
        }).eq('id', body.id!);
        if (persistError) {
          console.error('[generated-docs freeform] failed to persist sent envelope:', persistError.message);
          return j({
            success: false,
            error: 'Envelope was sent but its status could not be recorded; contact support before retrying',
            code: 'envelope_persistence_failed',
            envelope_id: dsData.envelopeId,
          }, 500);
        }
        return j({ success: true, envelope_id: dsData.envelopeId, status: dsData.status, pdf_hash: pdfHash });
      }

      case 'check_status':
      case 'envelope_details': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const doc = r.doc;
        if (!doc?.docusign_envelope_id) return j({ success: false, error: 'Envelope not found' }, 404);
        const acct = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
        if (!acct) return j({ success: false, error: 'DocuSign not configured' }, 422);
        let token: string;
        try { token = await getDocuSignAccessToken(); }
        catch (e: any) { return j({ success: false, error: `DocuSign auth: ${e.message}` }, 401); }
        const hdr = { Authorization: `Bearer ${token}` };
        const base = getDocuSignRestBaseUrl();
        const envId = doc.docusign_envelope_id;
        const [envRes, recRes, evtRes] = await Promise.all([
          fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}`, { headers: hdr }),
          fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}/recipients`, { headers: hdr }),
          fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}/audit_events`, { headers: hdr }),
        ]);
        const envelope = await envRes.json();
        if (!envRes.ok) return j({ success: false, error: 'DocuSign lookup failed' }, 502);
        const recipients = recRes.ok ? await recRes.json() : null;
        const auditRaw = evtRes.ok ? await evtRes.json() : null;

        let newStatus = doc.status;
        const updates: Record<string, any> = { docusign_status: envelope.status };
        if (envelope.status === 'completed') { newStatus = 'signed'; updates.signed_at = envelope.completedDateTime || new Date().toISOString(); }
        else if (envelope.status === 'delivered') newStatus = 'delivered';
        else if (envelope.status === 'sent') newStatus = 'sent';
        else if (envelope.status === 'declined') newStatus = 'declined';
        else if (envelope.status === 'voided') { newStatus = 'voided'; updates.voided_at = envelope.voidedDateTime || new Date().toISOString(); }
        updates.status = newStatus;
        await supabase.from('generated_documents').update(updates).eq('id', body.id!);

        const events = (auditRaw?.auditEvents || []).map((ev: any) => {
          const fields: Record<string, string> = {};
          (ev.eventFields || []).forEach((f: any) => { fields[f.name] = f.value; });
          return {
            action: fields.Action || fields.action || 'event',
            description: fields.Description || fields.description || '',
            user: fields.UserName || fields.userName || '',
            email: fields.UserEmail || fields.userEmail || '',
            timestamp: fields.LogTime || fields.logTime || '',
          };
        }).filter((e: any) => e.timestamp);

        const signers = (recipients?.signers || []).map((s: any) => ({
          name: s.name, email: s.email, status: s.status, routingOrder: s.routingOrder,
          sentAt: s.sentDateTime, deliveredAt: s.deliveredDateTime, signedAt: s.signedDateTime, declinedReason: s.declinedReason,
        }));

        return j({
          success: true,
          envelope: {
            envelopeId: envelope.envelopeId, status: envelope.status, emailSubject: envelope.emailSubject,
            sentDateTime: envelope.sentDateTime, statusChangedDateTime: envelope.statusChangedDateTime,
            completedDateTime: envelope.completedDateTime, voidedDateTime: envelope.voidedDateTime, voidedReason: envelope.voidedReason,
          },
          signers, events, mapped_status: newStatus,
        });
      }

      case 'download_signed': {
        const r = await loadAndAuthorize(); if ('err' in r) return r.err;
        const doc = r.doc;
        if (!doc?.docusign_envelope_id) return j({ success: false, error: 'Envelope not found' }, 404);
        const acct = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
        if (!acct) return j({ success: false, error: 'DocuSign not configured' }, 422);
        let token: string;
        try { token = await getDocuSignAccessToken(); }
        catch (e: any) { return j({ success: false, error: `DocuSign auth: ${e.message}` }, 401); }
        const url = `${getDocuSignRestBaseUrl()}/v2.1/accounts/${acct}/envelopes/${doc.docusign_envelope_id}/documents/combined`;
        const dsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
        if (!dsRes.ok) return j({ success: false, error: 'DocuSign download failed' }, 502);
        const bytes = new Uint8Array(await dsRes.arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const filename = `${(doc.title || 'Document').replace(/[^a-z0-9]+/gi, '_')}_signed.pdf`;
        return j({ success: true, pdf_base64: b64, filename });
      }
    }

    return j({ success: false, error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[manage-generated-documents]', e);
    return new Response(JSON.stringify({ ...internalError(e, 'manage-generated-documents'), success: false }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
