/**
 * GHL Migrate: BOOKINGS (Calendar Events / Appointments) Worker
 *
 * For every mapped calendar (resource_type='calendar' in ghl_id_mapping),
 * paginates source events within the configured time window and creates
 * matching appointments in the target account. Uses ID-first resolution
 * for both calendarId AND contactId (the documented cascade-failure root
 * cause from the contacts→opportunities run).
 *
 * Payload options:
 *   mode: 'future_only' (default) | 'window' | 'all'
 *   start_date / end_date: ISO strings, used in 'window' mode
 *   future_only_lookback_days: how many days back from "now" in future_only
 *      mode (default 7 — captures recently-completed bookings clients still
 *      reference in their portal)
 *   notify_attendees: false (default) — never re-email contacts on create
 *   max_items: cap per dispatch (0 = unlimited)
 *
 * Cursor shape:
 *   { calendarIndex: number, calendarOffset: number }
 * where calendarIndex is the position in the sorted list of mapped
 * calendars and calendarOffset is the number of events already processed
 * inside the current calendar (paginated with startAfter/skip).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
  describeGhlWriteAuthFailure,
  parseGhlError,
} from '../_shared/ghl-account.ts';
import {
  startJob, finishJob, recordItem, recordIdMapping, updateJobProgress,
  saveCheckpoint, loadCheckpoint, partialExit, heartbeat, readControlSignal,
} from '../_shared/migration-jobs.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { createGhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const MAX_RUNTIME_MS = 110_000;
const PAGE_SIZE = 100;

async function lookupMapping(
  supabase: any, resourceType: string, oldId: string,
  source: string, target: string,
): Promise<string | null> {
  if (!oldId) return null;
  const { data } = await supabase
    .from('ghl_id_mapping')
    .select('new_ghl_id')
    .eq('resource_type', resourceType)
    .eq('old_ghl_id', oldId)
    .eq('source_account_label', source)
    .eq('target_account_label', target)
    .maybeSingle();
  return data?.new_ghl_id || null;
}

function computeWindow(payload: any): { startTime: number; endTime: number; modeLabel: string } {
  const now = Date.now();
  const mode = payload.mode || 'future_only';
  if (mode === 'all') {
    // 5 years back → 2 years forward
    return {
      startTime: now - 5 * 365 * 86400_000,
      endTime: now + 2 * 365 * 86400_000,
      modeLabel: 'all',
    };
  }
  if (mode === 'window') {
    const startTime = payload.start_date ? new Date(payload.start_date).getTime() : now - 90 * 86400_000;
    const endTime = payload.end_date ? new Date(payload.end_date).getTime() : now + 365 * 86400_000;
    return { startTime, endTime, modeLabel: 'window' };
  }
  // future_only (default)
  const lookback = Number(payload.future_only_lookback_days || 7);
  return {
    startTime: now - lookback * 86400_000,
    endTime: now + 365 * 86400_000,
    modeLabel: 'future_only',
  };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let supabase: any;
  let jobId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rawBody = await req.text();
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
    if (!(await verifyInternal(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, rawBody, { strict: true, allowedCallers: ['migration-dispatcher'] })).ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }
    supabase = createClient(supabaseUrl, serviceRoleKey);

    jobId = body.job_id as string;
    const sourceAccount = body.source_account as 'legacy' | 'new';
    const targetAccount = body.target_account as 'legacy' | 'new';
    const dryRun = body.dry_run !== false;
    const payload = body.payload || {};
    const maxItems = Number(payload.max_items) || 0;
    const notifyAttendees = payload.notify_attendees === true; // default false
    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    const sourceCreds = getGhlCredentials(sourceAccount);
    const targetCreds = getGhlCredentials(targetAccount);
    const sErr = validateGhlCredentials(sourceCreds);
    const tErr = validateGhlCredentials(targetCreds);
    if (sErr || tErr) {
      const msg = sErr || tErr || 'creds';
      await finishJob(supabase, jobId, 'failed', msg);
      return new Response(JSON.stringify({ error: msg }), { status: 400 });
    }

    const sourceAccess = await resolveGhlAccessTokenForLocation(sourceCreds);
    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey!, diagnostics: null as any }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const sourceHeaders = buildGhlHeaders(sourceAccess.accessToken);
    const targetHeaders = buildGhlHeaders(targetAccess.accessToken);
    const targetAuthHint = targetAccess.diagnostics
      ? describeGhlWriteAuthFailure(targetAccess.diagnostics)
      : null;

    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: tokenKeyFor(sourceAccount, sourceAccess.accessToken),
      targetTokenKey: tokenKeyFor(targetAccount, targetAccess.accessToken),
      logTag: 'bookings-worker',
    });

    const win = computeWindow(payload);
    console.log(`[bookings-worker] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun} mode=${win.modeLabel} window=${new Date(win.startTime).toISOString()}..${new Date(win.endTime).toISOString()}`);

    // Load all mapped calendars (deterministic order)
    const { data: calMappings, error: cmErr } = await supabase
      .from('ghl_id_mapping')
      .select('old_ghl_id, new_ghl_id, notes')
      .eq('resource_type', 'calendar')
      .eq('source_account_label', sourceAccount)
      .eq('target_account_label', targetAccount)
      .order('old_ghl_id', { ascending: true });
    if (cmErr) throw new Error(`Load calendar mappings failed: ${cmErr.message}`);
    const calendars = calMappings || [];
    if (calendars.length === 0) {
      await startJob(supabase, jobId, 0);
      await finishJob(supabase, jobId, 'failed', 'No calendar mappings found — run calendars worker first');
      return new Response(JSON.stringify({ success: false, error: 'No calendar mappings' }), { status: 400 });
    }

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.calendarIndex || 0) > 0 || (checkpoint.cursor.calendarOffset || 0) > 0;
    let calendarIndex = Number(checkpoint.cursor.calendarIndex) || 0;
    let calendarOffset = Number(checkpoint.cursor.calendarOffset) || 0;

    if (!isResume) {
      // Use the count of mapped calendars as the initial total. The worker
      // refines this upward as actual events are discovered (one event = one
      // unit) so the dashboard reflects real bookings progress, not just
      // calendar count.
      await startJob(supabase, jobId, calendars.length);
    }

    let baseProcessed = 0, baseSucceeded = 0, baseFailed = 0;
    try {
      const { data: jobRow } = await supabase
        .from('migration_jobs').select('processed_items, succeeded_items, failed_items')
        .eq('id', jobId).maybeSingle();
      baseProcessed = Number(jobRow?.processed_items || 0);
      baseSucceeded = Number(jobRow?.succeeded_items || 0);
      baseFailed = Number(jobRow?.failed_items || 0);
    } catch {}

    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0, totalSkipped = 0;
    let totalEventsDiscovered = 0;
    let calendarsScanned = 0;
    let timeBudgetExhausted = false, pausedByUser = false;
    let cancelledByUser: 'pause' | 'cancel' | 'kill' | null = null;
    const progressPatch = () => ({
      // "Processed" = events handled (succeeded+failed+skipped) + calendars
      // scanned with zero events. This makes the dashboard meaningful even
      // when calendars are empty (otherwise jobs sit at 0/N and look broken).
      processed_items: baseProcessed + totalProcessed + calendarsScanned,
      succeeded_items: baseSucceeded + totalSucceeded,
      failed_items: baseFailed + totalFailed,
      // Refine total upward as we discover real events. Floor at calendars.length
      // so the bar never shrinks if all calendars turn out empty.
      total_items: Math.max(calendars.length, totalEventsDiscovered + calendars.length),
    });

    outer:
    for (; calendarIndex < calendars.length; calendarIndex++) {
      const calMap = calendars[calendarIndex];
      const oldCalId = calMap.old_ghl_id;
      const newCalId = calMap.new_ghl_id;
      const calLabel = calMap.notes || oldCalId;

      // GHL /calendars/events does NOT support limit/skip — it returns all events in [startTime,endTime].
      // We chunk the time window into ~30-day slices to keep responses bounded and resumable.
      const WINDOW_SLICE_MS = 30 * 86400_000;
      let sliceStart = win.startTime + (calendarOffset * WINDOW_SLICE_MS);
      let sliceIndex = calendarOffset;
      while (sliceStart < win.endTime) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break outer; }
        const sig = await readControlSignal(supabase, jobId);
        if (sig === 'kill' || sig === 'cancel') { cancelledByUser = sig; break outer; }
        if (sig === 'pause') { pausedByUser = true; break outer; }

        const sliceEnd = Math.min(sliceStart + WINDOW_SLICE_MS, win.endTime);
        const url = `${GHL_API_BASE}/calendars/events?locationId=${sourceCreds.locationId}&calendarId=${oldCalId}&startTime=${sliceStart}&endTime=${sliceEnd}`;
        const r = await ctx.ghlFetch(url, { method: 'GET', headers: sourceHeaders }, 3, 'source');
        if (!r.ok) {
          const t = await r.text();
          console.error(`[bookings-worker] List events failed cal=${oldCalId} slice=${sliceIndex} ${r.status}: ${t.substring(0, 200)}`);
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: `cal:${oldCalId}:slice:${sliceIndex}`,
            entity_label: `Calendar ${calLabel}`, status: 'failed',
            error_message: `List events failed: ${r.status} ${t.substring(0, 200)}`,
          });
          sliceStart = sliceEnd;
          sliceIndex++;
          continue;
        }
        const data = await r.json();
        const events: any[] = data?.events || data?.data || [];
        totalEventsDiscovered += events.length;

        for (const ev of events) {
          if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break outer; }
          if (maxItems > 0 && totalProcessed >= maxItems) break outer;

          const oldEventId = ev.id;
          const evLabel = `${ev.title || 'Appointment'} @ ${ev.startTime || ''}`;
          totalProcessed++;
          

          // Already mirrored?
          const existing = await lookupMapping(supabase, 'appointment', oldEventId, sourceAccount, targetAccount);
          if (existing) {
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, target_id: existing,
              entity_label: evLabel, status: 'skipped', error_message: 'Already mirrored',
            });
            continue;
          }

          // ID-first contact resolution (NEVER name-based — see cascade postmortem)
          const oldContactId = ev.contactId;
          if (!oldContactId) {
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, entity_label: evLabel, status: 'skipped',
              error_message: 'Source event missing contactId',
            });
            continue;
          }
          const newContactId = await lookupMapping(supabase, 'contact', oldContactId, sourceAccount, targetAccount);
          if (!newContactId) {
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, entity_label: evLabel, status: 'skipped',
              error_message: `No contact mapping for ${oldContactId} — run contacts worker first`,
            });
            continue;
          }

          // Optional assignedUserId remap, with explicit default fallback
          let mappedAssignedUser: string | undefined;
          if (ev.assignedUserId) {
            const m = await lookupMapping(supabase, 'user', ev.assignedUserId, sourceAccount, targetAccount);
            if (m) mappedAssignedUser = m;
          }
          const defaultAssignedUserId = (payload.default_assigned_user_id || payload.default_user_id || '').toString().trim();
          if (!mappedAssignedUser && defaultAssignedUserId) {
            mappedAssignedUser = defaultAssignedUserId;
          }

          if (dryRun) {
            totalSucceeded++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, entity_label: evLabel,
              status: 'succeeded',
              error_message: `DRY RUN — would create on cal=${newCalId} contact=${newContactId}`,
            });
            continue;
          }

          // Build appointment payload
          const apptBody: Record<string, any> = {
            calendarId: newCalId,
            locationId: targetCreds.locationId,
            contactId: newContactId,
            startTime: ev.startTime,
            endTime: ev.endTime,
            title: ev.title || 'Appointment',
            appointmentStatus: ev.appointmentStatus || ev.status || 'confirmed',
            // Critical: bypass GHL availability/slot validation so historic & overlapping
            // bookings can be re-created during migration.
            ignoreDateRange: true,
            ignoreFreeSlotValidation: true,
            toNotify: notifyAttendees,
          };
          // GHL requires selectedTimezone whenever ignoreFreeSlotValidation is set.
          const evTz = ev.selectedTimezone || ev.timezone || ev.timeZone || 'Australia/Sydney';
          apptBody.selectedTimezone = evTz;
          // selectedSlot mirrors the start time and is required by some GHL versions.
          if (ev.startTime) apptBody.selectedSlot = ev.startTime;
          if (mappedAssignedUser) apptBody.assignedUserId = mappedAssignedUser;
          if (ev.address) apptBody.address = ev.address;
          if (ev.meetingLocationType) apptBody.meetingLocationType = ev.meetingLocationType;
          if (ev.notes) apptBody.notes = ev.notes;

          try {
            const cr = await ctx.ghlFetch(`${GHL_API_BASE}/calendars/events/appointments`, {
              method: 'POST', headers: targetHeaders, body: JSON.stringify(apptBody),
            }, 3, 'target');
            if (!cr.ok) {
              const t = await cr.text();
              const parsed = parseGhlError(t);
              const code = parsed.error_code || `GHL_${cr.status}`;
              const authDetail = (cr.status === 401 || cr.status === 403) && targetAuthHint ? ` ${targetAuthHint}` : '';
              totalFailed++;
              await recordItem(supabase, {
                job_id: jobId, source_id: oldEventId, entity_label: evLabel, status: 'failed',
                error_message: `[${code}] ${cr.status}: ${(parsed.message || t).substring(0, 240)}${authDetail}`.substring(0, 900),
              });
              continue;
            }
            const cdata = await cr.json();
            const newId = cdata?.id || cdata?.appointment?.id || cdata?.event?.id;
            if (newId) {
              await recordIdMapping(supabase, {
                resource_type: 'appointment', old_ghl_id: oldEventId, new_ghl_id: newId,
                source_account_label: sourceAccount, target_account_label: targetAccount, notes: evLabel,
              });
            }
            totalSucceeded++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, target_id: newId || null,
              entity_label: evLabel, status: 'succeeded',
            });
          } catch (e: any) {
            totalFailed++;
            await recordItem(supabase, {
              job_id: jobId, source_id: oldEventId, entity_label: evLabel, status: 'failed',
              error_message: (e.message || 'Unknown').substring(0, 300),
            });
          }

          if (totalProcessed % 25 === 0) {
            await updateJobProgress(supabase, jobId, progressPatch());
            await heartbeat(supabase, jobId);
          }
        }

        sliceStart = sliceEnd;
        sliceIndex++;
        calendarOffset = sliceIndex;
      }
      // Done with this calendar — count the scan, log a summary item, reset slice index.
      calendarsScanned++;
      await recordItem(supabase, {
        job_id: jobId,
        source_id: `cal-scan:${oldCalId}`,
        entity_label: `Calendar ${calLabel}`,
        status: 'succeeded',
        error_message: `Calendar scanned: ${sliceIndex} time-slice(s), 0 events in window`,
      }).catch(() => {});
      await updateJobProgress(supabase, jobId, progressPatch()).catch(() => {});
      calendarOffset = 0;
    }

    await updateJobProgress(supabase, jobId, progressPatch());

    if (cancelledByUser) {
      await finishJob(supabase, jobId, 'cancelled', `Cancelled (${cancelledByUser})`);
      return new Response(JSON.stringify({ success: true, cancelled: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pausedByUser) {
      await partialExit(supabase, jobId, { calendarIndex, calendarOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, paused: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (timeBudgetExhausted) {
      await partialExit(supabase, jobId, { calendarIndex, calendarOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, partial: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    await saveCheckpoint(supabase, jobId, {});
    try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch {}
    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      totalFailed > 0 ? `Completed with ${totalFailed} failures` : undefined);

    console.log(`[bookings-worker] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped}`);
    return new Response(JSON.stringify({
      success: true, processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[bookings-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-bookings-worker'), success: false }), { status: 500 });
  }
});
