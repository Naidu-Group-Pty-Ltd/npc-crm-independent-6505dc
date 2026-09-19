-- Market Updates Phase 2: reconcile legacy source rows into the approved
-- 20-key canonical registry without deleting source history.

alter table public.market_sources
  add column if not exists registry_status text,
  add column if not exists superseded_by_source_id uuid,
  add column if not exists archived_at timestamptz,
  add column if not exists reconciliation_reason text;

-- Future ad-hoc rows must be reviewed before they can enter the ingestion set.
alter table public.market_sources
  alter column registry_status set default 'unresolved_legacy';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_sources'::regclass
      and conname = 'market_sources_superseded_by_source_id_fkey'
  ) then
    alter table public.market_sources
      add constraint market_sources_superseded_by_source_id_fkey
      foreign key (superseded_by_source_id)
      references public.market_sources(id) on delete restrict;
  end if;
end $$;

alter table public.market_sources
  drop constraint if exists market_sources_registry_status_check;
alter table public.market_sources
  add constraint market_sources_registry_status_check
  check (registry_status in ('canonical', 'archived_legacy', 'unresolved_legacy'))
  not valid;

create table if not exists public.market_source_reconciliation_audits (
  id uuid primary key default gen_random_uuid(),
  reconciliation_key text not null unique,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  starting_count integer not null default 0,
  canonical_count integer not null default 0,
  enabled_canonical_count integer not null default 0,
  disabled_canonical_count integer not null default 0,
  matched_legacy_rows integer not null default 0,
  merged_rows integer not null default 0,
  archived_rows integer not null default 0,
  unresolved_rows integer not null default 0,
  update_references_reassigned integer not null default 0,
  fetch_run_references_reassigned integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.market_source_reconciliation_audits enable row level security;
revoke all on public.market_source_reconciliation_audits from public, anon, authenticated;
grant all on public.market_source_reconciliation_audits to service_role;

create unique index if not exists market_sources_one_active_canonical_key
  on public.market_sources(source_key)
  where registry_status = 'canonical';
create index if not exists market_sources_registry_status_idx
  on public.market_sources(registry_status, enabled, name);
create index if not exists market_sources_superseded_by_idx
  on public.market_sources(superseded_by_source_id)
  where superseded_by_source_id is not null;

do $$
declare
  approved_keys constant text[] := array[
    'cotality_australia', 'proptrack_rea', 'abc_business',
    'reuters_australia', 'domain_research', 'broker_daily',
    'urban_developer', 'mortgage_professional_australia',
    'guardian_australia', 'property_council_australia',
    'parliament_australia', 'federal_register_legislation',
    'the_adviser_australia', 'mfaa', 'australian_banking_association',
    'austrac', 'allens_legal_insights', 'afca',
    'banking_code_compliance_committee', 'fbaa'
  ];
  v_starting_count integer;
  v_canonical_count integer;
  v_enabled_canonical integer;
  v_matched integer;
  v_archived integer;
  v_unresolved integer;
  v_update_refs integer := 0;
  v_fetch_refs integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('market-source-registry-reconciliation-v2'));

  select count(*) into v_starting_count from public.market_sources;

  -- Rows with an approved stable key are authoritative. Existing administrator
  -- enablement and health configuration is deliberately not overwritten.
  update public.market_sources
  set registry_status = 'canonical',
      superseded_by_source_id = null,
      archived_at = null,
      reconciliation_reason = 'approved_source_key',
      updated_at = now()
  where source_key = any(approved_keys);

  if (select count(*) from public.market_sources where registry_status = 'canonical')
     <> cardinality(approved_keys) then
    raise exception 'Canonical Market Updates registry is incomplete; apply the Phase 1 recovery migration first';
  end if;

  create temporary table market_source_safe_matches on commit drop as
  with source_urls as (
    select s.id,
      regexp_replace(
        regexp_replace(lower(trim(u.value)), '^https?://(www\.)?', ''),
        '([?#].*)?/*$', ''
      ) as normalized_url
    from public.market_sources s
    cross join lateral (
      select s.url::text as value
      union all select s.primary_url::text
      union all select jsonb_array_elements_text(coalesce(s.feed_urls, '[]'::jsonb))
      union all select jsonb_array_elements_text(coalesce(s.listing_urls, '[]'::jsonb))
    ) u
    where u.value is not null and trim(u.value) <> ''
  ),
  candidates as (
    select l.id as legacy_id, c.id as canonical_id, 1 as priority, 'source_key'::text as reason
    from public.market_sources l
    join public.market_sources c on c.registry_status = 'canonical'
      and l.source_key = c.source_key
    where l.id <> c.id and l.registry_status is distinct from 'canonical'

    union all

    select l.id, c.id, 2, 'normalised_url'
    from public.market_sources l
    join source_urls lu on lu.id = l.id
    join source_urls cu on cu.normalized_url = lu.normalized_url
    join public.market_sources c on c.id = cu.id and c.registry_status = 'canonical'
    where l.registry_status is distinct from 'canonical' and lu.normalized_url <> ''

    union all

    select l.id, c.id, 3, 'normalised_name'
    from public.market_sources l
    join public.market_sources c on c.registry_status = 'canonical'
      and regexp_replace(lower(trim(l.name)), '[^a-z0-9]+', '', 'g') =
          regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g')
    where l.registry_status is distinct from 'canonical' and trim(l.name) <> ''
  ),
  unambiguous as (
    select legacy_id
    from candidates
    group by legacy_id
    having count(distinct canonical_id) = 1
  )
  select c.legacy_id,
         min(c.canonical_id::text)::uuid as canonical_id,
         (array_agg(c.reason order by c.priority, c.reason))[1] as reason
  from candidates c
  join unambiguous u using (legacy_id)
  group by c.legacy_id;

  select count(*) into v_matched from market_source_safe_matches;

  update public.market_updates u
  set source_id = m.canonical_id,
      source_name = c.name,
      updated_at = now()
  from market_source_safe_matches m
  join public.market_sources c on c.id = m.canonical_id
  where u.source_id = m.legacy_id;
  get diagnostics v_update_refs = row_count;

  -- Fetch records remain intact; only their source foreign key is redirected to
  -- the deterministic canonical row so source-level history stays queryable.
  update public.market_source_fetch_runs f
  set source_id = m.canonical_id
  from market_source_safe_matches m
  where f.source_id = m.legacy_id;
  get diagnostics v_fetch_refs = row_count;

  update public.market_sources l
  set registry_status = 'archived_legacy',
      superseded_by_source_id = m.canonical_id,
      archived_at = coalesce(l.archived_at, now()),
      reconciliation_reason = 'matched_by_' || m.reason,
      enabled = false,
      health_status = 'disabled',
      disabled_reason = coalesce(l.disabled_reason, 'Superseded by an approved canonical Market Updates source.'),
      updated_at = now()
  from market_source_safe_matches m
  where l.id = m.legacy_id;
  get diagnostics v_archived = row_count;

  -- Ambiguous and unmatched records are retained for manual review and disabled
  -- so they cannot continue duplicating ingestion while unresolved.
  update public.market_sources l
  set registry_status = 'unresolved_legacy',
      superseded_by_source_id = null,
      archived_at = null,
      reconciliation_reason = case
        when exists (
          select 1
          from public.market_sources c
          where c.registry_status = 'canonical'
            and regexp_replace(lower(trim(l.name)), '[^a-z0-9]+', '', 'g') =
                regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g')
        ) then 'ambiguous_match_requires_review'
        else 'no_deterministic_canonical_match'
      end,
      enabled = false,
      health_status = 'disabled',
      disabled_reason = coalesce(l.disabled_reason, 'Legacy source requires canonical-registry review.'),
      updated_at = now()
  where l.registry_status is distinct from 'canonical'
    and not exists (
      select 1 from market_source_safe_matches m where m.legacy_id = l.id
    );

  select count(*) into v_canonical_count
  from public.market_sources where registry_status = 'canonical';
  select count(*) into v_enabled_canonical
  from public.market_sources where registry_status = 'canonical' and enabled;
  select count(*) into v_unresolved
  from public.market_sources where registry_status = 'unresolved_legacy';

  insert into public.market_source_reconciliation_audits (
    reconciliation_key, started_at, completed_at, starting_count,
    canonical_count, enabled_canonical_count, disabled_canonical_count,
    matched_legacy_rows, merged_rows, archived_rows, unresolved_rows,
    update_references_reassigned, fetch_run_references_reassigned, metadata
  ) values (
    'approved-australian-registry-v2', now(), now(), v_starting_count,
    v_canonical_count, v_enabled_canonical, v_canonical_count - v_enabled_canonical,
    v_matched, v_matched, v_archived, v_unresolved,
    v_update_refs, v_fetch_refs,
    jsonb_build_object('approved_source_keys', approved_keys, 'strategy_version', 2)
  )
  on conflict (reconciliation_key) do update set
    completed_at = excluded.completed_at,
    starting_count = excluded.starting_count,
    canonical_count = excluded.canonical_count,
    enabled_canonical_count = excluded.enabled_canonical_count,
    disabled_canonical_count = excluded.disabled_canonical_count,
    matched_legacy_rows = excluded.matched_legacy_rows,
    merged_rows = excluded.merged_rows,
    archived_rows = excluded.archived_rows,
    unresolved_rows = excluded.unresolved_rows,
    update_references_reassigned = excluded.update_references_reassigned,
    fetch_run_references_reassigned = excluded.fetch_run_references_reassigned,
    metadata = excluded.metadata;
end $$;

alter table public.market_sources validate constraint market_sources_registry_status_check;
