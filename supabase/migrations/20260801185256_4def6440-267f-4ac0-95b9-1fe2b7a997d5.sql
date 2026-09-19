-- ============================================================
-- 20260803010000_agent_rbac_revoke_anon_grants
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relname LIKE 'agent%'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- 20260803020000_repair_shared_rate_limit_and_circuit_primitives
-- ============================================================
CREATE OR REPLACE FUNCTION public.security_consume_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) RETURNS TABLE(allowed boolean, count integer, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  IF p_key !~ '^[a-z0-9:_./-]{1,200}$' OR p_max < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.auth_rate_limits AS limits (bucket_key, window_start, count, updated_at)
  VALUES (p_key, now(), 1, now())
  ON CONFLICT (bucket_key) DO UPDATE SET
    count = CASE WHEN limits.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1 ELSE limits.count + 1 END,
    window_start = CASE WHEN limits.window_start <= now() - make_interval(secs => p_window_seconds) THEN now() ELSE limits.window_start END,
    updated_at = now()
  RETURNING limits.count, limits.window_start INTO v_count, v_window_start;
  RETURN QUERY SELECT v_count <= p_max, v_count, GREATEST(p_max - v_count, 0),
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer);
END;
$$;
REVOKE ALL ON FUNCTION public.security_consume_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_consume_rate_limit(text,integer,integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.provider_circuit_state (
  scope text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  opened_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.provider_circuit_state TO service_role;
REVOKE ALL ON public.provider_circuit_state FROM anon, authenticated;
ALTER TABLE public.provider_circuit_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.provider_circuit_record_failure(p_scope text, p_threshold integer, p_open_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_failures integer; v_opened timestamptz;
BEGIN
  INSERT INTO public.provider_circuit_state(scope, failures, updated_at) VALUES (p_scope, 1, now())
  ON CONFLICT (scope) DO UPDATE SET failures = public.provider_circuit_state.failures + 1, updated_at = now()
  RETURNING failures, opened_until INTO v_failures, v_opened;
  IF v_failures >= p_threshold THEN
    UPDATE public.provider_circuit_state SET opened_until = now() + make_interval(secs => p_open_seconds), failures = 0 WHERE scope = p_scope;
    RETURN true;
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.provider_circuit_is_open(p_scope text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT opened_until > now() FROM public.provider_circuit_state WHERE scope = p_scope), false);
$$;

CREATE OR REPLACE FUNCTION public.provider_circuit_record_success(p_scope text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.provider_circuit_state WHERE scope = p_scope;
$$;

REVOKE ALL ON FUNCTION public.provider_circuit_record_failure(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_circuit_is_open(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_circuit_record_success(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_circuit_record_failure(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_circuit_is_open(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_circuit_record_success(text) TO service_role;

-- ============================================================
-- 20260803030000_repair_notification_producers
-- ============================================================
alter table public.notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists link text;

comment on column public.notifications.metadata is
  'Producer-supplied context. `link_path`/`url` keys are used by the bell for deep-linking when a type has no explicit route.';
comment on column public.notifications.link is
  'Optional in-app path to open when the notification is clicked.';

create index if not exists notifications_metadata_gin
  on public.notifications using gin (metadata jsonb_path_ops);

create or replace function public.fn_lender_submission_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_label TEXT;
  v_client_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    v_label := CASE NEW.status
      WHEN 'draft' THEN 'Submission drafted'
      WHEN 'pre_assessment' THEN 'Pre-assessment with lender'
      WHEN 'submitted' THEN 'Submitted to lender'
      WHEN 'conditional_approval' THEN 'Conditional approval received'
      WHEN 'unconditional_approval' THEN 'Unconditional approval received'
      WHEN 'loan_docs_issued' THEN 'Loan documents issued'
      WHEN 'settled' THEN 'Loan settled'
      WHEN 'declined' THEN 'Submission declined'
      WHEN 'withdrawn' THEN 'Submission withdrawn'
      ELSE NEW.status::text
    END;

    BEGIN
      INSERT INTO public.lender_submission_timeline (submission_id, event_type, event_label, actor_id, payload)
      VALUES (
        NEW.id,
        CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'status_change' END,
        v_label,
        COALESCE(NEW.assigned_broker_id, NEW.created_by),
        jsonb_build_object(
          'from', CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,
          'to', NEW.status::text,
          'lender_name', NEW.lender_name
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_lender_submission_status_change] timeline insert skipped: %', SQLERRM;
    END;

    BEGIN
      SELECT NULLIF(TRIM(CONCAT_WS(' ', primary_first_name, primary_surname)), '')
        INTO v_client_name
      FROM public.clients WHERE id = NEW.client_id;

      IF COALESCE(NEW.assigned_broker_id, NEW.created_by) IS NOT NULL THEN
        INSERT INTO public.notifications (target_user_id, type, title, message, link, metadata)
        VALUES (
          COALESCE(NEW.assigned_broker_id, NEW.created_by),
          'lender_submission_status',
          format('%s — %s', NEW.lender_name, v_label),
          format('%s submission for %s', NEW.lender_name, COALESCE(v_client_name, 'client')),
          format('/clients/%s?tab=submissions&highlight=%s', NEW.client_id, NEW.id),
          jsonb_build_object('submission_id', NEW.id, 'status', NEW.status::text)
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[fn_lender_submission_status_change] notification skipped: %', SQLERRM;
    END;
  END IF;

  RETURN NULL;
END $function$;

create or replace function public.notify_on_unconditional_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_team_user uuid;
BEGIN
  IF NEW.finance_status = 'unconditional_approval' AND OLD.finance_status IS DISTINCT FROM NEW.finance_status THEN
    v_team_user := NEW.assigned_team_user_id;
    IF v_team_user IS NOT NULL THEN
      BEGIN
        INSERT INTO public.notifications (target_user_id, type, title, message, link, metadata)
        VALUES (v_team_user, 'purchase_file_unconditional_approval',
          'Unconditional approval received',
          COALESCE(NEW.title, 'Purchase file') || ' is unconditionally approved.',
          '/finance-portal/purchase-files/' || NEW.id,
          jsonb_build_object('purchase_file_id', NEW.id, 'client_id', NEW.client_id, 'lender', NEW.lender));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[notify_on_unconditional_approval] notification skipped: %', SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

create or replace function public.notify_purchase_file_deal_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_client_name text;
  v_pf_address text;
  v_deal_address text;
  v_recipients uuid[];
BEGIN
  BEGIN
    SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.primary_first_name, c.primary_surname)), ''), 'Client')
      INTO v_client_name
    FROM public.clients c WHERE c.id = NEW.client_id;

    SELECT property_address INTO v_pf_address FROM public.purchase_files WHERE id = NEW.purchase_file_id;
    SELECT property_address INTO v_deal_address FROM public.client_deals  WHERE id = NEW.client_deal_id;

    SELECT ARRAY(
      SELECT DISTINCT u FROM unnest(ARRAY[
        NEW.actor_user_id,
        (SELECT assigned_team_user_id FROM public.clients WHERE id = NEW.client_id)
      ]) AS u
      WHERE u IS NOT NULL
    ) INTO v_recipients;

    IF v_recipients IS NOT NULL AND array_length(v_recipients, 1) > 0 THEN
      INSERT INTO public.notifications (target_user_id, type, title, message, link, metadata)
      SELECT
        r,
        CASE WHEN NEW.action = 'linked' THEN 'purchase_file_linked' ELSE 'purchase_file_unlinked' END,
        CASE WHEN NEW.action = 'linked'
             THEN 'Finance file linked to deal'
             ELSE 'Finance file unlinked from deal' END,
        v_client_name || ' — ' || COALESCE(v_pf_address, v_deal_address, 'property'),
        '/finance-portal/purchase-files/' || NEW.purchase_file_id,
        jsonb_build_object(
          'purchase_file_id', NEW.purchase_file_id,
          'client_deal_id',   NEW.client_deal_id,
          'client_id',        NEW.client_id,
          'source',           NEW.source
        )
      FROM unnest(v_recipients) AS r;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_purchase_file_deal_link] notification skipped: %', SQLERRM;
  END;

  RETURN NEW;
END $function$;

do $$
declare
  offenders text;
begin
  select string_agg(distinct proname || ' -> ' || col, ', ' order by proname || ' -> ' || col)
    into offenders
  from (
    select p.proname, btrim(c.col) as col
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (
      select regexp_matches(
        p.prosrc,
        'INSERT\s+INTO\s+(?:public\.)?notifications\s*\(([^)]*)\)',
        'gi'
      ) as parts
    ) m
    cross join lateral unnest(string_to_array(m.parts[1], ',')) as c(col)
    where n.nspname = 'public' and p.prokind = 'f'
  ) s
  where col <> ''
    and lower(col) not in (
      select lower(column_name)
      from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications'
    );

  if offenders is not null then
    raise exception
      'notification producers reference columns that do not exist on public.notifications: %',
      offenders;
  end if;
end $$;

-- ============================================================
-- 20260803040000_close_silent_anon_and_record_webhook_rejections
-- ============================================================
revoke all on public.notifications from anon;
revoke all on public.vapi_call_logs from anon;

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

drop policy if exists webhook_rejections_select_authenticated on public.webhook_rejections;
create policy webhook_rejections_select_authenticated
  on public.webhook_rejections for select to authenticated using (true);

revoke all on public.webhook_rejections from anon;
grant select on public.webhook_rejections to authenticated;
grant all on public.webhook_rejections to service_role;

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
  raise warning '[record_webhook_rejection] %', sqlerrm;
end $function$;

revoke all on function public.record_webhook_rejection(text, text) from public, anon;
grant execute on function public.record_webhook_rejection(text, text) to service_role;

-- ============================================================
-- 20260803050000_repair_staff_push_dispatch
-- ============================================================
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
  if NEW.target_user_id is null then
    return NEW;
  end if;

  v_body := jsonb_build_object('notification_id', NEW.id);

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'internal_edge_secret_v2' limit 1;
  if coalesce(length(v_secret), 0) < 16 then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'internal_edge_secret' limit 1;
  end if;

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
  raise warning '[dispatch_web_push_on_notification] push dispatch skipped for %: %', NEW.id, sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_dispatch_web_push on public.notifications;
create trigger trg_dispatch_web_push
  after insert on public.notifications
  for each row execute function public.dispatch_web_push_on_notification();

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

-- ============================================================
-- 20260803060000_portal_push_dispatch_and_rls
-- ============================================================
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

drop trigger if exists trg_dispatch_web_push_solicitor_portal on public.solicitor_portal_notifications;
create trigger trg_dispatch_web_push_solicitor_portal
  after insert on public.solicitor_portal_notifications
  for each row execute function public.dispatch_web_push_for_portal_notification();

drop policy if exists "Service role full access on portal notifications"
  on public.client_portal_notifications;

create policy client_portal_notifications_service_role_only
  on public.client_portal_notifications
  for all to service_role
  using (true) with check (true);

revoke all on public.client_portal_notifications from anon;

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