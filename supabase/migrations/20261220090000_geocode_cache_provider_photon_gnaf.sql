-- The geocode cache may remember an answer from Photon, and from G-NAF.
--
-- On 24 Sep 2026 the public Nominatim began answering HTTP 403 to every
-- request from the production egress, and the chain — whose only street-level
-- provider it was — placed every property at its suburb's centroid. Photon (the
-- same OpenStreetMap data behind a different operator, or a copy this product
-- runs itself) is now the chain's second street-level provider, and G-NAF, the
-- national address register loaded into this project, is the next. Both write
-- their answers here, and this column's CHECK named only the three providers
-- that existed when the table was created, so every Photon answer would have
-- been refused at the insert — served once, never remembered, and asked for
-- again on every report continuation, which is the repeated identical query
-- the public services ask us never to send.
--
-- Widening a CHECK changes no row. The constraint is the inline column check
-- `geocode_cache_provider_check`; it is replaced, not dropped and left off.

alter table public.geocode_cache
  drop constraint if exists geocode_cache_provider_check;

alter table public.geocode_cache
  add constraint geocode_cache_provider_check
  check (provider in ('nominatim', 'photon', 'abs_locality', 'google', 'gnaf'));

comment on column public.geocode_cache.provider is
  'Who placed the address: nominatim or photon (OpenStreetMap, ODbL), gnaf (the national address register), abs_locality (the suburb centroid, ABS CC BY 4.0) or google.';
