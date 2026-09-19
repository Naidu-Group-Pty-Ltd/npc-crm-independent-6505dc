-- ============================================================================
-- Builders Network Phase 7, wave 2 — the stock mirror the marketplace reads
-- (plan §3 E3, §7 Phase 7).
--
-- The Command Centre marketplace serves clients TODAY off five builder
-- tables, and Phase 7 deletes the builder schema. E3's contract: the clone
-- keeps its marketplace, re-pointed at a `builder_network_stock_items`
-- mirror whose PK IS the network's item id — the same PK trick as the
-- transaction mirror, and what makes the cutover a pure table-name swap in
-- the read path. This migration creates the three mirrors and SEEDS them
-- from the tables they replace, in the same file, so every database that
-- still holds the source rows self-seeds at apply time and a fresh clone
-- provisioned after the deletion no-ops the seed and takes sync data later.
--
-- Shape rule: the item and image mirrors carry the FULL column set of the
-- tables they replace, because the marketplace's read path (`select('*')`,
-- the manual-stats overlay, the image ranking, the frozen-derivative
-- resolution) reads nearly every column and a narrowed mirror would be a
-- second projection to drift. `id` columns carry NO default — the ids are
-- the network's (Phase 4 preserved them), and nothing clone-side may mint
-- one. The slim organisations mirror carries exactly what the marketplace
-- renders: the two name columns.
--
-- What deliberately has NO mirror: `builder_stock_uploads` (attribution now
-- reads the item's own created_by column), the image-processing pipeline
-- (the settler retires with its tables — mirror rows arrive PROCESSED), and
-- `builder_stock_selections`, which was never leaving (the clone's own
-- Command Centre record; wave 3 re-points its FK and its guard trigger at
-- this mirror).
--
-- Storage: image rows keep naming the prime's `builder-stock-images`
-- objects, which STAY until the network serves the mirror's imagery over
-- the connection — dropping the bytes before that would blank every card.
--
-- Replay safety: CREATE TABLE IF NOT EXISTS throughout; the seed is guarded
-- by to_regclass on its source and ON CONFLICT DO NOTHING, so re-application
-- is a no-op and a post-deletion corpus skips it cleanly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.builder_network_stock_organisations (
  id uuid PRIMARY KEY,
  legal_name text NOT NULL,
  trading_name text,
  source_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.builder_network_stock_items (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  upload_id uuid,
  first_upload_id uuid,
  created_by_builder_user_id uuid,
  builder_project_id uuid,
  builder_unit_id uuid,
  external_reference text,
  development_name text,
  project_name text,
  address_line text,
  suburb text,
  state text,
  postcode text,
  lot_number text,
  unit_number text,
  bedrooms numeric(4,1),
  bathrooms numeric(4,1),
  car_spaces numeric(4,1),
  property_type text,
  land_size_sqm numeric(12,2),
  building_size_sqm numeric(12,2),
  price numeric(14,2),
  price_display text,
  availability_status text NOT NULL DEFAULT 'available',
  expected_completion text,
  description text,
  lifecycle_status text NOT NULL DEFAULT 'active',
  enrichment_status text NOT NULL DEFAULT 'pending',
  enriched_at timestamptz,
  primary_image_id uuid,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  source_provenance_result jsonb,
  image_work_stage text NOT NULL DEFAULT 'source',
  image_work_claim_until timestamptz,
  image_work_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  image_work_attempts integer NOT NULL DEFAULT 0,
  image_work_last_result text,
  image_work_last_error text,
  image_work_updated_at timestamptz,
  pending_patch jsonb,
  pending_upload_id uuid,
  manual_stats jsonb,
  source_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.builder_network_stock_item_images (
  id uuid PRIMARY KEY,
  stock_item_id uuid
    REFERENCES public.builder_network_stock_items(id) ON DELETE CASCADE,
  upload_id uuid,
  organisation_id uuid NOT NULL,
  source_stage text NOT NULL,
  source_reference text,
  source_provider text,
  source_page_url text,
  source_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_bucket text,
  storage_path text,
  external_url text,
  content_type text,
  byte_size bigint,
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence numeric(3,2),
  processing_status text NOT NULL DEFAULT 'pending',
  error_message text,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source_version bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS builder_network_stock_items_live_idx
  ON public.builder_network_stock_items (lifecycle_status, created_at DESC);
CREATE INDEX IF NOT EXISTS builder_network_stock_items_org_idx
  ON public.builder_network_stock_items (organisation_id);
CREATE INDEX IF NOT EXISTS builder_network_stock_items_availability_idx
  ON public.builder_network_stock_items (availability_status);
CREATE INDEX IF NOT EXISTS builder_network_stock_items_state_idx
  ON public.builder_network_stock_items (state);
CREATE INDEX IF NOT EXISTS builder_network_stock_item_images_item_idx
  ON public.builder_network_stock_item_images (stock_item_id, "position");

-- Service-role only, like every table of the sync plane: the browser reads
-- the marketplace through its edge function, never the tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'builder_network_stock_organisations',
    'builder_network_stock_items',
    'builder_network_stock_item_images'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_service ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The seed: the same rows under the same ids, taken while the source still
-- exists. First copy wins (ON CONFLICT DO NOTHING) — the mirror's future
-- writer is the network sync, and a replay must never overwrite what it has
-- since delivered.
-- ---------------------------------------------------------------------------
DO $seed$
BEGIN
  IF to_regclass('public.builder_organisations') IS NOT NULL THEN
    EXECUTE 'insert into public.builder_network_stock_organisations (id, legal_name, trading_name)
             select id, legal_name, trading_name from public.builder_organisations
             on conflict (id) do nothing';
  END IF;
  IF to_regclass('public.builder_stock_items') IS NOT NULL THEN
    EXECUTE 'insert into public.builder_network_stock_items (
               id, organisation_id, upload_id, first_upload_id, created_by_builder_user_id,
               builder_project_id, builder_unit_id, external_reference, development_name,
               project_name, address_line, suburb, state, postcode, lot_number, unit_number,
               bedrooms, bathrooms, car_spaces, property_type, land_size_sqm,
               building_size_sqm, price, price_display, availability_status,
               expected_completion, description, lifecycle_status, enrichment_status,
               enriched_at, primary_image_id, source_row, created_at, updated_at,
               last_seen_at, source_provenance_result, image_work_stage,
               image_work_claim_until, image_work_next_attempt_at, image_work_attempts,
               image_work_last_result, image_work_last_error, image_work_updated_at,
               pending_patch, pending_upload_id, manual_stats)
             select
               id, organisation_id, upload_id, first_upload_id, created_by_builder_user_id,
               builder_project_id, builder_unit_id, external_reference, development_name,
               project_name, address_line, suburb, state, postcode, lot_number, unit_number,
               bedrooms, bathrooms, car_spaces, property_type, land_size_sqm,
               building_size_sqm, price, price_display, availability_status,
               expected_completion, description, lifecycle_status, enrichment_status,
               enriched_at, primary_image_id, source_row, created_at, updated_at,
               last_seen_at, source_provenance_result, image_work_stage,
               image_work_claim_until, image_work_next_attempt_at, image_work_attempts,
               image_work_last_result, image_work_last_error, image_work_updated_at,
               pending_patch, pending_upload_id, manual_stats
             from public.builder_stock_items
             on conflict (id) do nothing';
  END IF;
  IF to_regclass('public.builder_stock_item_images') IS NOT NULL THEN
    -- Rows attributed to NO property (stock_item_id null — the page declined
    -- to say whose house that is) are deliberately not mirrored: the
    -- marketplace refuses to serve them today, and a mirror is what the
    -- marketplace reads, not a second archive (builder_archive is the archive).
    EXECUTE 'insert into public.builder_network_stock_item_images (
               id, stock_item_id, upload_id, organisation_id, source_stage,
               source_reference, source_provider, source_page_url, source_detail,
               storage_bucket, storage_path, external_url, content_type, byte_size,
               verification_status, confidence, processing_status, error_message,
               "position", created_at, updated_at)
             select
               id, stock_item_id, upload_id, organisation_id, source_stage,
               source_reference, source_provider, source_page_url, source_detail,
               storage_bucket, storage_path, external_url, content_type, byte_size,
               verification_status, confidence, processing_status, error_message,
               "position", created_at, updated_at
             from public.builder_stock_item_images
             where stock_item_id is not null
             on conflict (id) do nothing';
  END IF;
END
$seed$;
