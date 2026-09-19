-- ME-5 item 6 — provenance for the stored Location intelligence.
--
-- WHY THIS IS A SEPARATE TABLE, AND WHY IT IS NOT A DELETION
--
-- The audit's Section 24 named one contaminated field, `distanceToStop`. A
-- full sweep of the 1,114 stored `location_intelligence` objects found the
-- contamination runs through the whole object, in kinds that need different
-- remedies:
--
--   * 1,108 carry a per-state TEMPLATE for the entire transport block —
--     `stopsWithin1km` takes one value across all of them, and `nearestStop`,
--     `distanceToStop`, `qualityScore`, `serviceFrequency`, `routeCoverage`
--     and `summary` take five. 822 name Sydney's "Central Station" 450 m away
--     and span all eight states and territories.
--   * The walk score inherits it: up to 30 of its 100 points ARE that
--     constant, and 641 objects whose other four components all saturate carry
--     four distinct walk scores between them.
--   * 494 non-NSW reports carry a real transit query sent to SYDNEY, because
--     `getCBDCoordinates` ends `|| cbdLocations['NSW']`. All 494 land in the
--     Location score's "Limited CBD access (>60 min)" band for 3 points of 30
--     — and 74 of them are within 10 km of their own CBD, the closest 0.4 km.
--   * 438 commutes were never a route at all: when the Distance Matrix call
--     fails, `calculateCommuteTime` falls through to a straight-line distance
--     times 1.5 minutes per kilometre and stores `mode: 'estimated'`. Their
--     mean is 10,125 minutes. `commute.mode` is the only thing that tells the
--     two apart, so it is load-bearing rather than descriptive.
--   * Every "within N km" count is `min(actual, 10)`: `fetchNearbyPlaces`
--     slices the first Places page and returns its length.
--   * A failed read is stored as an empty area — the fetch helper's catch
--     returns `{ count: 0 }`, which becomes `nearest*: 'N/A'`, `distance*: 0`.
--   * 183 objects measure a location outside Australia.
--
-- A template can only be discarded; a misdirected measurement can be RECOMPUTED
-- from the coordinate already stored. Collapsing the two would throw away 494
-- recoverable commutes, so the classification keeps them apart.
--
-- Nothing here rewrites an issued report or edits `location_intelligence`.
-- The stored object keeps exactly the bytes it was written with; this table
-- records what those bytes are, beside them, versioned.
--
-- Measured over all 1,114: only THREE carry both a measured walk score and a
-- measured commute.
--
-- The templated transport writer was removed on 2026-09-06 and reports since
-- take the coordinate-measured branch. This table is about what is already
-- stored; the two faults that survive in the live writer (the Sydney default
-- and the straight-line estimate) are fixed separately.

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_location_provenance (
  report_id             uuid PRIMARY KEY REFERENCES public.investment_reports(id) ON DELETE CASCADE,

  -- Which writer produced the stored object, decided by SHAPE. Both branches
  -- were live at once — the Google branch answered whenever the transport
  -- service refused — so a creation date does not decide which a row got.
  transport_shape       text NOT NULL
    CHECK (transport_shape IN ('state_template', 'places_measured', 'absent')),

  -- The scored figure, called out because it is what reaches a grade.
  walk_score_provenance text NOT NULL,
  commute_provenance    text NOT NULL,

  -- True when no field in the object may be used as Location evidence.
  whole_object_non_evidence boolean NOT NULL DEFAULT false,

  -- The classifier's own verdict, kept in full so a later reader can see what
  -- was decided about each field without re-running anything.
  non_evidence_fields   text[] NOT NULL DEFAULT '{}',
  recoverable_fields    text[] NOT NULL DEFAULT '{}',

  -- Provenance of the classification itself.
  classifier_version    text NOT NULL,
  classified_at         timestamptz NOT NULL DEFAULT now(),
  notes                 text
);

COMMENT ON TABLE public.report_location_provenance IS
  'ME-5 item 6. Records what each stored location_intelligence object actually is — '
  'template, misdirected measurement, capped count, failed read, offshore, or genuine — '
  'so a score or backtest can tell them apart. Never edits location_intelligence.';

COMMENT ON COLUMN public.report_location_provenance.recoverable_fields IS
  'Fields whose fault can be repaired from data already stored (the coordinate). '
  'A template is never recoverable; a measurement of the wrong question is.';

CREATE INDEX IF NOT EXISTS report_location_provenance_shape_idx
  ON public.report_location_provenance (transport_shape);
CREATE INDEX IF NOT EXISTS report_location_provenance_non_evidence_idx
  ON public.report_location_provenance (whole_object_non_evidence)
  WHERE whole_object_non_evidence;

-- Derived compliance data. Reached through the server, never from a browser.
ALTER TABLE public.report_location_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_location_provenance FROM anon, authenticated;

COMMIT;
