/**
 * The amenity register's side effects: reading it at decision time and
 * writing it at ingest. The vocabulary and shapes live in the two pure
 * modules beside this; nothing here decides anything they do not.
 *
 * READ RULES
 *  - **Currency first.** The sync ledger is consulted before any rows:
 *    zero rows for a state whose slices never loaded must answer
 *    "register unavailable", never "no schools here" — the sanctions
 *    register's founding lesson, and the reason the read wants the
 *    subject's STATE. A request whose state cannot be established gets
 *    `unavailable` and the next provider, because a register read that
 *    cannot prove its coverage is a confident zero waiting to happen.
 *  - **A failed read is a failed read.** A database error marks every
 *    category unavailable (`ok: false`), which downstream records as
 *    unmeasured — never as zero (`aml.cases`: a read that FAILED is not
 *    a row that is ABSENT).
 *
 * WRITE RULES (ingest)
 *  - **Upsert, then prune by sync id.** Rows are upserted under the run's
 *    `sync_id`; only after every batch lands does the prune delete the
 *    slice's rows carrying any OTHER sync id, and only then does the
 *    ledger read `succeeded`. A run that dies mid-way leaves the previous
 *    load standing and a ledger row that never says succeeded — the
 *    sanctions loader's insert-then-prune shape.
 */

import type { AmenityCategory } from './overpassAmenities.pure.ts';
import type { AmenityRow } from './overpassAmenities.pure.ts';
import {
  AMENITY_RADII,
  AMENITY_RESULT_CAP,
  amenityRegisterMaxAgeDays,
  assessSliceCurrency,
  haversineKm,
  toAmenityLookup,
  type AmenityLookup,
  type AmenitySyncRow,
  type StoredAmenity,
} from './amenityRegister.pure.ts';
import { boundingBox } from '../transportReading.pure.ts';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface RegisterCategoryReading {
  lookup: AmenityLookup;
  /** When the slice this answer came from was loaded — provenance for the stamp. */
  loadedAt: string | null;
  /** Why the register did not answer, when it did not. */
  unavailableReason: 'never_loaded' | 'stale' | 'state_unknown' | 'read_failed' | null;
}

const UNAVAILABLE = (reason: NonNullable<RegisterCategoryReading['unavailableReason']>): RegisterCategoryReading => ({
  lookup: { ok: false, count: 0, results: [] },
  loadedAt: null,
  unavailableReason: reason,
});

/**
 * Read every category for one subject in one pass: one ledger query, one
 * bbox query per category. `state` is the normalised AU state the subject
 * is in, or null when the caller could not establish one.
 */
export async function readAmenityRegister(
  supabase: SupabaseLike,
  origin: { lat: number; lng: number },
  state: string | null,
  categories: AmenityCategory[],
  env: (k: string) => string | undefined,
  now: Date = new Date(),
): Promise<Record<string, RegisterCategoryReading>> {
  const out: Record<string, RegisterCategoryReading> = {};
  if (state === null) {
    for (const c of categories) out[c] = UNAVAILABLE('state_unknown');
    return out;
  }

  const { data: syncRows, error: syncError } = await supabase
    .from('amenity_register_syncs')
    .select('category, state, status, finished_at')
    .eq('state', state)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(60);
  if (syncError) {
    console.error('[amenity-register] sync ledger read failed:', syncError.message);
    for (const c of categories) out[c] = UNAVAILABLE('read_failed');
    return out;
  }

  const maxAge = amenityRegisterMaxAgeDays(env);
  for (const category of categories) {
    const currency = assessSliceCurrency((syncRows ?? []) as AmenitySyncRow[], category, state, now, maxAge);
    if (!currency.current) {
      out[category] = UNAVAILABLE(currency.reason);
      continue;
    }
    const read = await readCategoryRows(supabase, origin, category);
    if (!read.ok) {
      out[category] = UNAVAILABLE('read_failed');
      continue;
    }
    out[category] = {
      lookup: toAmenityLookup(read.rows, origin, category),
      loadedAt: currency.loadedAt,
      unavailableReason: null,
    };
  }
  return out;
}

const ROW_LIMIT = 1000;

/**
 * A bounding-box query cannot order by distance, so a capped read over a
 * dense area could drop NEAR rows while keeping far ones. Ask a tight box
 * (≤2 km) first: in a CBD it fills the nearest-ten from rows that are all
 * genuinely close, and in a quiet area it comes back small and the full
 * radius is asked plainly. The wide read is only trusted alone because it
 * replaces, never merges — both boxes read the same table.
 */
async function readCategoryRows(
  supabase: SupabaseLike,
  origin: { lat: number; lng: number },
  category: AmenityCategory,
): Promise<{ ok: true; rows: StoredAmenity[] } | { ok: false }> {
  const radius = AMENITY_RADII[category];
  const innerMetres = Math.min(radius, 2000);
  const inner = await bboxRead(supabase, origin, category, innerMetres);
  if (!inner.ok) return inner;
  if (innerMetres === radius) return inner;
  const innerKm = innerMetres / 1000;
  const nearCount = inner.rows.filter(
    (r) => haversineKm(origin.lat, origin.lng, r.lat, r.lon) <= innerKm,
  ).length;
  if (nearCount >= AMENITY_RESULT_CAP) return inner;
  return await bboxRead(supabase, origin, category, radius);
}

async function bboxRead(
  supabase: SupabaseLike,
  origin: { lat: number; lng: number },
  category: AmenityCategory,
  metres: number,
): Promise<{ ok: true; rows: StoredAmenity[] } | { ok: false }> {
  const box = boundingBox(origin.lat, origin.lng, metres);
  const { data, error } = await supabase
    .from('amenity_register')
    .select('name, address, lat, lon')
    .eq('category', category)
    .gte('lat', box.minLat).lte('lat', box.maxLat)
    .gte('lon', box.minLon).lte('lon', box.maxLon)
    .limit(ROW_LIMIT);
  if (error) {
    console.error(`[amenity-register] ${category} read failed:`, error.message);
    return { ok: false };
  }
  return { ok: true, rows: (data ?? []) as StoredAmenity[] };
}

/**
 * School rows near a subject, for `school-data-service` — same currency
 * gate, wider columns (sector and the element's own postcode travel).
 */
export async function readRegisterSchools(
  supabase: SupabaseLike,
  origin: { lat: number; lng: number },
  state: string,
  radiusMetres: number,
  env: (k: string) => string | undefined,
  now: Date = new Date(),
): Promise<
  | { ok: true; loadedAt: string; rows: Array<StoredAmenity & { school_sector: string | null; postcode: string | null }> }
  | { ok: false; reason: 'never_loaded' | 'stale' | 'read_failed' }
> {
  const { data: syncRows, error: syncError } = await supabase
    .from('amenity_register_syncs')
    .select('category, state, status, finished_at')
    .eq('state', state)
    .eq('category', 'schools')
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(10);
  if (syncError) {
    console.error('[amenity-register] schools sync read failed:', syncError.message);
    return { ok: false, reason: 'read_failed' };
  }
  const currency = assessSliceCurrency(
    (syncRows ?? []) as AmenitySyncRow[],
    'schools',
    state,
    now,
    amenityRegisterMaxAgeDays(env),
  );
  if (!currency.current) return { ok: false, reason: currency.reason };

  const box = boundingBox(origin.lat, origin.lng, radiusMetres);
  const { data: rows, error } = await supabase
    .from('amenity_register')
    .select('name, address, lat, lon, school_sector, postcode')
    .eq('category', 'schools')
    .gte('lat', box.minLat).lte('lat', box.maxLat)
    .gte('lon', box.minLon).lte('lon', box.maxLon)
    .limit(200);
  if (error) {
    console.error('[amenity-register] schools read failed:', error.message);
    return { ok: false, reason: 'read_failed' };
  }
  return {
    ok: true,
    loadedAt: currency.loadedAt,
    rows: (rows ?? []) as Array<StoredAmenity & { school_sector: string | null; postcode: string | null }>,
  };
}

// ── Ingest writes ─────────────────────────────────────────────────────────

export async function openSliceSync(
  supabase: SupabaseLike,
  category: AmenityCategory,
  state: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('amenity_register_syncs')
    .insert({ category, state, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`amenity sync open failed: ${error.message}`);
  return (data as { id: string }).id;
}

export async function closeSliceSync(
  supabase: SupabaseLike,
  syncId: string,
  outcome: { status: 'succeeded' | 'failed'; rowsWritten?: number; detail?: Record<string, unknown>; error?: string },
): Promise<void> {
  const { error } = await supabase
    .from('amenity_register_syncs')
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      rows_written: outcome.rowsWritten ?? null,
      detail: outcome.detail ?? {},
      error: outcome.error ?? null,
    })
    .eq('id', syncId);
  if (error) throw new Error(`amenity sync close failed: ${error.message}`);
}

const UPSERT_BATCH = 500;

export async function upsertSliceRows(
  supabase: SupabaseLike,
  rows: AmenityRow[],
  state: string,
  syncId: string,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH).map((r) => ({
      category: r.category,
      osm_type: r.osmType,
      osm_id: r.osmId,
      name: r.name,
      address: r.address,
      postcode: r.postcode,
      lat: r.lat,
      lon: r.lon,
      state,
      school_sector: r.schoolSector,
      sync_id: syncId,
      loaded_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('amenity_register')
      .upsert(batch, { onConflict: 'category,osm_type,osm_id' });
    if (error) throw new Error(`amenity upsert failed at row ${i}: ${error.message}`);
    written += batch.length;
  }
  return written;
}

/**
 * Remove the slice's rows from any earlier load. Runs only after every
 * upsert batch landed; the filter names real columns only — the sanctions
 * loader's 42703 was a prune whose columns PostgREST resolved against the
 * RETURNING projection, so this one selects nothing back.
 */
export async function pruneSliceRows(
  supabase: SupabaseLike,
  category: AmenityCategory,
  state: string,
  syncId: string,
): Promise<void> {
  const { error } = await supabase
    .from('amenity_register')
    .delete()
    .eq('category', category)
    .eq('state', state)
    .neq('sync_id', syncId);
  if (error) throw new Error(`amenity prune failed: ${error.message}`);
}
