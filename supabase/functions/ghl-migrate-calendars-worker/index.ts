/**
 * GHL Migrate: CALENDARS Worker
 *
 * Reads each calendar from the source GHL account, translates referenced
 * IDs (groupId, teamMembers[].userId) via `ghl_id_mapping` and creates a
 * fresh calendar in the target account. Records mapping under
 * `resource_type='calendar'`.
 *
 * Behaviour notes:
 *  - Calendar groups MUST be migrated first; calendars referencing an
 *    unmapped groupId fall back to no group (warning recorded).
 *  - Team members whose userId has no mapping are dropped with a warning.
 *  - Account-specific fields (id, locationId, dateAdded, dateUpdated) are
 *    stripped before POST.
 *  - External meeting integrations (Zoom/Meet) cannot transfer — the new
 *    account owner must reconnect them manually; flagged in error_message.
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
    const dropUnmappedTeamMembers = payload.drop_unmapped_team_members !== false; // default true
    const defaultUserId: string | null = payload.default_user_id || null; // fallback when no team members map
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

    // Allowlist of fields accepted by POST /calendars/ (LeadConnector v2)
    // Anything not in this list will be dropped from the source payload.
    const ALLOWED_FIELDS = new Set<string>([
      'name', 'description', 'slug', 'widgetSlug',
      'calendarType', 'widgetType', 'eventType', 'eventTitle', 'eventColor',
      'slotDuration', 'slotDurationUnit', 'slotInterval', 'slotIntervalUnit',
      'slotBuffer', 'slotBufferUnit', 'preBuffer', 'preBufferUnit',
      'appoinmentPerSlot', 'appoinmentPerDay', 'appointmentPerSlot', 'appointmentPerDay',
      'allowBookingAfter', 'allowBookingAfterUnit', 'allowBookingFor', 'allowBookingForUnit',
      'openHours', 'enableRecurring', 'recurring',
      'formId', 'stickyContact', 'isLivePaymentMode',
      'autoConfirm', 'shouldSendAlertEmailsToAssignedMember', 'alertEmail',
      'googleInvitationEmails', 'allowReschedule', 'allowCancellation',
      'shouldAssignContactToTeamMember', 'shouldSkipAssigningContactForExisting',
      'notes', 'pixelId', 'formSubmitType', 'formSubmitThanksMessage',
      'availabilityType', 'availabilities', 'guestType', 'consentLabel', 'consentLabelV2',
      'calendarCoverImage', 'lookBusyConfig',
      // Set explicitly below: locationId, teamMembers, groupId
    ]);

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
      logTag: 'calendars-worker',
    });

    console.log(`[calendars-worker] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun}`);

    // List source calendars
    const listRes = await ctx.ghlFetch(
      `${GHL_API_BASE}/calendars/?locationId=${sourceCreds.locationId}`,
      { method: 'GET', headers: sourceHeaders },
      3, 'source',
    );
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`List calendars failed ${listRes.status}: ${t.substring(0, 240)}`);
    }
    const listData = await listRes.json();
    const calendars: any[] = listData?.calendars || listData?.data || [];

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.offset || 0) > 0;
    const startOffset = Number(checkpoint.cursor.offset) || 0;

    if (!isResume) await startJob(supabase, jobId, calendars.length);

    // Pre-load existing target calendars for idempotent slug/name matching.
    // Without this, re-runs after a partial migration fail with
    // "Calendar slug is already taken" because the worker tries to recreate
    // calendars that already exist in the target account.
    const targetBySlug = new Map<string, any>();
    const targetByName = new Map<string, any>();
    if (!dryRun) {
      try {
        const tr = await ctx.ghlFetch(
          `${GHL_API_BASE}/calendars/?locationId=${targetCreds.locationId}`,
          { method: 'GET', headers: targetHeaders }, 2, 'target',
        );
        if (tr.ok) {
          const td = await tr.json();
          const tcals: any[] = td?.calendars || td?.data || [];
          for (const tc of tcals) {
            if (tc.slug) targetBySlug.set(String(tc.slug).toLowerCase(), tc);
            if (tc.widgetSlug) targetBySlug.set(String(tc.widgetSlug).toLowerCase(), tc);
            if (tc.name) targetByName.set(String(tc.name).toLowerCase().trim(), tc);
          }
          console.log(`[calendars-worker] Pre-loaded ${tcals.length} target calendars for idempotent matching`);
        } else {
          console.warn(`[calendars-worker] Could not pre-load target calendars: ${tr.status}`);
        }
      } catch (e: any) {
        console.warn(`[calendars-worker] Target pre-load threw: ${e.message}`);
      }
    }

    // Auto-resolve a fallback userId from the target account if none provided.
    let resolvedDefaultUserId: string | null = defaultUserId;
    if (!dryRun && !resolvedDefaultUserId) {
      try {
        const ur = await ctx.ghlFetch(
          `${GHL_API_BASE}/users/?locationId=${targetCreds.locationId}`,
          { method: 'GET', headers: targetHeaders }, 2, 'target',
        );
        if (ur.ok) {
          const ud = await ur.json();
          const users: any[] = ud?.users || ud?.data || [];
          if (users.length > 0) {
            resolvedDefaultUserId = users[0].id;
            console.log(`[calendars-worker] Auto-resolved default_user_id=${resolvedDefaultUserId} (${users[0].name || users[0].email || ''})`);
          }
        } else {
          console.warn(`[calendars-worker] Could not fetch target users for default fallback: ${ur.status}`);
        }
      } catch (e: any) {
        console.warn(`[calendars-worker] Default user resolve threw: ${e.message}`);
      }
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
    let currentOffset = startOffset;
    let timeBudgetExhausted = false, pausedByUser = false;
    let cancelledByUser: 'pause' | 'cancel' | 'kill' | null = null;
    const progressPatch = () => ({
      processed_items: baseProcessed + totalProcessed,
      succeeded_items: baseSucceeded + totalSucceeded,
      failed_items: baseFailed + totalFailed,
    });

    for (let i = startOffset; i < calendars.length; i++) {
      if (totalProcessed % 5 === 0) {
        const sig = await readControlSignal(supabase, jobId);
        if (sig === 'kill' || sig === 'cancel') { cancelledByUser = sig; break; }
        if (sig === 'pause') { pausedByUser = true; break; }
      }
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }

      const c = calendars[i];
      totalProcessed++;
      currentOffset = i + 1;
      const oldId = c.id;
      const label = c.name || 'Calendar';

      // Already mirrored?
      const existing = await lookupMapping(supabase, 'calendar', oldId, sourceAccount, targetAccount);
      if (existing) {
        totalSkipped++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, target_id: existing,
          entity_label: label, status: 'skipped', error_message: 'Already mirrored',
        });
        continue;
      }

      // Idempotent match: existing target calendar with same slug or name.
      const matchBySlug =
        (c.slug && targetBySlug.get(String(c.slug).toLowerCase())) ||
        (c.widgetSlug && targetBySlug.get(String(c.widgetSlug).toLowerCase())) ||
        null;
      const matchByName = !matchBySlug && c.name
        ? targetByName.get(String(c.name).toLowerCase().trim()) : null;
      const preExisting = matchBySlug || matchByName;
      if (preExisting && !dryRun) {
        await recordIdMapping(supabase, {
          resource_type: 'calendar', old_ghl_id: oldId, new_ghl_id: preExisting.id,
          source_account_label: sourceAccount, target_account_label: targetAccount,
          notes: `${label} (linked to existing target by ${matchBySlug ? 'slug' : 'name'})`,
        });
        totalSkipped++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, target_id: preExisting.id,
          entity_label: label, status: 'skipped',
          error_message: `Linked to existing target calendar by ${matchBySlug ? 'slug' : 'name'} (no new calendar created)`,
        });
        continue;
      }

      // Fetch full config
      let full: any = c;
      try {
        const r = await ctx.ghlFetch(`${GHL_API_BASE}/calendars/${oldId}`, {
          method: 'GET', headers: sourceHeaders,
        }, 3, 'source');
        if (r.ok) {
          const d = await r.json();
          full = d?.calendar || d || c;
        }
      } catch {}

      // Resolve groupId
      const warnings: string[] = [];
      let mappedGroupId: string | undefined;
      if (full.groupId) {
        const m = await lookupMapping(supabase, 'calendar_group', full.groupId, sourceAccount, targetAccount);
        if (m) mappedGroupId = m;
        else warnings.push(`groupId ${full.groupId} unmapped (run calendar_groups first)`);
      }

      // Resolve teamMembers
      const sourceMembers: any[] = Array.isArray(full.teamMembers) ? full.teamMembers : [];
      const mappedMembers: any[] = [];
      const droppedMembers: string[] = [];
      for (const m of sourceMembers) {
        const oldUserId = m.userId;
        const mappedUserId = await lookupMapping(supabase, 'user', oldUserId, sourceAccount, targetAccount);
        if (mappedUserId) {
          mappedMembers.push({ ...m, userId: mappedUserId });
        } else if (dropUnmappedTeamMembers) {
          droppedMembers.push(oldUserId);
        } else {
          // Pass through; GHL will error.
          mappedMembers.push(m);
        }
      }
      if (droppedMembers.length) {
        warnings.push(`Dropped ${droppedMembers.length} unmapped team member(s): ${droppedMembers.slice(0, 3).join(',')}${droppedMembers.length > 3 ? '…' : ''}`);
      }

      // Fallback: GHL requires >=1 team member. Use configured OR auto-fetched fallback userId.
      const fallbackUserId = resolvedDefaultUserId;
      if (mappedMembers.length === 0 && fallbackUserId) {
        mappedMembers.push({ userId: fallbackUserId, priority: 0.5, selected: true });
        warnings.push(`No mapped team members — assigned fallback userId ${fallbackUserId}`);
      }

      // PERSONAL calendars accept exactly one team member.
      const calendarType = String(full.calendarType || '').toUpperCase();
      if (calendarType === 'PERSONAL' && mappedMembers.length > 1) {
        warnings.push(`PERSONAL calendar trimmed from ${mappedMembers.length} to 1 team member`);
        mappedMembers.length = 1;
      }

      // External integrations cannot transfer
      const hasZoom = JSON.stringify(full).toLowerCase().includes('zoom');
      const hasMeet = JSON.stringify(full).toLowerCase().includes('googlemeet') ||
                      JSON.stringify(full).toLowerCase().includes('google_meet');
      if (hasZoom) warnings.push('Zoom integration must be reconnected in target account');
      if (hasMeet) warnings.push('Google Meet integration must be reconnected in target account');

      // Build payload via strict ALLOWLIST — drop everything GHL doesn't accept on POST.
      const stripped: any = {};
      for (const k of Object.keys(full)) {
        if (ALLOWED_FIELDS.has(k)) stripped[k] = full[k];
      }
      stripped.locationId = targetCreds.locationId;
      if (mappedGroupId) stripped.groupId = mappedGroupId;
      // Normalise teamMembers shape (PERSONAL requires {userId, priority, selected})
      stripped.teamMembers = mappedMembers.map((tm: any) => ({
        userId: tm.userId,
        priority: typeof tm.priority === 'number' ? tm.priority : 0.5,
        selected: tm.selected !== false,
        ...(tm.meetingLocationType ? { meetingLocationType: tm.meetingLocationType } : {}),
        ...(tm.meetingLocation ? { meetingLocation: tm.meetingLocation } : {}),
        ...(tm.locationConfigurations ? { locationConfigurations: tm.locationConfigurations } : {}),
      }));

      // Skip when there are still no team members — GHL will reject.
      if (mappedMembers.length === 0) {
        totalFailed++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, entity_label: label, status: 'failed',
          error_message: `No team members could be mapped. Migrate users first OR pass payload.default_user_id (a userId in the target account).${warnings.length ? ' | ' + warnings.join('; ') : ''}`.substring(0, 900),
        });
        continue;
      }


      if (dryRun) {
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, entity_label: label, status: 'succeeded',
          error_message: `DRY RUN — would create. ${warnings.join('; ').substring(0, 700)}`,
        });
        continue;
      }

      try {
        let r = await ctx.ghlFetch(`${GHL_API_BASE}/calendars/`, {
          method: 'POST', headers: targetHeaders, body: JSON.stringify(stripped),
        }, 3, 'target');

        // Slug-taken recovery: re-query target by slug/name; if found, link
        // instead of erroring. Otherwise try once with a unique slug suffix.
        if (!r.ok) {
          const peek = await r.clone().text();
          const isSlugTaken = /slug\s+is\s+already\s+taken/i.test(peek) ||
                              /already\s+exists/i.test(peek);
          if (isSlugTaken) {
            try {
              const tr = await ctx.ghlFetch(
                `${GHL_API_BASE}/calendars/?locationId=${targetCreds.locationId}`,
                { method: 'GET', headers: targetHeaders }, 2, 'target',
              );
              if (tr.ok) {
                const td = await tr.json();
                const tcals: any[] = td?.calendars || td?.data || [];
                const hit = tcals.find((tc) =>
                  (stripped.slug && (tc.slug === stripped.slug || tc.widgetSlug === stripped.slug)) ||
                  (stripped.name && String(tc.name || '').toLowerCase().trim() === String(stripped.name).toLowerCase().trim())
                );
                if (hit?.id) {
                  await recordIdMapping(supabase, {
                    resource_type: 'calendar', old_ghl_id: oldId, new_ghl_id: hit.id,
                    source_account_label: sourceAccount, target_account_label: targetAccount,
                    notes: `${label} (linked on slug-taken recovery)`,
                  });
                  totalSkipped++;
                  await recordItem(supabase, {
                    job_id: jobId, source_id: oldId, target_id: hit.id,
                    entity_label: label, status: 'skipped',
                    error_message: 'Slug already taken — linked to existing target calendar',
                  });
                  continue;
                }
              }
            } catch {}
            // Retry once with a unique slug suffix
            const suffix = `-${Date.now().toString(36).slice(-5)}`;
            if (stripped.slug) stripped.slug = String(stripped.slug).substring(0, 45) + suffix;
            if (stripped.widgetSlug) stripped.widgetSlug = String(stripped.widgetSlug).substring(0, 45) + suffix;
            warnings.push(`Original slug taken — created with suffix ${suffix}`);
            r = await ctx.ghlFetch(`${GHL_API_BASE}/calendars/`, {
              method: 'POST', headers: targetHeaders, body: JSON.stringify(stripped),
            }, 2, 'target');
          }
        }

        if (!r.ok) {
          const t = await r.text();
          const parsed = parseGhlError(t);
          const code = parsed.error_code || `GHL_${r.status}`;
          const authDetail = (r.status === 401 || r.status === 403) && targetAuthHint ? ` ${targetAuthHint}` : '';
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: oldId, entity_label: label, status: 'failed',
            error_message: `[${code}] ${r.status}: ${(parsed.message || t).substring(0, 240)}${authDetail}${warnings.length ? ' | ' + warnings.join('; ') : ''}`.substring(0, 900),
          });
          continue;
        }
        const data = await r.json();
        const newId = data?.calendar?.id || data?.id;
        if (newId) {
          await recordIdMapping(supabase, {
            resource_type: 'calendar', old_ghl_id: oldId, new_ghl_id: newId,
            source_account_label: sourceAccount, target_account_label: targetAccount, notes: label,
          });
        }
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, target_id: newId || null,
          entity_label: label,
          status: warnings.length > 0 ? 'succeeded' : 'succeeded',
          error_message: warnings.length ? `Created with warnings: ${warnings.join('; ').substring(0, 800)}` : null,
        });
      } catch (e: any) {
        totalFailed++;
        await recordItem(supabase, {
          job_id: jobId, source_id: oldId, entity_label: label, status: 'failed',
          error_message: (e.message || 'Unknown').substring(0, 300),
        });
      }

      if (totalProcessed % 10 === 0) {
        await updateJobProgress(supabase, jobId, progressPatch());
        await heartbeat(supabase, jobId);
      }
    }

    await updateJobProgress(supabase, jobId, progressPatch());

    if (cancelledByUser) {
      await finishJob(supabase, jobId, 'cancelled', `Cancelled (${cancelledByUser})`);
      return new Response(JSON.stringify({ success: true, cancelled: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pausedByUser) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, paused: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (timeBudgetExhausted && currentOffset < calendars.length) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      return new Response(JSON.stringify({ success: true, partial: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    await saveCheckpoint(supabase, jobId, {});
    try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch {}
    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      totalFailed > 0 ? `Completed with ${totalFailed} failures` : undefined);

    console.log(`[calendars-worker] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped}`);
    return new Response(JSON.stringify({
      success: true, processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[calendars-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-calendars-worker'), success: false }), { status: 500 });
  }
});
