-- Purge the fabricated rows from the external-source caches.
--
-- Four data services (abs-data, climate-data, crime-statistics,
-- public-transport) answered every cache miss by INVENTING data — invented
-- demographic profiles with random jitter, one climate per state, offence
-- counts from postcode bands, and a hard-coded landmark stop list per state —
-- then cached the invention for 30–365 days and served it back as a cache
-- hit. Measured on 2026-09-06, immediately before this migration was written:
--
--     abs_census_cache          123 rows   100% data_quality = 'estimated'
--     climate_data_cache      1,237 rows   100% 'estimated'
--     crime_statistics_cache    140 rows   100% 'estimated'
--     transport_data_cache      639 rows   100% 'estimated'
--
-- Not one live row has ever been written to any of the four, because none of
-- these services ever completed a real fetch. Every row below is fabricated.
--
-- The generators are deleted in the same change, and each service now reads
-- its cache with `data_quality = 'live'` only (or not at all), so a straggler
-- row written by a not-yet-redeployed old revision cannot be served either.
-- The delete is still filtered on 'estimated' rather than unconditional, so
-- that if a real integration lands between authoring and applying this, its
-- rows survive.
--
-- Stored reports are deliberately NOT touched: what was issued is a retained
-- record, and repairing delivered documents is a separate, explicit decision.

delete from public.abs_census_cache       where data_quality = 'estimated';
delete from public.climate_data_cache     where data_quality = 'estimated';
delete from public.crime_statistics_cache where data_quality = 'estimated';
delete from public.transport_data_cache   where data_quality = 'estimated';
