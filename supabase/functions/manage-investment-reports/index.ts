import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createForbiddenResponse, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireAdmin, requireModulePermission } from '../_shared/authz.ts';
import { releaseInvestmentReportRunTokens } from '../_shared/reportMetering.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { applyDisplayOverrides, buildCalculatorInput, overridesAffectModel } from '../_shared/reports/investment/overrides.pure.ts';
import { healFinanceIdentity } from '../_shared/reports/investment/financialEngine.pure.ts';
import { refuseFailureStamp } from '../_shared/reports/investment/failureStamp.pure.ts';
import { BULK_DELETE_BUDGET_MS, removeDeletedReportStorage } from '../_shared/reports/investment/reportStorageRemoval.ts';
import {
  CONDITION_DOCUMENT_BUCKET,
  CONDITION_DOCUMENT_MAX_BYTES,
  CONDITION_DOCUMENT_TYPES,
  TABLE_NOT_APPLIED,
  bestReadingForSubject,
  conditionDocumentExtension,
  conditionDocumentPath,
  decideConditionSubmission,
  isConditionDocumentPathFor,
  isMissingTableError,
  parseConditionSubmission,
  recordFromRow,
  rowFromRecord,
} from '../_shared/reports/risk/conditionRecordSubmission.pure.ts';
import { assessConditionRecord } from '../_shared/reports/risk/conditionRecord.pure.ts';
/**
 * CORS comes from `_shared/auth.ts`, like every other function's.
 *
 * This was the ONE function in the repository that defined its own
 * `createCorsHeaders`, and the allowlist it defined was a set of hostnames
 * compiled in: `command-centre.npcservices.com.au`, any `.npcservices.com.au`,
 * any `.lovable.app` / `.lovableproject.com`, and localhost. It never read
 * `ALLOWED_ORIGINS`, which is the variable every deployment is configured
 * through — so a clone served from its own domain got the deliberately
 * mismatched fallback origin, the browser refused to expose the response, and
 * `fetch` rejected with an opaque `TypeError`.
 *
 * The clone audit of 19 Sep 2026 reported that twice, as two defects: "Failed
 * to create report: Network/CORS error calling manage-investment-reports" from
 * the Reports page, and the marketplace listing's report dialog closing with
 * nothing generated. Both were this. The prime was unaffected because its
 * hostname is one of the five.
 *
 * The shared helper answers an allowlisted origin exactly and everyone else
 * with a mismatch, which is the same posture — it just reads the allowlist
 * from configuration instead of from source. It also carries the full request
 * and response header lists (`x-command-centre-session-token`, `content-range`
 * and the rest), which the local copy had drifted away from.
 */

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface RequestBody {
  action: 'insert' | 'update' | 'delete' | 'archive' | 'unarchive' | 'archivePackage' | 'unarchivePackage' | 'bulkDelete' | 'getVersion'
    | 'requestConditionDocumentUpload' | 'submitConditionRecord' | 'getConditionRecords' | 'getConditionDocumentUrl';
  reportId?: string;
  reportIds?: string[];
  data?: Record<string, any>;
  session_token?: string;
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();

    // Validate authentication (JWT first, then session token)
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('Auth failed for manage-investment-reports:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`Authenticated user ${userId} managing investment reports - action: ${body.action}`);

    const { action, reportId, reportIds, data } = body;

    // Updates run through a service-role client and can trigger billing side
    // effects (including releasing a failed report's token reservation), so
    // authentication alone is not sufficient authorization.
    if (
      action === 'update' || action === 'archivePackage' || action === 'unarchivePackage'
      || action === 'requestConditionDocumentUpload' || action === 'submitConditionRecord'
    ) {
      const permission = await requireModulePermission(
        supabase,
        { userId, authMethod },
        'generated_reports',
        'can_edit',
      );
      if (!permission.ok) {
        return createForbiddenResponse(permission.error || 'Generated reports edit permission required', corsHeaders);
      }
    }

    // A condition document is a third party's report about somebody's
    // dwelling: reading the register needs the same module a reader of the
    // report itself holds, never authentication alone.
    if (action === 'getConditionRecords' || action === 'getConditionDocumentUrl') {
      const permission = await requireModulePermission(
        supabase,
        { userId, authMethod },
        'generated_reports',
        'can_view',
      );
      if (!permission.ok) {
        return createForbiddenResponse(permission.error || 'Generated reports view permission required', corsHeaders);
      }
    }

    const json = (payload: unknown, status = 200) => new Response(
      JSON.stringify(payload),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

    /** The report a condition record is filed against, read once. */
    const readConditionSubject = async (id: string) => {
      const { data: row, error } = await supabase
        .from('investment_reports')
        .select('id, property_address, canonical_property_key, client_property_id')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.error('Condition record subject read failed:', error);
        return { response: json({ error: 'The report this record is for could not be read. Retry.' }, 503), row: null };
      }
      if (!row) return { response: json({ error: 'Report not found' }, 404), row: null };
      return { response: null, row };
    };

    switch (action) {
      // ── Condition records (Risk's `building` category) ─────────────────
      //
      // One rule, rendered and enforced: the panel validates with the same
      // pure module this refuses with, and a refusal carries the validator's
      // own sentence. Nothing on this path writes a score, a grade or an
      // activation — the next generation reads the register and decides.
      case 'requestConditionDocumentUpload': {
        if (!reportId || !isRecord(data)) return json({ error: 'reportId and data are required' }, 400);
        const ext = conditionDocumentExtension(data.fileName);
        if (!ext) {
          return json({ error: `Upload the document as ${Object.keys(CONDITION_DOCUMENT_TYPES).join(', ').toUpperCase()}.` }, 422);
        }
        const declared = Number(data.fileSize);
        if (!Number.isFinite(declared) || declared <= 0 || declared > CONDITION_DOCUMENT_MAX_BYTES) {
          return json({ error: `The document must be under ${Math.round(CONDITION_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.` }, 422);
        }
        const subject = await readConditionSubject(reportId);
        if (subject.response) return subject.response;
        // Refuse before the bytes move where the register cannot hold the
        // record they belong to.
        const probe = await supabase.from('property_condition_records').select('id').limit(1);
        if (probe.error) {
          if (isMissingTableError(probe.error)) return json({ error: TABLE_NOT_APPLIED, tableApplied: false }, 409);
          console.error('Condition register probe failed:', probe.error);
          return json({ error: 'The condition register could not be read. Retry.' }, 503);
        }
        const path = conditionDocumentPath(reportId, crypto.randomUUID(), data.fileName);
        if (!path) return json({ error: 'Report not found' }, 404);
        const { data: ticket, error: ticketError } = await supabase.storage
          .from(CONDITION_DOCUMENT_BUCKET)
          .createSignedUploadUrl(path);
        if (ticketError || !ticket) {
          console.error('Condition document upload ticket failed:', ticketError);
          return json({ error: 'The upload could not be prepared. Retry.' }, 503);
        }
        return json({
          success: true,
          bucket: CONDITION_DOCUMENT_BUCKET,
          path,
          token: ticket.token,
          contentType: CONDITION_DOCUMENT_TYPES[ext],
        });
      }

      case 'submitConditionRecord': {
        if (!reportId || !isRecord(data)) return json({ error: 'reportId and data are required for submitConditionRecord' }, 400);
        // `recorded_by` is the record's provenance; a submission with no
        // resolved identity is refused rather than attributed to nobody.
        if (!userId || userId === 'service_role') return createUnauthorizedResponse('Authentication required', corsHeaders);

        const subject = await readConditionSubject(reportId);
        if (subject.response) return subject.response;
        const subjectRow = subject.row!;

        const parsed = parseConditionSubmission(data, {
          reportId,
          propertyId: subjectRow.client_property_id,
        });
        if (!parsed.ok) return json({ error: parsed.refusal.statement, reason: parsed.refusal.reason }, 422);

        const expectedSubject = {
          propertyAddress: subjectRow.property_address,
          propertyId: subjectRow.client_property_id,
          reportId,
        };
        const decision = decideConditionSubmission(parsed.record, expectedSubject, new Date().toISOString());
        if (!decision.storable) {
          return json({ error: decision.refusal!.statement, reason: decision.refusal!.reason, reading: decision.reading }, 422);
        }

        // A held-document claim is checked against the store, never taken on
        // the caller's word: the path must be one issued for THIS report and
        // the object must exist.
        const documentPath = typeof data.documentPath === 'string' && data.documentPath.trim()
          ? data.documentPath.trim()
          : null;
        if (documentPath) {
          if (!isConditionDocumentPathFor(documentPath, reportId)) {
            return json({ error: 'The attached document was not uploaded against this report. Upload it again from this page.' }, 422);
          }
          const folder = documentPath.slice(0, documentPath.lastIndexOf('/'));
          const leaf = documentPath.slice(documentPath.lastIndexOf('/') + 1);
          const listed = await supabase.storage.from(CONDITION_DOCUMENT_BUCKET).list(folder, { search: leaf, limit: 10 });
          if (listed.error) {
            console.error('Condition document check failed:', listed.error);
            return json({ error: 'The uploaded document could not be checked. Retry.' }, 503);
          }
          if (!(listed.data ?? []).some((o: { name?: string }) => o?.name === leaf)) {
            return json({ error: 'The document upload did not finish, so the record was not stored. Attach it again.' }, 422);
          }
        }
        const fileId = typeof data.fileId === 'string' && data.fileId.trim() ? data.fileId.trim() : null;

        const { data: storedRecord, error: conditionInsertError } = await supabase
          .from('property_condition_records')
          .insert(rowFromRecord(parsed.record, {
            reportId,
            canonicalPropertyKey: subjectRow.canonical_property_key,
            clientPropertyId: subjectRow.client_property_id,
            fileId,
            documentPath,
            recordedBy: userId,
          }))
          .select()
          .single();

        if (conditionInsertError) {
          if (isMissingTableError(conditionInsertError)) return json({ error: TABLE_NOT_APPLIED, tableApplied: false }, 409);
          if (conditionInsertError.code === '23503') {
            return json({ error: 'The attached file or the report this record names no longer exists, so the record was not stored.' }, 422);
          }
          if (conditionInsertError.code === '23514') {
            return json({ error: 'The record breaks one of the register\'s rules (a date in the future, or a held document with no file), so it was not stored.' }, 422);
          }
          console.error('Condition record insert failed:', conditionInsertError);
          return json({ error: 'Failed to store the condition record' }, 500);
        }

        return json({ success: true, record: storedRecord, reading: decision.reading });
      }

      case 'getConditionRecords': {
        if (!reportId) return json({ error: 'reportId is required for getConditionRecords' }, 400);
        const subject = await readConditionSubject(reportId);
        if (subject.response) return subject.response;
        const subjectRow = subject.row!;

        // A condition record describes the PROPERTY, so the register is read
        // by the report's linkage AND by the property key — two plain
        // equality queries merged by id, never a composed .or() string.
        const byReport = await supabase
          .from('property_condition_records')
          .select('*')
          .eq('report_id', reportId)
          .order('created_at', { ascending: false });
        if (byReport.error) {
          if (isMissingTableError(byReport.error)) {
            // The honest state, not an empty register.
            return json({ success: true, tableApplied: false, reason: TABLE_NOT_APPLIED, records: [], bestReading: null });
          }
          console.error('Condition record read failed:', byReport.error);
          return json({ error: 'The condition records could not be read. Retry.' }, 503);
        }
        const rows = new Map<string, Record<string, unknown>>();
        for (const row of byReport.data ?? []) rows.set(String(row.id), row);
        if (subjectRow.canonical_property_key) {
          const byProperty = await supabase
            .from('property_condition_records')
            .select('*')
            .eq('canonical_property_key', subjectRow.canonical_property_key)
            .order('created_at', { ascending: false });
          if (!byProperty.error) for (const row of byProperty.data ?? []) rows.set(String(row.id), row);
        }

        const asOf = new Date().toISOString();
        const expectedSubject = {
          propertyAddress: subjectRow.property_address,
          propertyId: subjectRow.client_property_id,
          reportId,
        };
        const stored = [...rows.values()];
        const records = stored.map((row) => ({
          id: row.id,
          documentKind: row.document_kind,
          issuer: row.issuer,
          issuedOn: row.issued_on,
          inspectedOn: row.inspected_on,
          scopeCoverage: row.scope_coverage,
          conclusion: row.conclusion,
          findings: row.findings,
          verification: row.verification,
          hasDocument: Boolean(row.document_path || row.file_id),
          recordedAt: row.recorded_at,
          reading: assessConditionRecord(recordFromRow(row), asOf, { expectedSubject }),
        }));
        // The same choice scoring makes, so the panel and the grade agree.
        const bestReading = bestReadingForSubject(stored.map(recordFromRow), expectedSubject, asOf);
        return json({ success: true, tableApplied: true, records, bestReading });
      }

      case 'getConditionDocumentUrl': {
        const recordId = isRecord(data) && typeof data.recordId === 'string' ? data.recordId : null;
        if (!reportId || !recordId) return json({ error: 'reportId and data.recordId are required' }, 400);
        const subject = await readConditionSubject(reportId);
        if (subject.response) return subject.response;
        const { data: row, error } = await supabase
          .from('property_condition_records')
          .select('id, document_path, report_id, canonical_property_key')
          .eq('id', recordId)
          .maybeSingle();
        if (error) {
          if (isMissingTableError(error)) return json({ error: TABLE_NOT_APPLIED, tableApplied: false }, 409);
          return json({ error: 'The record could not be read. Retry.' }, 503);
        }
        // Only a record this report can see: filed against it, or against
        // the same property.
        const visible = row && (row.report_id === reportId
          || (row.canonical_property_key && row.canonical_property_key === subject.row!.canonical_property_key));
        if (!visible || !row.document_path) return json({ error: 'No document is held for this record.' }, 404);
        const signed = await supabase.storage.from(CONDITION_DOCUMENT_BUCKET).createSignedUrl(row.document_path, 300);
        if (signed.error || !signed.data?.signedUrl) return json({ error: 'The document could not be opened. Retry.' }, 503);
        return json({ success: true, url: signed.data.signedUrl });
      }

      case 'insert': {
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'Data is required for insert' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: insertError } = await supabase
          .from('investment_reports')
          .insert(data)
          .select()
          .single();

        if (insertError) {
          console.error('Error inserting investment report:', insertError);
          return new Response(
            JSON.stringify({ error: 'Failed to create report', details: insertError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!reportId || !data) {
          return new Response(
            JSON.stringify({ error: 'reportId and data are required for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // A failure stamp is a statement about the ROW, so the row decides.
        //
        // On 24 Sep 2026 a browser whose final status read hit a three-second
        // platform 503 stamped 60 Lawley Street failed eight seconds after
        // the generator had written it `completed` with 16 of 16 sections —
        // and the release below refunded the finished report as a failed
        // one. The browser could not read the row; this function can, so it
        // refuses to record a failure over a document the record shows was
        // finished, and releases nothing. A row it cannot read is not
        // stamped either: an unread row is not evidence of a failure, and
        // the stamp cannot be taken back. See `failureStamp.pure.ts`.
        if (String(data.status || '').toLowerCase() === 'failed') {
          const { data: current, error: currentError } = await supabase
            .from('investment_reports')
            .select('id, status, last_completed_section, total_sections')
            .eq('id', reportId)
            .maybeSingle();
          if (currentError) {
            console.warn('[manage-investment-reports] failure stamp not recorded — the row could not be read', {
              reportId,
              error: currentError.message,
            });
            return new Response(
              JSON.stringify({
                error: 'The report could not be read, so it was not marked as failed. Try again in a moment.',
                code: 'row_unreadable',
                retryable: true,
              }),
              { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const refusal = refuseFailureStamp(current);
          if (refusal) {
            console.warn('[manage-investment-reports] failure stamp refused — the report is complete', {
              reportId,
              status: current?.status ?? null,
              lastCompletedSection: current?.last_completed_section ?? null,
              totalSections: current?.total_sections ?? null,
            });
            return new Response(
              JSON.stringify({
                error: refusal.message,
                code: refusal.code,
                refused: true,
              }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        // A save that carries manual overrides recomputes the financials
        // server-side BEFORE the write, through the same calculator every
        // generation uses — overrides that change modelled inputs (price,
        // rent, rate, reviewed costs, duty) go INTO the engine so the
        // totals, projections, sensitivity and metrics all describe them.
        // Three writers used to splat override values over stored leaves
        // instead, which is how production rows came to carry overridden
        // line items beside totals, series and metrics computed from the
        // formula estimates. The recompute never blocks the save: any
        // failure falls back to persisting exactly what the client sent,
        // and the response says which happened.
        let financialsRecalculated = false;
        let financialsRecalcSkipped: string | null = null;
        let financeIdentityHealed: 'loan' | 'deposit' | null = null;
        if (data.manual_overrides !== undefined) {
          try {
            if (!overridesAffectModel(data.manual_overrides)) {
              financialsRecalcSkipped = 'display_only_overrides';
            } else {
              const { data: existing, error: readError } = await supabase
                .from('investment_reports')
                .select('property_address, property_specs, financial_calculations')
                .eq('id', reportId)
                .single();
              if (readError || !existing) {
                throw new Error(readError?.message || 'report row not found');
              }
              const build = buildCalculatorInput(data.manual_overrides, existing);
              if (!build.ok) {
                financialsRecalcSkipped = `inputs_unresolved:${build.missing.join(',')}`;
              } else {
                const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET')?.trim();
                const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
                if (!internalSecret) throw new Error('INTERNAL_EDGE_SECRET not configured');
                const calcResponse = await fetch(`${supabaseUrl}/functions/v1/financial-calculator-service`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${internalSecret}`,
                    ...(anonKey ? { 'apikey': anonKey } : {}),
                  },
                  body: JSON.stringify(build.input),
                });
                if (!calcResponse.ok) throw new Error(`calculator answered ${calcResponse.status}`);
                const calc = await calcResponse.json();
                if (!calc?.success || !calc?.data) throw new Error(calc?.error || 'calculator returned no data');
                data.financial_calculations = applyDisplayOverrides(calc.data, data.manual_overrides);
                financialsRecalculated = true;
              }
            }
          } catch (recalcError) {
            financialsRecalcSkipped = `recalc_failed:${(recalcError instanceof Error ? recalcError.message : String(recalcError)).slice(0, 160)}`;
            console.error('[manage-investment-reports] financials recompute failed (save proceeds with client data):', financialsRecalcSkipped);
          }
        }

        // The recompute above never blocks a save, so on the two paths where
        // it is skipped — display-only overrides, or a calculator that could
        // not be reached — whatever the client sent is what gets stored. That
        // is how 21 production rows came to hold a deposit taken at one LVR
        // beside a loan taken at another; on one, the two lines a client reads
        // exceed the purchase price by $67,200.
        //
        // `healFinanceIdentity` re-derives whichever half the record's own
        // `keyMetrics.lvr` contradicts, and refuses when that arbiter settles
        // nothing — so this can correct a stale figure but never invent one.
        // It runs on the write as well as the read because a record that is
        // right at rest is worth more than one that is right only when
        // something remembers to reconcile it.
        if (isRecord(data.financial_calculations)) {
          const initial = data.financial_calculations.initialCosts;
          if (isRecord(initial)) {
            const heal = healFinanceIdentity(initial, data.financial_calculations.keyMetrics);
            if (heal.healed) {
              data.financial_calculations = {
                ...data.financial_calculations,
                initialCosts: { ...initial, ...heal.patch },
              };
              financeIdentityHealed = heal.healed;
              console.warn(
                `[manage-investment-reports] finance identity healed on write (${heal.healed} re-derived) for report ${reportId}`,
              );
            } else if (heal.reason === 'ambiguous' || heal.reason === 'no_arbiter') {
              // Stored as sent, and named — the disclosure surface picks it up
              // from `financeIdentityBreaches` on the next generation.
              console.warn(
                `[manage-investment-reports] finance identity broken and unarbitrable (${heal.reason}) for report ${reportId}`,
              );
            }
          }
        }

        // Slim return payload — never re-select the huge `report_content`
        // column on update. Re-selecting the full row was contributing to
        // statement-timeouts (Postgres 57014) when combined with the
        // archive_report_version trigger + concurrent dashboard polling.
        const { data: report, error: updateError } = await supabase
          .from('investment_reports')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select('id, status, current_version, last_completed_section, updated_at, error_message')
          .single();

        if (updateError) {
          console.error('Error updating investment report:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update report', details: updateError.message, code: (updateError as any).code }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // A failed report must cost nothing. Chunked generation is driven from
        // the browser, so when the client gives up mid-run this status write is
        // the only signal the backend gets — release (or refund) the Mission
        // Control job for this run rather than waiting out its TTL.
        let tokenRelease = null;
        if (String(data.status || '').toLowerCase() === 'failed') {
          tokenRelease = await releaseInvestmentReportRunTokens(
            reportId,
            `report_failed:${String(data.error_message || 'generation_failed').slice(0, 120)}`,
          );
          if (tokenRelease.jobsReleased > 0 || tokenRelease.failures > 0) {
            console.log('[manage-investment-reports] token release for failed report', {
              reportId,
              ...tokenRelease,
            });
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            report,
            ...(tokenRelease ? { tokenRelease } : {}),
            ...(data.manual_overrides !== undefined
              ? { financialsRecalculated, ...(financialsRecalcSkipped ? { financialsRecalcSkipped } : {}), ...(financeIdentityHealed ? { financeIdentityHealed } : {}) }
              : {}),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for delete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: removedRows, error: deleteError } = await supabase
          .from('investment_reports')
          .delete()
          .eq('id', reportId)
          .select('id');

        if (deleteError) {
          console.error('Error deleting investment report:', deleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to delete report', details: deleteError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // What the report kept in storage goes with it: its photographs, floor
        // plans and kept document. Only for the row this statement removed, and
        // never at the cost of the delete (`reportStorage.pure.ts`).
        const storage = await removeDeletedReportStorage(supabase, removedRows);
        if (storage.reports > 0) console.log('[manage-investment-reports] report storage removed', { reportId, ...storage });

        return new Response(
          JSON.stringify({ success: true, deleted: reportId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'bulkDelete': {
        if (!reportIds || reportIds.length === 0) {
          return new Response(
            JSON.stringify({ error: 'reportIds are required for bulkDelete' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Also support status-based bulk delete
        const statusFilter = data?.statusFilter;

        // A status filter deletes every report in that state on the deployment,
        // whoever made it, so it is an administrator's act — the one
        // `manage-automation-settings`' "Clear stuck reports" already requires.
        // A list of ids is unchanged.
        if (statusFilter && Array.isArray(statusFilter)) {
          const admin = await requireAdmin(supabase, { userId, authMethod });
          if (!admin.ok) {
            return createForbiddenResponse(admin.error || 'Admin privilege required', corsHeaders);
          }
        }
        
        let query = supabase.from('investment_reports').delete();
        
        if (statusFilter && Array.isArray(statusFilter)) {
          query = query.in('status', statusFilter);
        } else if (reportIds.length > 0) {
          query = query.in('id', reportIds);
        }

        const { data: deleted, error: bulkDeleteError } = await query.select('id');

        if (bulkDeleteError) {
          console.error('Error bulk deleting investment reports:', bulkDeleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to bulk delete reports', details: bulkDeleteError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const bulkStorage = await removeDeletedReportStorage(supabase, deleted, BULK_DELETE_BUDGET_MS);
        if (bulkStorage.reports > 0) console.log('[manage-investment-reports] report storage removed', bulkStorage);

        return new Response(
          JSON.stringify({ success: true, deletedCount: deleted?.length || 0, deleted }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'archive': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for archive' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: archiveError } = await supabase
          .from('investment_reports')
          .update({ is_archived: true, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select()
          .single();

        if (archiveError) {
          console.error('Error archiving investment report:', archiveError);
          return new Response(
            JSON.stringify({ error: 'Failed to archive report', details: archiveError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'unarchive': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for unarchive' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: report, error: unarchiveError } = await supabase
          .from('investment_reports')
          .update({ is_archived: false, updated_at: new Date().toISOString() })
          .eq('id', reportId)
          .select()
          .single();

        if (unarchiveError) {
          console.error('Error unarchiving investment report:', unarchiveError);
          return new Response(
            JSON.stringify({ error: 'Failed to unarchive report', details: unarchiveError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, report }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'archivePackage':
      case 'unarchivePackage': {
        if (!reportIds?.length || reportIds.some(id => typeof id !== 'string')) {
          return new Response(JSON.stringify({ error: 'reportIds are required for package updates' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // Resolve membership on the server so restore includes active siblings hidden
        // by the archived filter. A listing ID is the stable key; exact address is only
        // used for legacy rows that have no listing reference.
        const uniqueIds = [...new Set(reportIds)];
        const { data: anchorRows, error: anchorError } = await supabase
          .from('investment_reports')
          .select('id, property_listing_id, property_address')
          .in('id', uniqueIds)
          .limit(1);
        const anchor = anchorRows?.[0];
        if (anchorError || !anchor) {
          console.error('Package anchor lookup failed:', anchorError, { uniqueIds });
          return new Response(JSON.stringify({ error: 'Property package was not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        let packageQuery = supabase.from('investment_reports').update({ is_archived: action === 'archivePackage', updated_at: new Date().toISOString() });
        packageQuery = anchor.property_listing_id
          ? packageQuery.eq('property_listing_id', anchor.property_listing_id)
          : packageQuery.eq('property_address', anchor.property_address);
        const { data: updated, error: packageError } = await packageQuery.select('id, is_archived');
        if (packageError || !updated?.length) {
          console.error('Error updating investment report package:', packageError);
          return new Response(JSON.stringify({ error: 'Failed to update property package' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: true, reports: updated }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'getVersion': {
        if (!reportId) {
          return new Response(
            JSON.stringify({ error: 'reportId is required for getVersion' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const versionNumber = data?.versionNumber;
        if (!versionNumber) {
          return new Response(
            JSON.stringify({ error: 'versionNumber is required for getVersion' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`Fetching version ${versionNumber} for report ${reportId}`);

        const { data: version, error: versionError } = await supabase
          .from('report_versions')
          .select('*')
          .eq('report_id', reportId)
          .eq('version_number', versionNumber)
          .single();

        if (versionError) {
          console.error('Error fetching version:', versionError);
          return new Response(
            JSON.stringify({ error: 'Failed to fetch version', details: versionError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!version) {
          return new Response(
            JSON.stringify({ error: 'Version not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, version }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Error in manage-investment-reports:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-investment-reports'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
