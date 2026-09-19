-- ---------------------------------------------------------------------------
-- Listing image library: let the server see the photographs.
--
-- Until now the only thing that ever looked at a listing photograph's pixels
-- was a browser, after the card had already drawn, for the length of one
-- session. So the single most consequential decision the marketplace makes —
-- which image leads a listing — was taken with no visual information at all.
--
-- Sampled at random from production on 2026-08-19, sixteen listings' hero
-- images were:
--
--   6  floor plans                     (37.5%)
--   1  "coming soon" text card
--   1  stock interior render that is the hero on 17 different listings
--   8  actual photographs of the property
--
-- Five of the six plans are served from `lh3.googleusercontent.com/d/<opaque>`
-- — the agency emails its photographs as Google Drive links — so no URL rule
-- can ever reach them. Pixels are the only evidence there is.
--
-- These columns hold what one decode establishes, so it is established once per
-- photograph rather than once per browser per session, and so it is available
-- before the first reader sees the listing. The verdict is produced by
-- `listing-images` (`op: 'analyse'`) and consumed by every surface at once:
-- the marketplace card, the property page, the lightbox, generated reports and
-- the Airtable write-back.
--
-- Additive and reversible: every column is nullable, and code that runs against
-- a database where this has not been applied falls back to the ordering it had
-- before. Apply this BEFORE deploying the functions that read it — the read
-- path tolerates the columns being absent, but there is no reason to run in
-- that state on purpose.
-- ---------------------------------------------------------------------------

alter table public.listing_images
  add column if not exists visual_kind text,
  add column if not exists visual_signature text,
  add column if not exists visual_white real,
  add column if not exists visual_colour real,
  add column if not exists visual_palette integer,
  add column if not exists visual_edge real,
  add column if not exists visual_analysed_at timestamptz;

comment on column public.listing_images.visual_kind is
  'photo | floorplan | graphic — decided from the pixels by listingImageVision.pure.ts.';
comment on column public.listing_images.visual_signature is
  '64-bit difference hash as 16 hex characters. Equal signatures are the same picture.';
comment on column public.listing_images.visual_white is
  'Fraction of near-white pixels. Floor plans measured 0.731-0.955; photographs 0.000-0.118.';
comment on column public.listing_images.visual_palette is
  'Distinct quantised colours. Line art has tens; a photograph hundreds. Kept so the thresholds can be re-fitted without re-decoding every image.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listing_images_visual_kind_check'
  ) then
    alter table public.listing_images
      add constraint listing_images_visual_kind_check
      check (visual_kind is null or visual_kind in ('photo', 'floorplan', 'graphic'));
  end if;
end $$;

-- The analyser's work queue: un-analysed stored rows, heroes first. Ordering by
-- `position` is what makes a partial backfill useful — every listing's leading
-- image is settled before any listing's fifth one.
create index if not exists listing_images_visual_queue_idx
  on public.listing_images (position, first_seen_at)
  where status = 'stored' and visual_analysed_at is null;

-- Both reuse lookups below group on these.
create index if not exists listing_images_checksum_stored_idx
  on public.listing_images (checksum)
  where status = 'stored';

create index if not exists listing_images_visual_signature_idx
  on public.listing_images (visual_signature)
  where status = 'stored';

-- ---------------------------------------------------------------------------
-- How many DIFFERENT listings show each of these photographs.
--
-- A picture that leads seventeen listings is not a picture of any of them. It
-- is a stock render, an agency banner, an agent's portrait, or a gallery the
-- scraper lifted off a "similar listings" rail. Measured on the same day:
-- 3,035 of 4,841 stored rows carry a photograph that at least one other listing
-- also holds, and 279 of 471 listings LEAD with one.
--
-- Answered here rather than in the function because the question is a grouped
-- aggregate over the whole table and the alternative is shipping every checksum
-- in a query string. Returns one row per stored image of the requested
-- listings, so the caller can rank inside each listing without another query.
-- ---------------------------------------------------------------------------
create or replace function public.listing_image_reuse(p_listing_ids text[])
returns table (
  image_identity text,
  listing_id text,
  checksum_listings integer,
  signature_listings integer
)
language sql
stable
set search_path = public
as $$
  with mine as (
    select image_identity, listing_id, checksum, visual_signature
    from public.listing_images
    where listing_id = any(p_listing_ids)
      and status = 'stored'
  ),
  by_checksum as (
    select li.checksum, count(distinct li.listing_id)::int as n
    from public.listing_images li
    where li.status = 'stored'
      and li.checksum is not null
      and li.checksum in (select m.checksum from mine m where m.checksum is not null)
    group by li.checksum
  ),
  by_signature as (
    select li.visual_signature, count(distinct li.listing_id)::int as n
    from public.listing_images li
    where li.status = 'stored'
      and li.visual_signature is not null
      and li.visual_signature in (select m.visual_signature from mine m where m.visual_signature is not null)
    group by li.visual_signature
  )
  select
    m.image_identity,
    m.listing_id,
    coalesce(c.n, 1) as checksum_listings,
    coalesce(s.n, 1) as signature_listings
  from mine m
  left join by_checksum c on c.checksum = m.checksum
  left join by_signature s on s.visual_signature = m.visual_signature;
$$;

-- `listing_images` is service-role only and so is this.
revoke all on function public.listing_image_reuse(text[]) from public;
revoke all on function public.listing_image_reuse(text[]) from anon;
revoke all on function public.listing_image_reuse(text[]) from authenticated;
grant execute on function public.listing_image_reuse(text[]) to service_role;
