-- Two silent failures, same shape: something stopped working and nothing said so.
--
-- 1. THE BELL. Every `notifications` policy is `TO authenticated`, but `anon`
--    still held SELECT/INSERT/UPDATE/DELETE/TRUNCATE. RLS is additive over
--    GRANTs, so an anon-key request is not rejected — Postgres matches no policy
--    and PostgREST answers `200 []`. When the browser's self-minted Supabase JWT
--    went missing, the client fell back to the anon key and the bell silently
--    showed nothing, while the same query as the signed-in user returned 50
--    unread rows.
--
--    Evidence this had been true for a month: of the ~2,000 notifications
--    written since 3 July, NOT ONE has ever been marked read. Before 2 July the
--    marking worked (65/65 on 1 July, 19/19 on 30 June). `markAsRead` under anon
--    is a silent no-op — the UPDATE matches no policy and affects zero rows.
--
--    Revoking anon does not take anything away: anon could never read a row.
--    It changes the failure from an empty 200 into an explicit denial, which is
--    the difference between "you have no notifications" and "something is wrong".
--    The bell no longer depends on this path at all — it reads through
--    `notifications-feed`, authenticated by the staff session cookie.
--
-- 2. THE CALL LOGS. `vapi-call-webhook` fails closed on VAPI_WEBHOOK_SECRET and
--    has answered 401 to every inbound call webhook since 22 July, logging one
--    `console.warn` and nothing else. Confirmed live: an unauthenticated POST to
--    the deployed function returns `401 {"error":"Unauthorized webhook request"}`.
--    Failing closed is correct. Failing closed in silence for six weeks is not.

-- ---------------------------------------------------------------- 1. anon

revoke all on public.notifications from anon;

-- vapi_call_logs has the same shape: policies are TO authenticated, but anon
-- holds full DML. Nothing reads it as anon (the Call Logs page goes through an
-- edge function), so this only removes a privilege that should never have been
-- granted and makes any accidental anon read fail loudly.
revoke all on public.vapi_call_logs from anon;

-- ---------------------------------------------------------------- 2. rejections

create table if not exists public.webhook_rejections (
  function_name text not null,
  hour_bucket   timestamptz not null,
  reason        text not null,
  attempts      bigint not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (function_name, hour_bucket, reason)
);

comment on table public.webhook_rejections is
  'Counts inbound webhooks refused at the door, bucketed by hour. An integration that stops delivering (wrong/absent shared secret) is otherwise invisible: the caller sees a 401 and nobody here sees anything.';

alter table public.webhook_rejections enable row level security;

-- Staff read it; nothing writes through PostgREST. The recorder below is
-- SECURITY DEFINER so an unauthenticated webhook can bump a counter without
-- holding any table privilege.
drop policy if exists webhook_rejections_select_authenticated on public.webhook_rejections;
create policy webhook_rejections_select_authenticated
  on public.webhook_rejections for select to authenticated using (true);

revoke all on public.webhook_rejections from anon;
grant select on public.webhook_rejections to authenticated;

/**
 * Record one refused webhook. Deliberately takes no caller-controlled payload
 * beyond a short reason slug — this is reachable from an unauthenticated
 * request, so it must not become a write primitive. Bucketing by hour bounds
 * the row count no matter how hard a caller retries.
 */
create or replace function public.record_webhook_rejection(
  p_function_name text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fn text := left(regexp_replace(coalesce(p_function_name, 'unknown'), '[^a-zA-Z0-9_-]', '', 'g'), 64);
  v_reason text := left(regexp_replace(coalesce(p_reason, 'unknown'), '[^a-zA-Z0-9_-]', '', 'g'), 64);
begin
  if v_fn = '' then v_fn := 'unknown'; end if;
  if v_reason = '' then v_reason := 'unknown'; end if;

  insert into public.webhook_rejections (function_name, hour_bucket, reason, attempts)
  values (v_fn, date_trunc('hour', now()), v_reason, 1)
  on conflict (function_name, hour_bucket, reason) do update
    set attempts = public.webhook_rejections.attempts + 1,
        last_seen_at = now();
exception when others then
  -- Diagnostics must never be able to fail the thing they are diagnosing.
  raise warning '[record_webhook_rejection] %', sqlerrm;
end $function$;

revoke all on function public.record_webhook_rejection(text, text) from public, anon;
grant execute on function public.record_webhook_rejection(text, text) to service_role;
