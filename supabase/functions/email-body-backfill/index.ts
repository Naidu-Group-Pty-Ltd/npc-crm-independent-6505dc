// One-shot / repeatable backfill for emails whose body was truncated at the
// old 10K cap and whose body_html was never persisted. Re-fetches the
// original message from Microsoft Graph and updates `body` + `body_html`.
//
// Invoke repeatedly (each call processes a batch) until { remaining: 0 }.
//   supabase.functions.invoke('email-body-backfill', { body: { limit: 25 } })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { createCorsHeaders } from '../_shared/auth.ts';

const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID');
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const MICROSOFT_TENANT_ID = Deno.env.get('MICROSOFT_TENANT_ID');
const DEFAULT_MAILBOX_EMAIL = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function getAccessToken(): Promise<string> {
  const r = await meteredFetch(`https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID!,
      client_secret: MICROSOFT_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

function convertHtmlToStructuredText(html: string): string {
  if (!html) return '';
  let t = html;
  t = t.replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '');
  t = t.replace(/<\/div>/gi, '\n').replace(/<div[^>]*>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n');
  t = t.replace(/<(b|strong)[^>]*>(.*?)<\/(b|strong)>/gi, '$2');
  t = t.replace(/<(i|em)[^>]*>(.*?)<\/(i|em)>/gi, '$2');
  t = t.replace(/<u[^>]*>(.*?)<\/u>/gi, '$2');
  t = t.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
  t = t.replace(/<\/?[ou]l[^>]*>/gi, '\n');
  t = t.replace(/<tr[^>]*>/gi, '').replace(/<\/tr>/gi, '\n');
  t = t.replace(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi, '$1\t');
  t = t.replace(/<\/?table[^>]*>/gi, '\n').replace(/<\/?t(head|body|foot)[^>]*>/gi, '');
  t = t.replace(/<[^>]*>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;|&lsquo;/g, "'")
       .replace(/&rdquo;|&ldquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
       .replace(/&hellip;/g, '...').replace(/&bull;/g, '•')
       .replace(/&#(\d+);/g, (_m, c) => String.fromCharCode(parseInt(c)));
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

async function findMessageOnGraph(token: string, sender: string, receivedAt: string, subject: string) {
  // Search a +/- 60s window around received_at filtered by sender.
  const t = new Date(receivedAt).getTime();
  const lo = new Date(t - 60_000).toISOString();
  const hi = new Date(t + 60_000).toISOString();
  const safeSender = sender.replace(/'/g, "''");
  const filter = `receivedDateTime ge ${lo} and receivedDateTime le ${hi} and from/emailAddress/address eq '${safeSender}'`;
  const url = `https://graph.microsoft.com/v1.0/users/${DEFAULT_MAILBOX_EMAIL}/messages?$filter=${encodeURIComponent(filter)}&$select=id,subject,body,receivedDateTime&$top=10`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`graph ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const items = data.value || [];
  if (items.length === 0) return null;
  // Prefer exact subject match, else closest by time.
  const exact = items.find((m: any) => (m.subject || '') === (subject || ''));
  return exact || items[0];
}

Deno.serve(async (req) => {
  // CORS is built PER REQUEST from the shared allowlist, never hardcoded.
  //
  // This answered `Access-Control-Allow-Origin: *` while running
  // `verify_jwt = false`. Now that the gateway demands a JWT the call is
  // credentialed, and the Fetch spec makes a browser REJECT a credentialed
  // response carrying a wildcard — opaquely, as "Failed to fetch" — so the
  // wildcard would have turned an authentication fix into a broken endpoint.
  //
  // `createCorsHeaders` is called rather than spread-and-overridden: it already
  // supplies Allow-Headers and Expose-Headers from the canonical lists in
  // `_shared/auth.ts`, and restating them here would pin this function to a
  // snapshot of those lists taken today. The lists it returns are supersets of
  // the three headers this file used to name, so nothing is narrowed.
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID || !DEFAULT_MAILBOX_EMAIL) {
      return new Response(JSON.stringify({ success: false, error: 'Microsoft credentials missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { limit = 25 } = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Use server-side RPC to find truncated rows efficiently (avoids
    // statement timeouts from paginating the whole table from the client).
    const { data: candidates, error: rpcErr } = await supabase
      .rpc('list_truncated_email_ids', { _limit: limit });
    if (rpcErr) throw rpcErr;

    const token = await getAccessToken();
    let updated = 0, missing = 0, errors = 0;

    for (const row of (candidates || [])) {
      try {
        const msg = await findMessageOnGraph(token, row.sender, row.received_at, row.subject);
        if (!msg) {
          // Mark as processed (empty string) so it stops blocking the queue.
          await supabase.from('email_copilot_emails').update({ body_html: '' }).eq('id', row.id);
          missing++;
          continue;
        }
        const rawHtml = msg.body?.contentType === 'html' ? (msg.body.content || '') : '';
        const text = rawHtml
          ? convertHtmlToStructuredText(rawHtml)
          : (msg.body?.content || '');
        const { error: upErr } = await supabase
          .from('email_copilot_emails')
          .update({
            body: (text || row.body).substring(0, 200000),
            body_html: rawHtml ? rawHtml.substring(0, 500000) : null,
          })
          .eq('id', row.id);
        if (upErr) { errors++; console.error('update', row.id, upErr); continue; }
        updated++;
      } catch (e) {
        errors++;
        console.error('row', row.id, e);
      }
    }

    const { count: remaining } = await supabase
      .from('email_copilot_emails')
      .select('id', { count: 'exact', head: true })
      .is('body_html', null);

    return new Response(JSON.stringify({
      success: true, scanned: (candidates || []).length, updated, missing, errors, remaining,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ...internalError(e, 'email-body-backfill'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
