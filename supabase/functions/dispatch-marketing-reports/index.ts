import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { verifySignedInternal, securityJsonError } from '../_shared/requestSecurity.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
/**
 * Callers permitted to invoke `dispatch` without a staff session.
 *
 * The declared caller travels inside the signed envelope, so this is an
 * identity allow-list rather than a secret. Any scheduler added here must build
 * its headers with `public.cron_signed_internal_headers(...)` (or the equivalent
 * HMAC helper) — a bare `x-internal-edge-secret` header is no longer accepted.
 */
const INTERNAL_DISPATCH_CALLERS = ['pg_cron', 'marketing-reports-cron'] as const;

/**
 * dispatch-marketing-reports
 * 
 * Sends the Market Intelligence Report PDF to GHL pipeline contacts
 * via the send-email-reply edge function (Email Copilot gateway).
 * 
 * Operations:
 * - getSchedules: List all distribution schedules
 * - createSchedule: Create a new schedule
 * - updateSchedule: Update an existing schedule
 * - deleteSchedule: Delete a schedule
 * - dispatch: Trigger email dispatch for a schedule (or ad-hoc)
 * - getHistory: Get distribution log
 * - getMailboxes: Get available mailboxes for sender selection
 */

interface RequestBody {
  operation: 'getSchedules' | 'createSchedule' | 'updateSchedule' | 'deleteSchedule' 
    | 'dispatch' | 'getHistory' | 'getMailboxes';
  data?: Record<string, any>;
  scheduleId?: string;
  session_token?: string;
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read the body ONCE as text: the signed-internal check verifies the HMAC
    // over the exact bytes, so it cannot be re-read after `req.json()`.
    const rawBody = await req.text();
    let body: RequestBody;
    try {
      body = JSON.parse(rawBody || '{}') as RequestBody;
    } catch {
      return securityJsonError(400, 'invalid_json');
    }

    // Scheduled dispatches authenticate with the signed internal envelope
    // (WP-12), not a bare shared secret in a header.
    //
    // This previously compared `x-internal-edge-secret` directly. That
    // credential is replayable, is not bound to the request body and carries no
    // caller identity, so a leaked value authorises any dispatch forever.
    // `verifySignedInternal` verifies an HMAC over the method, target, body and
    // declared caller, restricts the caller to the allow-list below, and fails
    // closed when INTERNAL_EDGE_SECRET is absent or shorter than the minimum.
    //
    // The authorisation shape is unchanged: an internal caller may only run
    // `dispatch`. Every other operation still requires an authenticated staff
    // user holding admin or superadmin, and a signed request cannot reach them.
    const internalAuth = body.operation === 'dispatch'
      ? await verifySignedInternal(supabase, req, rawBody, INTERNAL_DISPATCH_CALLERS)
      : null;
    const isCronCall = internalAuth?.ok === true;

    if (!isCronCall) {
      // Verify authentication
      const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
      if (authError) {
        return createUnauthorizedResponse(authError, corsHeaders);
      }

      // Check admin role
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['superadmin', 'admin']);

      if (!roleRows || roleRows.length === 0) {
        return createForbiddenResponse('Admin access required', corsHeaders);
      }
    }

    const { operation, data, scheduleId } = body;

    // ==================== GET SCHEDULES ====================
    if (operation === 'getSchedules') {
      const { data: schedules, error } = await supabase
        .from('marketing_report_schedules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, schedules }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== CREATE SCHEDULE ====================
    if (operation === 'createSchedule') {
      const nextScheduled = calculateNextScheduledAt(data?.frequency || 'monthly');
      
      const { data: newSchedule, error } = await supabase
        .from('marketing_report_schedules')
        .insert({
          name: data?.name,
          description: data?.description,
          pipeline_id: data?.pipeline_id || 'none',
          pipeline_name: data?.pipeline_name,
          stage_id: data?.stage_id || null,
          stage_name: data?.stage_name || null,
          pipeline_stage_targets: data?.pipeline_stage_targets || [],
          frequency: data?.frequency || 'monthly',
          mailbox_source: data?.mailbox_source || 'admin',
          sender_mailbox_email: data?.sender_mailbox_email || null,
          email_subject_template: data?.email_subject_template || 'Your Market Intelligence Report — {{report_period}}',
          email_body_template: data?.email_body_template || 'Please find attached the latest Market Intelligence Report.',
          is_enabled: data?.is_enabled !== false,
          next_scheduled_at: nextScheduled,
          created_by: data?.created_by,
          report_type: data?.report_type || 'full',
          audience_segment: data?.audience_segment || 'general',
          content_rotation_enabled: data?.content_rotation_enabled || false,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, schedule: newSchedule }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== UPDATE SCHEDULE ====================
    if (operation === 'updateSchedule') {
      if (!scheduleId) throw new Error('scheduleId required');

      const updateData: Record<string, any> = {};
      const allowedFields = ['name', 'description', 'pipeline_id', 'pipeline_name', 'stage_id', 'stage_name',
        'pipeline_stage_targets', 'frequency', 'mailbox_source', 'sender_mailbox_email', 'email_subject_template', 'email_body_template', 
        'is_enabled', 'report_type', 'audience_segment', 'content_rotation_enabled', 'rotation_sequence', 'current_rotation_index'];
      
      for (const field of allowedFields) {
        if (data?.[field] !== undefined) updateData[field] = data[field];
      }

      if (data?.frequency) {
        updateData.next_scheduled_at = calculateNextScheduledAt(data.frequency);
      }

      const { error } = await supabase
        .from('marketing_report_schedules')
        .update(updateData)
        .eq('id', scheduleId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== DELETE SCHEDULE ====================
    if (operation === 'deleteSchedule') {
      if (!scheduleId) throw new Error('scheduleId required');

      const { error } = await supabase
        .from('marketing_report_schedules')
        .delete()
        .eq('id', scheduleId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== GET HISTORY ====================
    if (operation === 'getHistory') {
      const limit = data?.limit || 50;
      const offset = data?.offset || 0;

      const { data: logs, error, count } = await supabase
        .from('marketing_report_distribution_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, logs, total: count }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== GET MAILBOXES ====================
    if (operation === 'getMailboxes') {
      const { data: users, error } = await supabase
        .from('custom_users')
        .select('id, username, personal_mailbox')
        .eq('is_active', true)
        .not('personal_mailbox', 'is', null);

      if (error) throw error;

      const mailboxes = (users || []).filter((u: any) => u.personal_mailbox);
      return new Response(
        JSON.stringify({ success: true, mailboxes }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== DISPATCH ====================
    if (operation === 'dispatch') {
      const targetScheduleId = scheduleId || data?.schedule_id;
      
      // For cron: find all due schedules
      const schedulesToProcess: any[] = [];
      
      if (targetScheduleId) {
        const { data: schedule } = await supabase
          .from('marketing_report_schedules')
          .select('*')
          .eq('id', targetScheduleId)
          .single();
        if (schedule) schedulesToProcess.push(schedule);
      } else if (isCronCall) {
        const { data: dueSchedules } = await supabase
          .from('marketing_report_schedules')
          .select('*')
          .eq('is_enabled', true)
          .not('frequency', 'eq', 'ad_hoc')
          .lte('next_scheduled_at', new Date().toISOString());
        if (dueSchedules) schedulesToProcess.push(...dueSchedules);
      }

      if (schedulesToProcess.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No schedules to process', sent: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let totalSent = 0;
      let totalFailed = 0;

      for (const schedule of schedulesToProcess) {
        try {
          // Determine report type — handle content rotation
          let reportType = schedule.report_type || 'full';
          const audienceSegment = schedule.audience_segment || 'general';

          if (schedule.content_rotation_enabled && schedule.rotation_sequence?.length > 0) {
            const idx = schedule.current_rotation_index || 0;
            reportType = schedule.rotation_sequence[idx % schedule.rotation_sequence.length];
            console.log(`[dispatch] Rotation: index=${idx}, type=${reportType}`);
          }

          const result = await processScheduleDispatch(supabase, supabaseUrl, supabaseServiceKey, supabaseAnonKey, schedule, reportType, audienceSegment);
          totalSent += result.sent;
          totalFailed += result.failed;

          // Update schedule timestamps + rotation index
          const updatePayload: Record<string, any> = {
            last_sent_at: new Date().toISOString(),
            next_scheduled_at: calculateNextScheduledAt(schedule.frequency),
          };

          if (schedule.content_rotation_enabled && schedule.rotation_sequence?.length > 0) {
            updatePayload.current_rotation_index = ((schedule.current_rotation_index || 0) + 1) % schedule.rotation_sequence.length;
          }

          await supabase
            .from('marketing_report_schedules')
            .update(updatePayload)
            .eq('id', schedule.id);

        } catch (err) {
          console.error(`[dispatch] Error processing schedule ${schedule.id}:`, err);
          totalFailed++;
        }
      }

      return new Response(
        JSON.stringify({ success: true, sent: totalSent, failed: totalFailed }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[dispatch-marketing-reports] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'dispatch-marketing-reports'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Dispatch Logic ──────────────────────────────────────────────────────────

async function processScheduleDispatch(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  schedule: any,
  reportType: string,
  audienceSegment: string
): Promise<{ sent: number; failed: number }> {
  console.log(`[dispatch] Processing schedule: ${schedule.name} (${schedule.id}), type=${reportType}, audience=${audienceSegment}`);

  // Step 1: Get or generate a fresh report with the correct type/audience
  const report = await getOrGenerateReport(supabase, supabaseUrl, serviceKey, anonKey, reportType, audienceSegment);
  if (!report) throw new Error('Failed to get/generate market intelligence report');

  // Step 2: Make sure the report HAS a PDF, then download it.
  //
  // The generator writes content and never a PDF, so a dispatch that had to
  // generate always reached this point with pdf_storage_path null and threw
  // "Failed to download report PDF" — every scheduled send that could not
  // reuse a manually-exported PDF failed (audit F16; pdf_storage_path was
  // 0/7 in production). The scheduled path now renders through the same
  // design-composer route the download button uses, acting for the
  // schedule's creator, whose marketing permission the route checks.
  let storagePath: string | null = typeof report.pdf_storage_path === 'string' && report.pdf_storage_path
    ? report.pdf_storage_path
    : null;
  if (!storagePath) {
    console.log(`[dispatch] Report ${report.id} has no stored PDF; rendering one...`);
    storagePath = await renderReportPdf(supabaseUrl, anonKey, report.id, schedule.created_by);
    if (!storagePath) throw new Error('Report PDF could not be rendered for attachment');
  }
  const pdfBase64 = await downloadPdfAsBase64(supabase, storagePath);
  if (!pdfBase64) throw new Error('Failed to download report PDF');

  // Step 3: Resolve recipients from GHL pipeline contacts
  const recipients = await resolveRecipients(supabase, schedule);
  console.log(`[dispatch] Found ${recipients.length} recipients for schedule ${schedule.name}`);

  if (recipients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Step 4: Send emails via send-email-reply (Email Copilot gateway)
  let sent = 0;
  let failed = 0;
  const reportPeriod = report.report_period || new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const subject = (schedule.email_subject_template || 'Your Market Intelligence Report — {{report_period}}')
    .replace('{{report_period}}', reportPeriod);

  for (const recipient of recipients) {
    try {
      // Rate limiting: 200ms between sends
      if (sent > 0 || failed > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Skip if no email
      if (!recipient.email) {
        await logDistribution(supabase, schedule.id, report.id, recipient, 'skipped', 'No email address');
        continue;
      }

      // Personalise the body
      const firstName = recipient.name?.split(' ')[0] || '';
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
      const bodyContent = `${greeting}\n\n${schedule.email_body_template}\n\nKind regards`;

      // Send via Email Copilot gateway (send-email-reply)
      const emailPayload: Record<string, any> = {
        to: recipient.email,
        subject,
        body: bodyContent,
        source: 'agent', // Triggers NPC branded HTML template with banner, signature, disclaimer
        mailboxSource: schedule.mailbox_source || 'admin',
        senderMailboxId: schedule.mailbox_source === 'personal' ? schedule.created_by : undefined,
        effectiveUserId: schedule.created_by,
        attachments: [{
          name: `Market_Intelligence_Report_${reportPeriod.replace(/\s+/g, '_')}.pdf`,
          contentType: 'application/pdf',
          contentBytes: pdfBase64,
        }],
      };

      const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
      const emailResponse = await fetch(`${supabaseUrl.trim()}/functions/v1/send-email-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // AUTH-002: internal secret, not the service-role key.
          'Authorization': `Bearer ${anonKey.trim()}`,
          'apikey': anonKey.trim(),
          ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
        },
        body: JSON.stringify(emailPayload),
      });

      const emailResult = await emailResponse.json();

      if (emailResponse.ok && emailResult.success) {
        await logDistribution(supabase, schedule.id, report.id, recipient, 'sent');
        sent++;
        console.log(`[dispatch] ✓ Sent to ${recipient.email}`);
      } else {
        const errMsg = emailResult.error || `HTTP ${emailResponse.status}`;
        await logDistribution(supabase, schedule.id, report.id, recipient, 'failed', errMsg);
        failed++;
        console.error(`[dispatch] ✗ Failed for ${recipient.email}: ${errMsg}`);
      }

      // Safety cap at 100 per dispatch
      if (sent + failed >= 100) {
        console.log('[dispatch] Reached 100 recipient cap, stopping');
        break;
      }

    } catch (err: any) {
      await logDistribution(supabase, schedule.id, report.id, recipient, 'failed', err.message);
      failed++;
    }
  }

  return { sent, failed };
}

// ─── Report Management ──────────────────────────────────────────────────────

async function getOrGenerateReport(supabase: any, supabaseUrl: string, serviceKey: string, anonKey: string, reportType: string, audienceSegment: string): Promise<any> {
  // Check for a recent report with matching type/audience (< 24h old)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentReport } = await supabase
    .from('marketing_intelligence_reports')
    .select('*')
    .eq('status', 'completed')
    .eq('report_type', reportType)
    .eq('audience_segment', audienceSegment)
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // A recent completed report is reused even when it carries no PDF yet —
  // rendering a PDF for existing content (the caller's next step) is
  // strictly cheaper than regenerating the content from scratch.
  if (recentReport) {
    console.log(`[dispatch] Using existing report: ${recentReport.id}${recentReport.pdf_storage_path ? '' : ' (no PDF yet)'}`);
    return recentReport;
  }

  // Generate a new report with the specified type and audience
  console.log(`[dispatch] Generating new ${reportType} report for ${audienceSegment}...`);
  
  const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
  const genResponse = await fetch(`${supabaseUrl.trim()}/functions/v1/generate-market-intelligence-report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // AUTH-002: internal secret, not the service-role key.
      'Authorization': `Bearer ${anonKey.trim()}`,
      'apikey': anonKey.trim(),
      ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
    },
    body: JSON.stringify({
      report_type: reportType,
      audience_segment: audienceSegment,
    }),
  });

  if (!genResponse.ok) {
    const errText = await genResponse.text();
    throw new Error(`Report generation failed: ${errText}`);
  }

  const genResult = await genResponse.json();
  
  if (!genResult.reportId) {
    // Report was generated but may not have been stored — check again
    const { data: latestReport } = await supabase
      .from('marketing_intelligence_reports')
      .select('*')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return latestReport;
  }

  // Fetch the report record
  const { data: newReport } = await supabase
    .from('marketing_intelligence_reports')
    .select('*')
    .eq('id', genResult.reportId)
    .single();

  return newReport;
}

/**
 * Render (and persist) the report's PDF through the same design-composer
 * route the download button uses — `render-market-intelligence-pdf` with
 * `persist` on, which writes `pdf_storage_path` and hands the path back.
 *
 * The route refuses an anonymous internal credential, so the dispatch names
 * the schedule's creator and the route checks THAT user's marketing
 * permission — the scheduled send renders exactly what (and only what) its
 * owner could render by hand.
 */
async function renderReportPdf(
  supabaseUrl: string,
  anonKey: string,
  reportId: string,
  onBehalfOfUserId: string | null | undefined,
): Promise<string | null> {
  if (!onBehalfOfUserId) {
    console.error('[dispatch] Cannot render report PDF: schedule has no creator to act for');
    return null;
  }
  const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
  const response = await fetch(`${supabaseUrl.trim()}/functions/v1/render-market-intelligence-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // AUTH-002: internal secret, not the service-role key.
      'Authorization': `Bearer ${anonKey.trim()}`,
      'apikey': anonKey.trim(),
      ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
    },
    body: JSON.stringify({ reportId, persist: true, onBehalfOfUserId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    console.error(`[dispatch] PDF render failed: HTTP ${response.status} ${result?.error ?? ''}`);
    return null;
  }
  return result.persisted && typeof result.storagePath === 'string' && result.storagePath
    ? result.storagePath
    : null;
}

async function downloadPdfAsBase64(supabase: any, storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;

  try {
    const { data, error } = await supabase.storage
      .from('marketing-reports')
      .download(storagePath);

    if (error || !data) {
      console.error('[dispatch] PDF download error:', error);
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.error('[dispatch] PDF download exception:', err);
    return null;
  }
}

// ─── Recipient Resolution ───────────────────────────────────────────────────

interface Recipient {
  email: string;
  name: string;
  ghl_contact_id?: string;
}

async function resolveRecipients(supabase: any, schedule: any): Promise<Recipient[]> {
  const targets: Array<{ pipeline_id: string; stage_id?: string }> = schedule.pipeline_stage_targets || [];
  
  // Fallback to legacy single pipeline/stage if no targets configured
  if (targets.length === 0 && schedule.pipeline_id) {
    targets.push({
      pipeline_id: schedule.pipeline_id,
      stage_id: schedule.stage_id || undefined,
    });
  }

  if (targets.length === 0) {
    console.log('[dispatch] No pipeline targets configured');
    return [];
  }

  const emailMap = new Map<string, Recipient>();

  for (const target of targets) {
    // Query ghl_client_opportunities using the internal UUID pipeline_id
    let query = supabase
      .from('ghl_client_opportunities')
      .select('client_id, ghl_contact_id')
      .eq('pipeline_id', target.pipeline_id);

    if (target.stage_id) {
      query = query.eq('stage_id', target.stage_id);
    }

    const { data: opportunities, error } = await query;

    if (error) {
      console.error(`[dispatch] Error fetching opportunities for pipeline ${target.pipeline_id}:`, error);
      continue;
    }

    for (const opp of (opportunities || [])) {
      // The client record is the only source of a contact name and email
      // here; the opportunity row has neither.
      let email: string | null = null;
      let name = '';
      if (opp.client_id) {
        const { data: client } = await supabase
          .from('clients')
          .select('primary_email, primary_first_name, primary_surname')
          .eq('id', opp.client_id)
          .maybeSingle();

        if (client?.primary_email) {
          email = client.primary_email;
          name = name || `${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim();
        }
      }

      if (email && !emailMap.has(email.toLowerCase())) {
        emailMap.set(email.toLowerCase(), {
          email: email.toLowerCase(),
          name,
          ghl_contact_id: opp.ghl_contact_id,
        });
      }
    }
  }

  return Array.from(emailMap.values());
}

// ─── Distribution Logging ───────────────────────────────────────────────────

async function logDistribution(
  supabase: any,
  scheduleId: string,
  reportId: string,
  recipient: Recipient,
  status: string,
  errorMessage?: string
) {
  await supabase
    .from('marketing_report_distribution_log')
    .insert({
      schedule_id: scheduleId,
      report_id: reportId,
      recipient_email: recipient.email,
      recipient_name: recipient.name,
      ghl_contact_id: recipient.ghl_contact_id,
      status,
      error_message: errorMessage || null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    });
}

// ─── Scheduling Helpers ─────────────────────────────────────────────────────

function calculateNextScheduledAt(frequency: string): string {
  const now = new Date();
  switch (frequency) {
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'fortnightly':
      now.setDate(now.getDate() + 14);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      break;
    case 'quarterly':
      now.setMonth(now.getMonth() + 3);
      break;
    case 'ad_hoc':
    default:
      return new Date('9999-12-31').toISOString();
  }
  // Set to 9am AEST (23:00 UTC previous day)
  now.setUTCHours(23, 0, 0, 0);
  now.setDate(now.getDate() - 1);
  return now.toISOString();
}
