import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getGhlCredentials, validateGhlCredentials, buildGhlHeaders, type GhlAccount } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

type Domain = 'contacts' | 'opportunities' | 'conversations' | 'notes' | 'pipelines' | 'location' | 'calendar_groups' | 'calendars' | 'bookings';

interface DomainResult {
  domain: Domain;
  count: number | null;
  sample: any[];
  error?: string;
  meta?: Record<string, any>;
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));

    // ── Authn ──
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      console.log('[ghl-account-preview] Auth failed:', authError);
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    // ── Authz: superadmin only (service_role exempted for cron/internal calls) ──
    if (userId !== 'service_role') {
      const { data: roleRows, error: roleErr } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (roleErr) {
        console.error('[ghl-account-preview] role lookup failed:', roleErr);
        return createForbiddenResponse('Role check failed', corsHeaders);
      }

      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) {
        console.log('[ghl-account-preview] Access denied for user:', userId);
        return createForbiddenResponse('Superadmin access required', corsHeaders);
      }
    }

    const account: GhlAccount = body.account === 'new' ? 'new' : 'legacy';
    const ALLOWED: Domain[] = ['contacts', 'opportunities', 'conversations', 'notes', 'pipelines', 'location', 'calendar_groups', 'calendars', 'bookings'];
    const domains: Domain[] = Array.isArray(body.domains) && body.domains.length > 0
      ? body.domains.filter((d: string) => (ALLOWED as string[]).includes(d))
      : ['location', 'contacts', 'pipelines', 'opportunities', 'conversations', 'notes', 'calendar_groups', 'calendars', 'bookings'];

    const creds = getGhlCredentials(account);
    const credErr = validateGhlCredentials(creds);
    if (credErr) {
      return new Response(JSON.stringify({
        success: false,
        account,
        error: credErr,
        results: [],
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = buildGhlHeaders(creds.apiKey!);
    const locationId = creds.locationId!;

    console.log(`[ghl-account-preview] account=${account} user=${userId} domains=${domains.join(',')}`);

    const results: DomainResult[] = [];
    for (const domain of domains) {
      try {
        const r = await fetchDomain(domain, locationId, headers);
        results.push(r);
      } catch (err: any) {
        console.error(`[ghl-account-preview] ${domain} failed:`, err.message);
        results.push({ domain, count: null, sample: [], error: err.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      account: creds.label,
      location_id: locationId,
      fetched_at: new Date().toISOString(),
      results,
      mode: 'read-only',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[ghl-account-preview] error:', err);
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-account-preview'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fetchDomain(
  domain: Domain,
  locationId: string,
  headers: Record<string, string>
): Promise<DomainResult> {
  switch (domain) {
    case 'location':
      return await fetchLocation(locationId, headers);
    case 'contacts':
      return await fetchContacts(locationId, headers);
    case 'opportunities':
      return await fetchOpportunities(locationId, headers);
    case 'conversations':
      return await fetchConversations(locationId, headers);
    case 'notes':
      return await fetchNotes(locationId, headers);
    case 'pipelines':
      return await fetchPipelines(locationId, headers);
    case 'calendar_groups':
      return await fetchCalendarGroups(locationId, headers);
    case 'calendars':
      return await fetchCalendars(locationId, headers);
    case 'bookings':
      return await fetchBookings(locationId, headers);
  }
}

async function fetchCalendarGroups(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ locationId });
  const res = await fetch(`${GHL_API_BASE}/calendars/groups?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-04-15' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'calendar_groups', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const groups = data.groups || [];
  return {
    domain: 'calendar_groups',
    count: groups.length,
    sample: groups.slice(0, 5).map((g: any) => ({ id: g.id, name: g.name, slug: g.slug, isActive: g.isActive })),
  };
}

async function fetchCalendars(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ locationId });
  const res = await fetch(`${GHL_API_BASE}/calendars/?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-04-15' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'calendars', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const calendars = data.calendars || [];
  return {
    domain: 'calendars',
    count: calendars.length,
    sample: calendars.slice(0, 5).map((c: any) => ({
      id: c.id,
      name: c.name,
      groupId: c.groupId,
      slug: c.slug,
      isActive: c.isActive,
      teamMembers: (c.teamMembers || []).length,
    })),
  };
}

async function fetchBookings(_locationId: string, _headers: Record<string, string>): Promise<DomainResult> {
  // Bookings are per-calendar in GHL API; counts are derivable only by iterating calendars.
  return {
    domain: 'bookings',
    count: null,
    sample: [],
    meta: {
      info: 'Bookings are per-calendar in GHL; counts are derivable only by iterating calendars. Available in dedicated worker.',
    },
  };
}

async function fetchLocation(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const res = await fetch(`${GHL_API_BASE}/locations/${locationId}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-07-28' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'location', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const loc = data.location || data;
  return {
    domain: 'location',
    count: 1,
    sample: [{
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      country: loc.country,
      timezone: loc.timezone,
      email: loc.email,
    }],
    meta: { account_name: loc.name },
  };
}

async function fetchContacts(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ locationId, limit: '5' });
  const res = await fetch(`${GHL_API_BASE}/contacts/?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-07-28' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'contacts', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const contacts = data.contacts || [];
  const total = data.meta?.total ?? data.total ?? null;
  return {
    domain: 'contacts',
    count: total,
    sample: contacts.slice(0, 5).map((c: any) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || '(no name)',
      email: c.email,
      phone: c.phone,
      tags: c.tags,
      dateAdded: c.dateAdded,
    })),
  };
}

async function fetchOpportunities(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ location_id: locationId, limit: '5' });
  const res = await fetch(`${GHL_API_BASE}/opportunities/search?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-07-28' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'opportunities', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const opps = data.opportunities || [];
  const total = data.meta?.total ?? null;
  return {
    domain: 'opportunities',
    count: total,
    sample: opps.slice(0, 5).map((o: any) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      monetaryValue: o.monetaryValue,
      pipelineId: o.pipelineId,
      pipelineStageId: o.pipelineStageId,
      contactId: o.contactId,
    })),
  };
}

async function fetchConversations(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ locationId, limit: '5' });
  const res = await fetch(`${GHL_API_BASE}/conversations/search?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-07-28' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'conversations', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const convs = data.conversations || [];
  const total = data.total ?? data.meta?.total ?? null;
  return {
    domain: 'conversations',
    count: total,
    sample: convs.slice(0, 5).map((c: any) => ({
      id: c.id,
      contactId: c.contactId,
      type: c.type,
      lastMessageBody: (c.lastMessageBody || c.snippet || '').substring(0, 80),
      lastMessageDate: c.lastMessageDate || c.dateUpdated,
      unreadCount: c.unreadCount,
    })),
  };
}

async function fetchNotes(_locationId: string, _headers: Record<string, string>): Promise<DomainResult> {
  // Notes have no list-by-location endpoint in GHL API; they're per-contact.
  // Read-only preview: report capability only.
  return {
    domain: 'notes',
    count: null,
    sample: [],
    meta: {
      info: 'Notes are per-contact in GHL; counts are derivable only by iterating contacts. Available in Phase 2B worker.',
    },
  };
}

async function fetchPipelines(locationId: string, headers: Record<string, string>): Promise<DomainResult> {
  const params = new URLSearchParams({ locationId });
  const res = await fetch(`${GHL_API_BASE}/opportunities/pipelines?${params}`, {
    method: 'GET',
    headers: { ...headers, Version: '2021-07-28' },
  });
  if (!res.ok) {
    const text = await res.text();
    return { domain: 'pipelines', count: null, sample: [], error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
  }
  const data = await res.json();
  const pipelines = data.pipelines || [];
  return {
    domain: 'pipelines',
    count: pipelines.length,
    sample: pipelines.map((p: any) => ({
      id: p.id,
      name: p.name,
      stageCount: (p.stages || []).length,
      stages: (p.stages || []).map((s: any) => ({ id: s.id, name: s.name, position: s.position })),
    })),
  };
}
