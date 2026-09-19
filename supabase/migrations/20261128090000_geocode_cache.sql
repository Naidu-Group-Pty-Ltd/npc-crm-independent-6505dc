-- The geocode cache: every server-side geocode goes through one chain of
-- providers (`_shared/geocode/geocoder.ts`), and this is the provider in
-- front of them all.
--
-- Google's Geocoding API refused every request from 12 Sep 2026 and the
-- product must not depend on its console or its charges. The chain asks
-- OpenStreetMap's Nominatim, then the ABS boundary server, and Google only
-- where an operator lists it. OpenStreetMap's usage policy requires that
-- results be cached, the listings sweep re-asks the same addresses daily,
-- and every allowance holds only if a repeat costs nothing — so a resolved
-- address is written here once and read from here after.
--
-- Service-role only: RLS is on and no policy is written, because no browser
-- reads this table — the edge functions do, on the caller's behalf.

create table if not exists public.geocode_cache (
  address_key text primary key,
  query text not null,
  lat double precision not null,
  lng double precision not null,
  precision text not null check (precision in ('address', 'street', 'locality', 'postcode')),
  types text[] not null default '{}',
  provider_precision text,
  suburb text,
  state text,
  postcode text,
  lga text,
  lga_code text,
  matched_address text,
  provider text not null check (provider in ('nominatim', 'abs_locality', 'google')),
  attribution text not null,
  resolved_at timestamptz not null default now(),
  hit_count integer not null default 0,
  last_hit_at timestamptz
);

comment on table public.geocode_cache is
  'Resolved geocodes, keyed by the folded address text. The first provider in the geocoding chain; written by the chain, read by every server-side geocode.';
comment on column public.geocode_cache.precision is
  'How finely the provider placed the address: address (the property), street, locality (the suburb centroid), postcode.';
comment on column public.geocode_cache.attribution is
  'The licence line the coordinate travels under (OpenStreetMap ODbL, ABS CC BY 4.0, or Google).';

create index if not exists geocode_cache_resolved_at_idx on public.geocode_cache (resolved_at);

alter table public.geocode_cache enable row level security;

-- Telemetry, never a reason to wait: the chain calls this fire-and-forget on a hit.
create or replace function public.geocode_cache_touch(p_key text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.geocode_cache
     set hit_count = hit_count + 1, last_hit_at = now()
   where address_key = p_key;
$$;

revoke all on function public.geocode_cache_touch(text) from public;
grant execute on function public.geocode_cache_touch(text) to service_role;
