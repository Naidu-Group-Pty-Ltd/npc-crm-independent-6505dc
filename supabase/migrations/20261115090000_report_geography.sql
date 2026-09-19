-- ME-5 — canonical geography, derived from the report's own coordinate.
--
-- WHY THIS IS A SEPARATE TABLE
--
-- ME-4 measured that suburb, postcode and state are stored on 0 of 1,204
-- historical reports while coordinates are present on 1,113, so a licensed
-- suburb-grain dataset cannot be joined to the corpus at all. That is fixed by
-- DERIVING the geography, not by editing history: `investment_reports` keeps
-- exactly the bytes it was written with, and the coordinate remains the source
-- fact. This table holds the derived fact beside it, versioned, with the
-- boundary release and method that produced it.
--
-- Resolution is point-in-polygon against the ABS ASGS 2021 boundaries the ABS
-- itself publishes statistics against — deterministic, reproducible and
-- auditable. The free-text address is never consulted; ADDRESS_COMPOSITION.md
-- records why it cannot prove a suburb.

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_geography (
  report_id           uuid PRIMARY KEY REFERENCES public.investment_reports(id) ON DELETE CASCADE,

  -- The source fact, echoed so the row is self-contained and auditable.
  latitude            double precision,
  longitude           double precision,

  -- The derived chain.
  suburb              text,
  locality_code       text,
  postcode            text,
  state               text,
  sa2_code            text,
  sa2_name            text,
  sa3_name            text,
  sa4_name            text,
  gccsa_name          text,
  remoteness_area     text,
  urban_centre        text,
  significant_urban_area text,

  -- How it was produced, so a resolution can be reproduced or superseded.
  method              text NOT NULL,
  boundary_source     text NOT NULL,
  source_version      text NOT NULL,

  -- What the resolver thought of it. Four states, because "could not place"
  -- and "placed but look at it" send an operator to different actions.
  status              text NOT NULL,
  flags               text[] NOT NULL DEFAULT '{}',
  notes               jsonb  NOT NULL DEFAULT '[]'::jsonb,

  -- Independent human confirmation, for the stratified validation sample.
  validation_status   text,
  validated_at        timestamptz,

  resolved_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_geography_status_check
    CHECK (status IN ('resolved','resolved_with_warning','requires_review','unresolved')),
  CONSTRAINT report_geography_method_check
    CHECK (method IN ('asgs_point_in_polygon','none')),
  CONSTRAINT report_geography_validation_check
    CHECK (validation_status IS NULL
           OR validation_status IN ('confirmed','contradicted','inconclusive')),
  -- A resolved row must actually name a place. This is the "coverage is not
  -- the objective" rule as a constraint: a status of `resolved` that carries
  -- no suburb cannot be written at all.
  CONSTRAINT report_geography_resolved_has_place
    CHECK (status = 'unresolved' OR (suburb IS NOT NULL AND locality_code IS NOT NULL))
);

COMMENT ON TABLE public.report_geography IS
  'Canonical geography derived from a report coordinate by ABS ASGS point-in-polygon. '
  'Derived fact — the coordinate on investment_reports remains the source fact, and no '
  'historical report is mutated to produce this.';
COMMENT ON COLUMN public.report_geography.status IS
  'resolved | resolved_with_warning | requires_review | unresolved. An uncertain coordinate '
  'is left unplaced rather than forced into a suburb.';
COMMENT ON COLUMN public.report_geography.flags IS
  'Every disagreement found: near_locality_boundary, suburb_postcode_mismatch, state_mismatch, '
  'outside_australia, outside_all_polygons, invalid_coordinate, missing_coordinate, '
  'suburb_not_in_directory, boundary_service_unavailable.';

CREATE INDEX IF NOT EXISTS report_geography_suburb_state_idx
  ON public.report_geography (state, suburb);
CREATE INDEX IF NOT EXISTS report_geography_sa2_idx
  ON public.report_geography (sa2_code);
CREATE INDEX IF NOT EXISTS report_geography_status_idx
  ON public.report_geography (status);

ALTER TABLE public.report_geography ENABLE ROW LEVEL SECURITY;

-- Read follows the report: whoever may see the report may see where it is.
CREATE POLICY "Geography is readable by whoever may read the report"
  ON public.report_geography FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.investment_reports r
      WHERE r.id = report_geography.report_id
        AND r.generated_by = auth.uid()
    )
  );

-- Writes are the resolver's alone. No client-side role may derive geography:
-- a derived fact whose provenance anyone can overwrite is not a derived fact.
REVOKE ALL ON public.report_geography FROM anon, authenticated;
GRANT SELECT ON public.report_geography TO authenticated;

COMMIT;
