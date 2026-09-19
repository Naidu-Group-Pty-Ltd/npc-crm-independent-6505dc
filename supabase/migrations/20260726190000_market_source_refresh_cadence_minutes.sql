-- Market Updates Phase 6: make refresh_frequency_minutes authoritative.

update public.market_sources
set refresh_frequency_minutes = greatest(15, least(10080,
  case
    when refresh_frequency_minutes is null then coalesce(refresh_frequency_hours, 1) * 60
    -- The original minutes column defaulted every legacy row to 60. Preserve an
    -- explicitly configured legacy hours value when that default is still present.
    when refresh_frequency_minutes = 60 and coalesce(refresh_frequency_hours, 1) <> 1 then refresh_frequency_hours * 60
    else refresh_frequency_minutes
  end
));

alter table public.market_sources
  alter column refresh_frequency_minutes set default 60,
  alter column refresh_frequency_minutes set not null;

alter table public.market_sources drop constraint if exists market_sources_refresh_frequency_minutes_check;
alter table public.market_sources add constraint market_sources_refresh_frequency_minutes_check
  check (refresh_frequency_minutes between 15 and 10080) not valid;
alter table public.market_sources validate constraint market_sources_refresh_frequency_minutes_check;

-- Compatibility only: old readers may continue displaying hours. Writers must use minutes.
create or replace function public.sync_market_source_legacy_refresh_hours()
returns trigger language plpgsql set search_path = public as $$
begin
  new.refresh_frequency_hours := greatest(1, ceil(new.refresh_frequency_minutes / 60.0)::integer);
  return new;
end;
$$;

drop trigger if exists sync_market_source_legacy_refresh_hours on public.market_sources;
create trigger sync_market_source_legacy_refresh_hours
before insert or update of refresh_frequency_minutes on public.market_sources
for each row execute function public.sync_market_source_legacy_refresh_hours();

update public.market_sources
set refresh_frequency_hours = greatest(1, ceil(refresh_frequency_minutes / 60.0)::integer);
