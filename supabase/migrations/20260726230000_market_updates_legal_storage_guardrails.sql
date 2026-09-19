-- Market Updates Phase 12: metadata/excerpt-only legal storage guardrails.
update public.market_updates set raw_excerpt=left(raw_excerpt,1200) where char_length(raw_excerpt)>1200;
update public.market_updates set public_excerpt=left(public_excerpt,1200) where char_length(public_excerpt)>1200;

alter table public.market_updates drop constraint if exists market_updates_raw_excerpt_length_check;
alter table public.market_updates add constraint market_updates_raw_excerpt_length_check
  check (raw_excerpt is null or char_length(raw_excerpt)<=1200) not valid;
alter table public.market_updates validate constraint market_updates_raw_excerpt_length_check;

alter table public.market_updates drop constraint if exists market_updates_public_excerpt_length_check;
alter table public.market_updates add constraint market_updates_public_excerpt_length_check
  check (public_excerpt is null or char_length(public_excerpt)<=1200) not valid;
alter table public.market_updates validate constraint market_updates_public_excerpt_length_check;

alter table public.market_sources add column if not exists legal_storage_policy text not null default 'metadata_excerpt_transformative_summary';
alter table public.market_sources drop constraint if exists market_sources_legal_storage_policy_check;
alter table public.market_sources add constraint market_sources_legal_storage_policy_check
  check (legal_storage_policy in ('link_metadata_only','metadata_excerpt_transformative_summary','licensed_metadata_excerpt_transformative_summary')) not valid;
alter table public.market_sources validate constraint market_sources_legal_storage_policy_check;

update public.market_sources set legal_storage_policy=case
  when copyright_mode like 'link_and_metadata_only%' then 'link_metadata_only'
  when adapter_type='licensed_partner_feed' then 'licensed_metadata_excerpt_transformative_summary'
  else 'metadata_excerpt_transformative_summary' end;
