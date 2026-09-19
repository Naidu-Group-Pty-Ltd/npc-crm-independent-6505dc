import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { mapWithConcurrency } from '../_shared/boundedConcurrency.pure.ts';
import { fetchMailPage, type MailPage } from '../_shared/graphMailPaging.ts';

/** Independent per-colleague Graph reads, overlapped but bounded. */
const USER_CONCURRENCY = 6;
const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID');
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const MICROSOFT_TENANT_ID = Deno.env.get('MICROSOFT_TENANT_ID');

// ── Microsoft Graph helpers ──────────────────────────────────────────

async function getAccessToken(): Promise<{ token: string; scopes?: string }> {
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    client_secret: MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[outlook-calendar] Token request failed:', err);
    throw new Error(`Token request failed: ${err}`);
  }
  const data = await res.json();
  console.log('[outlook-calendar] Token acquired, expires_in:', data.expires_in);
  return { token: data.access_token, scopes: data.scope };
}

function graphUrl(email: string, path: string) {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}${path}`;
}

// ── Resolve the user's Microsoft email ───────────────────────────────

async function resolveMicrosoftEmail(
  supabase: any,
  userId: string,
): Promise<string | null> {
  if (userId === 'service_role') return null;
  const { data } = await supabase
    .from('custom_users')
    .select('microsoft_email, email')
    .eq('id', userId)
    .maybeSingle();
  return data?.microsoft_email || data?.email || null;
}

// ── Mailbox ownership guard ──────────────────────────────────────────
// SECURITY: A user may only bind their own account email as their Microsoft
// mailbox. Without this, any authenticated user could point the app-only
// Graph token at another tenant user's mailbox / calendar.
async function loadCallerAccount(
  supabase: any,
  userId: string,
): Promise<{ email: string | null; role: string | null } | null> {
  if (!userId || userId === 'service_role') return null;
  const { data } = await supabase
    .from('custom_users')
    .select('email, role')
    .eq('id', userId)
    .maybeSingle();
  return data ? { email: data.email || null, role: data.role || null } : null;
}

function normaliseEmail(v: string | null | undefined): string {
  return (v || '').trim().toLowerCase();
}

function assertMailboxOwnership(
  requested: string | null | undefined,
  account: { email: string | null; role: string | null } | null,
): { ok: true } | { ok: false; error: string } {
  const req = normaliseEmail(requested);
  if (!req) return { ok: true }; // clearing is always allowed
  if (!account) return { ok: false, error: 'User context required' };
  if (account.role === 'superadmin') return { ok: true };
  const own = normaliseEmail(account.email);
  if (!own) return { ok: false, error: 'Your account has no email on file — contact an administrator.' };
  if (req !== own) {
    return {
      ok: false,
      error: `You can only connect your own mailbox (${account.email}). Ask a superadmin to link a different address on your behalf.`,
    };
  }
  return { ok: true };
}

// ── Action handlers ──────────────────────────────────────────────────

/**
 * A calendar window is READ TO THE END, and says so when it is not.
 *
 * This asked Graph for one page of 200 `$orderby: start/dateTime` and returned
 * `data.value`. `@odata.nextLink` was never read, so a mailbox with more than
 * 200 events in the requested window lost the events with the LATEST start
 * times — the month view drew January correctly and emptied partway through,
 * and a busy colleague read as free for the rest of it. Ordering by start time
 * is what decided which half went missing; nothing about the symptom pointed
 * at paging.
 *
 * `fetchMailPage` is the repo's one implementation of the nextLink contract
 * (opaque, complete, followed verbatim or not at all) and is collection-
 * agnostic despite living beside the mail helpers. `Prefer` travels with it
 * because `/calendarView` answers in the mailbox's own timezone without it and
 * every consumer here treats these times as UTC.
 *
 * The walk is bounded, and a bound that BINDS is reported rather than
 * swallowed: `truncated` is true only when Graph still had pages and we
 * stopped, which is the distinction `graphMailPaging`'s own header calls the
 * failure it exists to end — a half-read window that reports itself complete
 * is indistinguishable from a quiet calendar.
 */
const CALENDAR_PAGE_SIZE = 200;
const CALENDAR_MAX_PAGES = 15; // 3,000 events in one window is already absurd

async function listEvents(
  accessToken: string,
  email: string,
  startTime: string,
  endTime: string,
): Promise<{ events: any[]; truncated: boolean; pages: number }> {
  const params = new URLSearchParams({
    startDateTime: startTime,
    endDateTime: endTime,
    $top: String(CALENDAR_PAGE_SIZE),
    $orderby: 'start/dateTime',
    $select: 'id,subject,start,end,location,bodyPreview,isAllDay,showAs,organizer,attendees,categories',
  });

  let url: string | null = graphUrl(email, `/calendarView?${params.toString()}`);
  console.log(`[outlook-calendar] listEvents for ${email}, url: ${url.substring(0, 80)}...`);

  const raw: any[] = [];
  let pages = 0;
  while (url && pages < CALENDAR_MAX_PAGES) {
    // Annotated: `url` is assigned from `page.nextLink` inside the loop that
    // produces `page`, and an inferred type there is circular (TS7022).
    const page: MailPage<any> = await fetchMailPage<any>(
      accessToken,
      url,
      `outlook-calendar:${email}`,
      { Prefer: 'outlook.timezone="UTC"' },
    );
    pages += 1;
    raw.push(...page.messages);
    url = page.nextLink;
  }

  const truncated = url !== null;
  if (truncated) {
    console.warn(
      `[outlook-calendar] window for ${email} truncated at ${CALENDAR_MAX_PAGES} pages ` +
      `(${raw.length} events); more remain between ${startTime} and ${endTime}`,
    );
  }

  return { events: raw.map((ev: any) => normalizeEvent(ev, email)), truncated, pages };
}

async function createEvent(
  accessToken: string,
  email: string,
  payload: {
    subject: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    body?: string;
    location?: string;
    attendees?: string[];
    isAllDay?: boolean;
    reminderMinutes?: number;
    showAs?: string;
    categories?: string[];
  },
) {
  const graphEvent: Record<string, any> = {
    subject: payload.subject,
    start: { dateTime: payload.startTime, timeZone: 'UTC' },
    end: { dateTime: payload.endTime, timeZone: 'UTC' },
    showAs: payload.showAs || 'busy',
  };

  if (payload.body) {
    graphEvent.body = { contentType: 'text', content: payload.body };
  }
  if (payload.location) {
    graphEvent.location = { displayName: payload.location };
  }
  if (payload.isAllDay) {
    graphEvent.isAllDay = true;
  }
  if (payload.reminderMinutes !== undefined) {
    graphEvent.isReminderOn = true;
    graphEvent.reminderMinutesBeforeStart = payload.reminderMinutes;
  }
  if (payload.categories?.length) {
    graphEvent.categories = payload.categories;
  }
  if (payload.attendees?.length) {
    graphEvent.attendees = payload.attendees.map((email) => ({
      emailAddress: { address: email },
      type: 'required',
    }));
  }

  const res = await fetch(graphUrl(email, '/events'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphEvent),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create event failed (${res.status}): ${err}`);
  }

  const created = await res.json();
  return normalizeEvent(created, email);
}

async function deleteEvent(accessToken: string, email: string, eventId: string) {
  const res = await fetch(graphUrl(email, `/events/${eventId}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`Delete event failed (${res.status}): ${err}`);
  }
  return true;
}

async function getFreeBusy(
  accessToken: string,
  emails: string[],
  startTime: string,
  endTime: string,
) {
  const body = {
    schedules: emails,
    startTime: { dateTime: startTime, timeZone: 'UTC' },
    endTime: { dateTime: endTime, timeZone: 'UTC' },
    availabilityViewInterval: 30,
  };

  // Use /users/{first-email}/calendar/getSchedule instead of /me/ (no /me/ with app-only tokens)
  const scheduleEmail = emails[0];
  const res = await meteredFetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(scheduleEmail)}/calendar/getSchedule`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  // getSchedule may not work with application-level tokens; fall back to per-user calendarView
  if (!res.ok) {
    // Fallback: read each user's calendarView and infer busy blocks
    // Same independent per-mailbox fan-out, overlapped.
    const results: any[] = [];
    for (const email of emails) {
      try {
        const { events } = await listEvents(accessToken, email, startTime, endTime);
        results.push({
          scheduleId: email,
          scheduleItems: events.map((ev: any) => ({
            status: ev.showAs || 'busy',
            start: ev.startTime,
            end: ev.endTime,
            subject: ev.title,
          })),
        });
      } catch (e) {
        results.push({ scheduleId: email, scheduleItems: [], error: (e as Error).message });
      }
    }
    return results;
  }

  const data = await res.json();
  return data.value || [];
}

async function updateEvent(
  accessToken: string,
  email: string,
  eventId: string,
  updates: Record<string, any>,
) {
  const graphUpdates: Record<string, any> = {};
  if (updates.subject) graphUpdates.subject = updates.subject;
  if (updates.startTime) graphUpdates.start = { dateTime: updates.startTime, timeZone: 'UTC' };
  if (updates.endTime) graphUpdates.end = { dateTime: updates.endTime, timeZone: 'UTC' };
  if (updates.body) graphUpdates.body = { contentType: 'text', content: updates.body };
  if (updates.location) graphUpdates.location = { displayName: updates.location };
  if (updates.showAs) graphUpdates.showAs = updates.showAs;
  if (updates.categories) graphUpdates.categories = updates.categories;

  const res = await fetch(graphUrl(email, `/events/${eventId}`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphUpdates),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Update event failed (${res.status}): ${err}`);
  }

  const updated = await res.json();
  return normalizeEvent(updated, email);
}

async function listTeamAvailability(
  supabase: any,
  accessToken: string,
  startTime: string,
  endTime: string,
) {
  // Every active colleague, not only the ones with Outlook linked.
  //
  // Audit item 27: the panel showed two people and the third was simply absent,
  // with nothing to say why. It filtered on `microsoft_email is not null`, and
  // of the four real accounts only two have one set — so a colleague who has
  // never connected Outlook was indistinguishable from one who does not exist.
  // They are returned with `outlookConnected: false` and no busy slots, so the
  // panel can say "not connected" instead of quietly leaving them out.
  const { data: users } = await supabase
    .from('custom_users')
    .select('id, username, microsoft_email, email')
    .eq('is_active', true);

  if (!users?.length) return [];

  // Seeded accounts addressed at reserved domains are not colleagues; the same
  // rule the pickers use (see `assignablePerson.pure.ts`).
  const unroutable = (address: string) => /\.(invalid|test|example|localhost)$|@example\.(com|net|org)$/i.test(address.trim());

  // One Graph round trip PER COLLEAGUE, and every one of them is independent
  // — nobody's calendar depends on anybody else's. Awaiting them in sequence
  // made the team view cost the sum of the team's latency, so it got slower
  // every time somebody joined. The order of the returned array is preserved,
  // which the page relies on.
  const connected = users.filter((u: any) => {
    const accountEmail = String(u.email ?? '');
    return !(accountEmail && unroutable(accountEmail));
  });

  const fetched = await mapWithConcurrency(connected, USER_CONCURRENCY, async (user: any) => {
    const msEmail = user.microsoft_email;
    if (!msEmail) {
      return {
        userId: user.id,
        username: user.username,
        email: user.email ?? null,
        events: [],
        busySlots: [],
        outlookConnected: false,
      };
    }
    // Only `events` here: an availability window is an appointment-sized slice,
    // and 3,000 events inside one is not a state that happens. The walk's own
    // console.warn is the signal if it ever does. A field nothing renders does
    // not belong in a payload that was just narrowed to what is rendered.
    const { events } = await listEvents(accessToken, msEmail, startTime, endTime);
    return {
      userId: user.id,
      username: user.username,
      email: msEmail,
      outlookConnected: true,
      events,
      busySlots: events
        .filter((e: any) => ['busy', 'tentative', 'oof', 'workingElsewhere'].includes(e.showAs))
        .map((e: any) => ({ start: e.startTime, end: e.endTime, title: e.title, showAs: e.showAs })),
    };
  });

  // One colleague's mailbox failing must not blank the whole team's calendar —
  // the loop this replaces caught per-user and pushed an entry carrying the
  // error, and that entry is what the page renders as "could not load".
  const results: any[] = [];
  for (const r of fetched.results) {
    if (r.value) {
      results.push(r.value);
      continue;
    }
    const user: any = r.item;
    console.error(`[outlook-calendar] Failed to fetch for ${user.microsoft_email}: ${r.error}`);
    results.push({
      userId: user.id,
      username: user.username,
      email: user.microsoft_email,
      outlookConnected: true,
      events: [],
      busySlots: [],
      error: r.error,
    });
  }
  return results;
}

// ── Normalize Graph event to a flat shape ────────────────────────────

function normalizeEvent(ev: any, ownerEmail: string) {
  return {
    id: ev.id,
    title: ev.subject || '(No subject)',
    startTime: ev.start?.dateTime ? new Date(ev.start.dateTime + 'Z').toISOString() : null,
    endTime: ev.end?.dateTime ? new Date(ev.end.dateTime + 'Z').toISOString() : null,
    isAllDay: ev.isAllDay || false,
    location: ev.location?.displayName || null,
    bodyPreview: ev.bodyPreview || null,
    showAs: ev.showAs || 'busy',
    organizer: ev.organizer?.emailAddress?.address || null,
    attendees: (ev.attendees || []).map((a: any) => ({
      email: a.emailAddress?.address,
      name: a.emailAddress?.name,
      status: a.status?.response,
    })),
    categories: ev.categories || [],
    ownerEmail,
    source: 'outlook' as const,
    // Provide a calendarId compatible with GHL overlay system
    calendarId: `outlook_${ownerEmail}`,
    calendarName: `Outlook (${ownerEmail})`,
    calendarColor: '#0078d4', // Microsoft blue
    status: 'confirmed',
  };
}

// ── Main handler ─────────────────────────────────────────────────────

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
    // Validate Microsoft config
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID) {
      return new Response(JSON.stringify({ error: 'Microsoft credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action } = body;

    // Authenticate
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[outlook-calendar] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[outlook-calendar] User: ${userId}, action: ${action}`);

    // Resolve calling user's Microsoft email
    // When called via service-role (e.g. from ai-dashboard-agent), use _userId from body
    const effectiveUserId = (userId === 'service_role' && body._userId) ? body._userId : userId;

    // SECURITY (Critical 7): the mailbox that the calendar CRUD actions
    // (listEvents/createEvent/updateEvent/deleteEvent/freeBusy) operate on is
    // resolved HERE. The backend uses an app-only Graph token, so honouring a
    // caller-supplied `targetEmail` without an ownership check let any
    // authenticated user read/modify another tenant user's calendar — the same
    // class of bug the mailbox-binding remediation closed for setMicrosoftEmail,
    // reached through a different parameter. Enforce the same guard: a caller
    // may only target their own account email; superadmins may target any.
    // Service-role callers (userId==='service_role') resolve via _userId only.
    if (body.targetEmail && userId !== 'service_role') {
      const caller = await loadCallerAccount(supabase, effectiveUserId!);
      const ownershipCheck = assertMailboxOwnership(body.targetEmail, caller);
      if (!ownershipCheck.ok) {
        console.log(`[outlook-calendar] Rejected targetEmail override for ${userId}: ${ownershipCheck.error}`);
        return jsonResponse({ error: ownershipCheck.error }, corsHeaders, 403);
      }
    }
    const userEmail = body.targetEmail || await resolveMicrosoftEmail(supabase, effectiveUserId!);

    // Get Microsoft access token
    const { token: accessToken, scopes } = await getAccessToken();
    console.log(`[outlook-calendar] Token scopes: ${scopes || 'N/A (app-only token - scopes not returned)'}`);

    // ── Diagnostic action ────────────────────────────────────────────
    if (action === 'testPermissions') {
      // SECURITY: never let the caller probe another user's mailbox.
      const caller = await loadCallerAccount(supabase, effectiveUserId!);
      const requestedTest = body.testEmail || userEmail;
      const ownershipCheck = assertMailboxOwnership(requestedTest, caller);
      if (!ownershipCheck.ok) {
        return jsonResponse({ error: ownershipCheck.error }, corsHeaders, 403);
      }
      const testEmail = requestedTest;
      if (!testEmail) {
        return jsonResponse({ error: 'No email to test. Provide testEmail or configure microsoft_email.' }, corsHeaders, 400);
      }
      console.log(`[outlook-calendar] Testing permissions for ${testEmail}`);
      
      // Test 1: Can we resolve the user in the directory?
      let userTest = { success: false, error: '' };
      try {
        const userRes = await meteredFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(testEmail)}?$select=id,displayName,mail,userPrincipalName`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          userTest = { success: true, error: '', ...userData };
        } else {
          const errText = await userRes.text();
          userTest = { success: false, error: `${userRes.status}: ${errText}` };
        }
      } catch (e) {
        userTest = { success: false, error: (e as Error).message };
      }

      // Test 2: Can we access their calendar?
      let calendarTest = { success: false, error: '' };
      try {
        const calRes = await fetch(graphUrl(testEmail, '/calendar'), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (calRes.ok) {
          const calData = await calRes.json();
          calendarTest = { success: true, error: '', calendarName: calData.name };
        } else {
          const errText = await calRes.text();
          calendarTest = { success: false, error: `${calRes.status}: ${errText}` };
        }
      } catch (e) {
        calendarTest = { success: false, error: (e as Error).message };
      }

      // Test 3: Can we list events?
      let eventsTest = { success: false, error: '', count: 0 };
      try {
        const now = new Date();
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const { events } = await listEvents(accessToken, testEmail, now.toISOString(), weekLater.toISOString());
        eventsTest = { success: true, error: '', count: events.length };
      } catch (e) {
        eventsTest = { success: false, error: (e as Error).message, count: 0 };
      }

      return jsonResponse({
        success: true,
        diagnostics: {
          tenantId: MICROSOFT_TENANT_ID,
          clientId: MICROSOFT_CLIENT_ID?.substring(0, 8) + '...',
          testEmail,
          tokenAcquired: true,
          userLookup: userTest,
          calendarAccess: calendarTest,
          eventsList: eventsTest,
          hint: !calendarTest.success 
            ? 'Calendar access denied. In Azure Portal → App registrations → your app → API permissions, ensure "Calendars.ReadWrite" is added as APPLICATION (not Delegated) permission AND admin consent has been granted (green checkmark).'
            : 'All permissions look good!',
        },
      }, corsHeaders);
    }

    // ── Route actions ────────────────────────────────────────────────

    if (action === 'listEvents') {
      if (!userEmail) {
        return jsonResponse({ error: 'No Microsoft email configured for this user', events: [] }, corsHeaders);
      }
      const { startTime, endTime } = body;
      if (!startTime || !endTime) {
        return jsonResponse({ error: 'startTime and endTime are required' }, corsHeaders, 400);
      }
      const listed = await listEvents(accessToken, userEmail, startTime, endTime);
      // `truncated` travels: a window Graph still had pages for is not the same
      // answer as a quiet calendar, and the page must be able to say so.
      return jsonResponse(
        { success: true, events: listed.events, truncated: listed.truncated },
        corsHeaders,
      );
    }

    if (action === 'createEvent') {
      if (!userEmail) {
        return jsonResponse({ error: 'No Microsoft email configured for this user' }, corsHeaders, 400);
      }
      const event = await createEvent(accessToken, userEmail, body);
      return jsonResponse({ success: true, event }, corsHeaders);
    }

    if (action === 'updateEvent') {
      if (!userEmail) {
        return jsonResponse({ error: 'No Microsoft email configured' }, corsHeaders, 400);
      }
      const { eventId, ...updates } = body;
      const event = await updateEvent(accessToken, userEmail, body.eventId, updates);
      return jsonResponse({ success: true, event }, corsHeaders);
    }

    if (action === 'deleteEvent') {
      if (!userEmail) {
        return jsonResponse({ error: 'No Microsoft email configured' }, corsHeaders, 400);
      }
      await deleteEvent(accessToken, userEmail, body.eventId);
      return jsonResponse({ success: true }, corsHeaders);
    }

    if (action === 'freeBusy') {
      const emails = body.emails as string[];
      if (!emails?.length) {
        return jsonResponse({ error: 'emails array is required' }, corsHeaders, 400);
      }
      // WP-13: every entry in `emails` must belong to the caller (or superadmin).
      // Previously only body.targetEmail was ownership-checked, so a caller could
      // read arbitrary tenant users' free/busy via the array.
      if (userId !== 'service_role') {
        const caller = await loadCallerAccount(supabase, effectiveUserId!);
        for (const em of emails) {
          const check = assertMailboxOwnership(em, caller);
          if (!check.ok) {
            console.log(`[outlook-calendar] Rejected freeBusy email for ${userId}: ${check.error}`);
            return jsonResponse({ error: check.error }, corsHeaders, 403);
          }
        }
      }
      const { startTime, endTime } = body;
      const schedule = await getFreeBusy(accessToken, emails, startTime, endTime);
      return jsonResponse({ success: true, schedule }, corsHeaders);
    }


    if (action === 'teamAvailability') {
      const { startTime, endTime } = body;
      if (!startTime || !endTime) {
        return jsonResponse({ error: 'startTime and endTime required' }, corsHeaders, 400);
      }
      /**
       * THIS HAD NO CHECK OF ANY KIND, directly beneath the one that does.
       *
       * `freeBusy`, immediately above, passes every requested address through
       * `assertMailboxOwnership` — WP-13 hardened it precisely so a caller
       * could not read arbitrary colleagues' calendars through the `emails`
       * array. `teamAvailability` reaches the same data by a different door:
       * it walks every active `custom_users` row and calls `listEvents` for
       * each against the APP-ONLY Graph token, which is not scoped to the
       * caller at all. Any authenticated dashboard user who posted
       * `{action:'teamAvailability', startTime, endTime}` got every
       * colleague's calendar back.
       *
       * Two things are wrong and both are fixed here.
       *
       * A caller must be a real, active staff account. `loadCallerAccount`
       * returning null is the file's own test for that, and it is what the
       * settings actions below already use.
       */
      if (!userId || userId === 'service_role') {
        return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
      }
      const teamCaller = await loadCallerAccount(supabase, effectiveUserId!);
      if (!teamCaller) {
        return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
      }
      /**
       * And the response carries availability, never the appointments.
       *
       * `listTeamAvailability` returned a full `events` array per colleague —
       * each entry carrying `title`, `bodyPreview`, `organizer`, `attendees`
       * (address, name and response status), `location` and `categories` from
       * `normalizeEvent`. NOTHING renders it: every consumer
       * (`OutlookCalendarPanel`, `TeamOutlookAvailability`) reads `username`,
       * `outlookConnected`, `error` and `busySlots` alone. It was the whole
       * disclosure and none of the feature, so it does not leave the function.
       */
      const team = await listTeamAvailability(supabase, accessToken, startTime, endTime);
      const availability = (team || []).map((m: any) => ({
        userId: m.userId,
        username: m.username,
        outlookConnected: m.outlookConnected,
        // `busySlots` passes through whole: it is already the narrowed shape
        // (`start`, `end`, `title`, `showAs`) and every field of it is drawn.
        busySlots: m.busySlots ?? [],
        ...(m.error ? { error: m.error } : {}),
      }));
      return jsonResponse({ success: true, team: availability }, corsHeaders);
    }

    if (action === 'setMicrosoftEmail') {
      // Allow user to update their own microsoft_email — must equal their account email.
      const { microsoftEmail } = body;
      if (!userId || userId === 'service_role') {
        return jsonResponse({ error: 'User context required' }, corsHeaders, 400);
      }
      const caller = await loadCallerAccount(supabase, userId);
      const ownershipCheck = assertMailboxOwnership(microsoftEmail, caller);
      if (!ownershipCheck.ok) {
        console.log(`[outlook-calendar] Rejected setMicrosoftEmail for ${userId}: ${ownershipCheck.error}`);
        return jsonResponse({ error: ownershipCheck.error }, corsHeaders, 403);
      }
      const { error: updateError } = await supabase
        .from('custom_users')
        .update({ microsoft_email: microsoftEmail || null })
        .eq('id', userId);

      if (updateError) {
        throw new Error(`Failed to update: ${updateError.message}`);
      }
      return jsonResponse({ success: true, microsoftEmail }, corsHeaders);
    }

    if (action === 'getMicrosoftEmail') {
      if (!userId || userId === 'service_role') {
        return jsonResponse({ error: 'User context required' }, corsHeaders, 400);
      }
      const email = await resolveMicrosoftEmail(supabase, userId);
      return jsonResponse({ success: true, microsoftEmail: email }, corsHeaders);
    }

    if (action === 'getOutlookSettings') {
      if (!userId || userId === 'service_role') {
        return jsonResponse({ error: 'User context required' }, corsHeaders, 400);
      }
      const { data: user } = await supabase
        .from('custom_users')
        .select('outlook_auto_prep_enabled, outlook_prep_minutes, outlook_follow_up_blocking, outlook_follow_up_default_duration')
        .eq('id', userId)
        .maybeSingle();
      return jsonResponse({
        success: true,
        settings: {
          autoPrepEnabled: user?.outlook_auto_prep_enabled || false,
          prepMinutes: user?.outlook_prep_minutes || 15,
          followUpBlocking: user?.outlook_follow_up_blocking || false,
          followUpDefaultDuration: user?.outlook_follow_up_default_duration || 30,
        },
      }, corsHeaders);
    }

    if (action === 'updateOutlookSettings') {
      if (!userId || userId === 'service_role') {
        return jsonResponse({ error: 'User context required' }, corsHeaders, 400);
      }
      const s = body.settings || {};
      const { error: updateError } = await supabase
        .from('custom_users')
        .update({
          outlook_auto_prep_enabled: s.autoPrepEnabled ?? false,
          outlook_prep_minutes: s.prepMinutes ?? 15,
          outlook_follow_up_blocking: s.followUpBlocking ?? false,
          outlook_follow_up_default_duration: s.followUpDefaultDuration ?? 30,
        })
        .eq('id', userId);
      if (updateError) throw new Error(updateError.message);
      return jsonResponse({ success: true }, corsHeaders);
    }

    // Agent tool: create event for a specific user by email (service-to-service ONLY)
    if (action === 'createEventForUser') {
      // SECURITY: this action bypasses per-user mailbox ownership, so only
      // trust it when the caller is service_role (invoked from a backend
      // function). A signed-in end user must go through `createEvent`.
      if (userId !== 'service_role') {
        return jsonResponse({ error: 'createEventForUser is service-role only' }, corsHeaders, 403);
      }
      const targetEmail = body.targetUserEmail;
      if (!targetEmail) {
        return jsonResponse({ error: 'targetUserEmail is required' }, corsHeaders, 400);
      }
      const event = await createEvent(accessToken, targetEmail, body);
      return jsonResponse({ success: true, event }, corsHeaders);
    }

    // Agent tool: get team member Outlook settings
    if (action === 'getTeamOutlookStatus') {
      // Same door, same rule: this enumerates every active colleague and their
      // linked Microsoft address. A service-role caller (the dashboard agent)
      // is allowed; an unauthenticated one is not.
      if (userId !== 'service_role') {
        if (!userId) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        const statusCaller = await loadCallerAccount(supabase, effectiveUserId!);
        if (!statusCaller) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
      }
      const { data: users } = await supabase
        .from('custom_users')
        .select('id, username, microsoft_email, outlook_auto_prep_enabled')
        .eq('is_active', true);
      const teamStatus = (users || []).map((u: any) => ({
        userId: u.id,
        username: u.username,
        microsoftEmail: u.microsoft_email || null,
        isConfigured: Boolean(u.microsoft_email),
        autoPrepEnabled: u.outlook_auto_prep_enabled || false,
      }));
      return jsonResponse({ success: true, team: teamStatus }, corsHeaders);
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, corsHeaders, 400);

  } catch (err) {
    console.error('[outlook-calendar] Error:', err);
    return new Response(JSON.stringify(internalError(err, 'outlook-calendar')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function jsonResponse(data: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
