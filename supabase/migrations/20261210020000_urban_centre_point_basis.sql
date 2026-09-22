-- @effect: select 1 from pg_constraint where conname = 'urban_centre_register_point_basis_check' and pg_get_constraintdef(oid) like '%sua_boundary_centroid%'
-- The line above is this file's own statement of what is true once it has
-- run. It exists because this migration creates no object, so
-- `scripts/ops/migration-drift.mjs` has nothing to count and would report
-- it as unverifiable — which is exactly how seed v18 merged to main, never
-- landed, and left every report printing the heading it was written to fix.
-- Read-only by construction: the runner refuses anything that is not a
-- lone SELECT.
-- A point basis must name the instrument, not borrow a word from a service
-- that declined to supply one.
--
-- Measured against the live ABS SUA layer on 20 Sep 2026: it IGNORES
-- `returnCentroid=true` (features return `attributes` and nothing else), its
-- `advancedQueryCapabilities` does not advertise
-- `supportsReturningGeometryCentroid`, and its published fields are
-- `objectid, shape, sua_code_2021, sua_name_2021, aus_code_2021,
-- aus_name_2021, area_albers_sqkm, asgs_loci_uri_2021` — no latitude, no
-- longitude, no point of any kind.
--
-- So the register's point is the area-weighted centre of the publisher's own
-- generalised boundary, computed by `pointFromRings`. That is OUR arithmetic
-- over THEIR geometry, and `sua_boundary_centroid` says so where
-- `sua_centroid` would have implied the ABS had published it.
--
-- Additive: the two existing values stay legal, so nothing already written
-- becomes invalid and the constraint can be applied before or after a load.

alter table public.urban_centre_register
  drop constraint if exists urban_centre_register_point_basis_check;

alter table public.urban_centre_register
  add constraint urban_centre_register_point_basis_check
  check (point_basis in ('capital_cbd', 'sua_centroid', 'sua_boundary_centroid'));
