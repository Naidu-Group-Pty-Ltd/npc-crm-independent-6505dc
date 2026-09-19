-- Portal push notifications, and one open door.
--
-- PUSH. `dispatch_web_push_for_portal_notification` handed `send-web-push` a
-- `client_portal_notifications.id` / `finance_portal_notifications.id`, and that
-- function looked the id up in `public.notifications`. It found nothing and
-- answered "No target" — every time, silently, for as long as the feature has
-- existed. Solicitors had no dispatcher at all.
--
-- `send-web-push` now takes a `source` naming which portal's table to read, so
-- this passes it and nothing else: the id and the source. Every user-visible
-- field is still derived server-side from the persisted row.
--
-- It also drops the hardcoded anon-key literal from the function body and
-- authenticates the way the rest of the project's database-to-function calls do.
--
-- RLS. `client_portal_notifications` carried
--   "Service role full access on portal notifications"  ALL  TO public  USING (true)
-- `TO public` includes `anon`. Combined with the table's anon grants that is not
-- "service role full access" — it is *everyone* full access, to every client's
-- notifications, including UPDATE and DELETE. The name says one thing and the
-- predicate does another. The finance and solicitor equivalents are already
-- correctly scoped to service_role; this brings the client portal in line.

-- ---------------------------------------------------------------- 1. dispatch

create or replace function public.dispatch_web_push_for_portal_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_url    text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/send-web-push';
  v_source text;
  v_secret text;
  v_body   jsonb;
begin
  v_source := case tg_table_name
    when 'client_portal_notifications'    then 'client_portal'
    when 'finance_portal_notifications'   then 'finance_portal'
    when 'solicitor_portal_notifications' then 'solicitor_portal'
    else null
  end;
  if v_source is null then
    return NEW;
  end if;

  -- Only the id and which table it lives in. `send-web-push` re-reads the
  -- title, body, link and audience itself, so this cannot drift from the
  -- schema the way the staff dispatcher did.
  v_body := jsonb_build_object('notification_id', NEW.id, 'source', v_source);

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'internal_edge_secret_v2' limit 1;
  if coalesce(length(v_secret), 0) < 16 then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'internal_edge_secret' limit 1;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := public.cron_signed_internal_headers(
      'POST', 'send-web-push', v_body, 'notifications_trigger',
      case
        when coalesce(length(v_secret), 0) >= 16
          then jsonb_build_object('x-internal-edge-secret', v_secret)
        else '{}'::jsonb
      end
    ),
    body    := v_body
  );
  return NEW;

exception when others then
  -- A push failure must never block the notification insert, but the previous
  -- bare handler is why nobody noticed this for the life of the feature.
  raise warning '[dispatch_web_push_for_portal_notification] % push skipped for %: %',
    coalesce(v_source, tg_table_name), NEW.id, sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_dispatch_web_push_client_portal on public.client_portal_notifications;
create trigger trg_dispatch_web_push_client_portal
  after insert on public.client_portal_notifications
  for each row execute function public.dispatch_web_push_for_portal_notification();

drop trigger if exists trg_dispatch_web_push_finance_portal on public.finance_portal_notifications;
create trigger trg_dispatch_web_push_finance_portal
  after insert on public.finance_portal_notifications
  for each row execute function public.dispatch_web_push_for_portal_notification();

-- Solicitors never had one.
drop trigger if exists trg_dispatch_web_push_solicitor_portal on public.solicitor_portal_notifications;
create trigger trg_dispatch_web_push_solicitor_portal
  after insert on public.solicitor_portal_notifications
  for each row execute function public.dispatch_web_push_for_portal_notification();

-- ---------------------------------------------------------------- 2. rls

drop policy if exists "Service role full access on portal notifications"
  on public.client_portal_notifications;

create policy client_portal_notifications_service_role_only
  on public.client_portal_notifications
  for all to service_role
  using (true) with check (true);

-- The portal browser reads its notifications through an edge function that
-- verifies the portal session; it has never needed table privileges, and with
-- the permissive policy gone these grants would only produce confusing errors.
revoke all on public.client_portal_notifications from anon, authenticated;

-- ---------------------------------------------------------------- 3. assertion
--
-- Same guard as the staff dispatcher: a trigger that reads a field its table
-- does not have fails the deploy instead of disappearing into a warning.

do $$
declare
  rec record;
  offenders text := '';
begin
  for rec in
    select c.relname as tbl, p.proname as fn,
           (regexp_matches(p.prosrc, 'NEW\.([a-zA-Z_][a-zA-Z0-9_]*)', 'g'))[1] as field
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_trigger t on t.tgfoid = p.oid
      join pg_class c on c.oid = t.tgrelid
     where n.nspname = 'public'
       and not t.tgisinternal
       and c.relname in ('client_portal_notifications', 'finance_portal_notifications',
                         'solicitor_portal_notifications')
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = rec.tbl and column_name = rec.field
    ) then
      offenders := offenders || format('%s.%s reads NEW.%s; ', rec.tbl, rec.fn, rec.field);
    end if;
  end loop;

  if offenders <> '' then
    raise exception 'portal notification trigger(s) read missing fields: %', offenders;
  end if;
end $$;
