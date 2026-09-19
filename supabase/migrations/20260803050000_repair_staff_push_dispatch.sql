-- Staff push notifications have never fired. Not once.
--
-- `trg_dispatch_web_push` has been on `public.notifications` the whole time, and
-- the function behind it opens with:
--
--     IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
--     ... 'url', NEW.link_url, 'category', NEW.category
--
-- `public.notifications` has no `user_id`, no `link_url` and no `category` —
-- those are the CLIENT PORTAL notification columns. The function was written
-- against the portal schema and attached to the staff table. plpgsql resolves
-- record fields at runtime, so the very first statement raises, and the whole
-- body is wrapped in a bare `EXCEPTION WHEN OTHERS THEN RETURN NEW` that
-- discards it. Every insert took that path, silently, forever.
--
-- Two further breaks behind it:
--
--   * The old trigger authenticated to `send-web-push` with nothing but
--     `Authorization: Bearer <anon key>`, hardcoded as a literal in the function
--     body. `send-web-push` requires `x-internal-edge-secret`, so even a
--     well-formed call would have been refused 401.
--
--   * `send-web-push` reads `metadata.link_path` off the notification row, and
--     `notifications.metadata` did not exist until 20260803030000.
--
-- This rewrites the dispatcher against the real schema, authenticates the way
-- every other database-to-function call in this project does, stops pretending
-- a failure is a success, and drops the hardcoded key literal.

create or replace function public.dispatch_web_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_url     text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/send-web-push';
  v_secret  text;
  v_body    jsonb;
  v_headers jsonb;
begin
  -- A null target is a broadcast; there is no single device set to wake. The
  -- bell still shows it. (send-web-push would answer "No target" anyway — this
  -- just avoids the round trip on every broadcast row.)
  if NEW.target_user_id is null then
    return NEW;
  end if;

  -- Send ONLY the id. `send-web-push` re-reads title, body, link and audience
  -- from the persisted row, so nothing about the payload is caller-supplied and
  -- the trigger cannot drift from the schema again.
  v_body := jsonb_build_object('notification_id', NEW.id);

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'internal_edge_secret_v2' limit 1;
  if coalesce(length(v_secret), 0) < 16 then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'internal_edge_secret' limit 1;
  end if;

  -- `cron_signed_internal_headers` supplies gateway auth plus the HMAC-signed
  -- internal headers used by every pg_cron dispatch here. The plain
  -- `x-internal-edge-secret` is added alongside because send-web-push checks
  -- that specific header; sending both means the call is accepted whichever
  -- scheme that function is verifying, and both are fail-closed.
  v_headers := public.cron_signed_internal_headers(
    'POST',
    'send-web-push',
    v_body,
    'notifications_trigger',
    case
      when coalesce(length(v_secret), 0) >= 16
        then jsonb_build_object('x-internal-edge-secret', v_secret)
      else '{}'::jsonb
    end
  );

  perform net.http_post(url := v_url, headers := v_headers, body := v_body);
  return NEW;

exception when others then
  -- A push failure must never block the notification insert. But the old code
  -- returned silently, which is how this went unnoticed since the feature
  -- shipped. Warn, so the next person sees it in the Postgres log.
  raise warning '[dispatch_web_push_on_notification] push dispatch skipped for %: %', NEW.id, sqlerrm;
  return NEW;
end;
$function$;

-- The trigger already exists; recreate it idempotently so a fresh clone gets it
-- and so the AFTER INSERT timing is explicit.
drop trigger if exists trg_dispatch_web_push on public.notifications;
create trigger trg_dispatch_web_push
  after insert on public.notifications
  for each row execute function public.dispatch_web_push_on_notification();

-- ---------------------------------------------------------------- assertion
--
-- The defect class here is a trigger naming columns its table does not have.
-- 20260803030000 added this check for INSERT column lists; the same mistake in
-- a READ (`NEW.user_id`) is what broke push, so assert those too.

do $$
declare
  offenders text;
  real_cols text[];
begin
  select array_agg(column_name::text) into real_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications';

  select string_agg(distinct field, ', ' order by field) into offenders
  from (
    select (regexp_matches(p.prosrc, 'NEW\.([a-zA-Z_][a-zA-Z0-9_]*)', 'g'))[1] as field
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_trigger t on t.tgfoid = p.oid
    join pg_class c on c.oid = t.tgrelid
    where n.nspname = 'public'
      and not t.tgisinternal
      and c.relname = 'notifications'
  ) s
  where field <> all (real_cols);

  if offenders is not null then
    raise exception
      'trigger(s) on public.notifications read fields that do not exist: %', offenders;
  end if;
end $$;
