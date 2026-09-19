-- Repair the notification producers.
--
-- Symptom: the bell showed almost nothing despite heavy use of the app.
--
-- Cause: `public.notifications` has exactly these columns —
--   id, type, title, message, report_id, timestamp, read, created_at,
--   entity_id, target_user_id, created_by
-- — but a large share of the producers write columns that were never added:
-- `metadata`, `link`, `is_read`, `user_id`, `body`. Postgres rejects an INSERT
-- naming an unknown column outright, so those producers have never delivered a
-- single notification. A census of the table proves it: of the ~55 types the UI
-- knows how to render, only 11 have EVER been written, and 94% of all rows come
-- from the two producers that happen to use the plain
-- (type, title, message, entity_id, read) shape.
--
-- Worse, five of the broken producers sit inside `EXCEPTION WHEN OTHERS`
-- blocks, so the failure was swallowed silently for months, and three had no
-- guard at all — meaning the *business* write failed too. Linking a purchase
-- file to a deal could not succeed at all, because its audit trigger inserts
-- into `notifications (user_id, ...)`.
--
-- Fix, in three parts:
--   1. Add the two columns the producers genuinely need (`metadata`, `link`).
--      This alone repairs every producer whose only sin was `metadata`,
--      including the four portal fan-out triggers, with no code change.
--   2. Rewrite the producers that used wrong *names* for columns that already
--      exist (`user_id` -> `target_user_id`, `body` -> `message`) — adding
--      duplicate columns for those would entrench the mistake.
--   3. Assert at deploy time that no producer references an unknown column, so
--      this class of silent breakage cannot come back.

-- ---------------------------------------------------------------- 1. Columns

alter table public.notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists link text;

comment on column public.notifications.metadata is
  'Producer-supplied context. `link_path`/`url` keys are used by the bell for deep-linking when a type has no explicit route.';
comment on column public.notifications.link is
  'Optional in-app path to open when the notification is clicked.';

-- Several producers de-duplicate with `metadata @> '{"message_id": "..."}'`
-- before inserting; that runs on every inbound portal message.
create index if not exists notifications_metadata_gin
  on public.notifications using gin (metadata jsonb_path_ops);

-- ---------------------------------------------------------------- 2. Producers

-- Lender submission status changes. Wrote (user_id, type, title, body, link,
-- metadata): three of those six columns do not exist. Already guarded, so the
-- submission itself saved and only the notification was lost.
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

      -- A submission with no broker and no creator has nobody to notify. A
      -- null target_user_id is a BROADCAST under this table's RLS, which would
      -- show every staff member another client's finance position.
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

-- Unconditional approval. Wrote (user_id, ...) with NO exception guard, so
-- setting a purchase file to unconditional_approval failed outright whenever an
-- NPC team member was assigned — the notification bug was blocking the deal.
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

-- Purchase-file / deal link audit. The worst of the set: it wrote four columns
-- that do not exist on `notifications` AND read four that do not exist on
-- `clients` (first_name, last_name, assigned_advisor_id, assigned_broker_id —
-- the real columns are primary_first_name, primary_surname,
-- assigned_team_user_id). With no exception guard, every INSERT into
-- purchase_file_deal_link_audit aborted, so linking a finance file to a deal
-- could never be recorded.
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
    -- An audit row must never fail because the bell could not be rung.
    RAISE WARNING '[notify_purchase_file_deal_link] notification skipped: %', SQLERRM;
  END;

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------- 3. Assertion
--
-- Every future migration that touches a notification producer runs this. If a
-- producer names a column `public.notifications` does not have, the deploy
-- fails loudly here instead of the notification disappearing in production.

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
