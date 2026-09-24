/**
 * A report's geography, resolved once per point.
 *
 * The generator resolves the same coordinate on every invocation of one
 * report. Before this, a boundary service that answered on the first
 * invocation and failed on a later one OVERWROTE the resolved row with an
 * `unresolved` one, and that invocation withheld the demographics, skipped the
 * market evidence and wrote its sections as if the property had never been
 * placed — beside sections an earlier invocation wrote with all of it. And a
 * write that failed dropped the resolution itself, while both callers logged
 * "resolution still used".
 */
import { describe, expect, it } from 'vitest';
import {
  GEOGRAPHY_METHOD,
  resolveOneReportGeography,
  storedRowDescribesPoint,
  type GeographyRowShape,
} from '../../../../supabase/functions/_shared/geography/resolveOneReportGeography';
import {
  ASGS_RELEASE,
  type AsgsLookup,
} from '../../../../supabase/functions/_shared/geography/asgsGeography.pure';

const POINT = { lat: -28.7372735, lng: 114.6282027 };

const area = (code: string, name: string) => ({ code, name });
const PLACED: AsgsLookup = {
  sal: area('SAL50000', 'Spalding (WA)'),
  poa: area('POA6530', '6530'),
  sa2: area('511011275', 'Geraldton - North'),
  ra: area('3RWA', 'Outer Regional Australia'),
  ucl: area('5003', 'Geraldton'),
  sua: area('5003', 'Geraldton'),
  salNeighbours: [area('SAL50000', 'Spalding (WA)')],
  serviceFailed: false,
};
const SERVICE_DOWN: AsgsLookup = {
  sal: null, poa: null, sa2: null, ra: null, ucl: null, sua: null, salNeighbours: [], serviceFailed: true,
};

const storedRow = (over: Partial<GeographyRowShape> = {}): GeographyRowShape => ({
  report_id: 'r1',
  latitude: POINT.lat,
  longitude: POINT.lng,
  suburb: 'Spalding (WA)',
  locality_code: 'SAL50000',
  postcode: '6530',
  state: 'Western Australia',
  sa2_code: '511011275',
  sa2_name: 'Geraldton - North',
  sa3_name: null,
  sa4_name: null,
  gccsa_name: null,
  remoteness_area: 'Outer Regional Australia',
  urban_centre: 'Geraldton',
  significant_urban_area: 'Geraldton',
  method: GEOGRAPHY_METHOD,
  boundary_source: 'ABS ASGS 2021 (geo.abs.gov.au ArcGIS REST)',
  source_version: ASGS_RELEASE,
  status: 'resolved',
  flags: [],
  notes: '',
  ...over,
});

function fakeSupabase(opts: { stored?: GeographyRowShape | null; writeError?: string; readError?: string } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  let reads = 0;
  return {
    writes,
    get reads() { return reads; },
    from(table: string) {
      if (table === 'report_geography') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                reads += 1;
                return opts.readError
                  ? { data: null, error: { message: opts.readError } }
                  : { data: opts.stored ?? null, error: null };
              },
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            writes.push(row);
            return { error: opts.writeError ? { message: opts.writeError } : null };
          },
        };
      }
      if (table === 'abs_sa2_meta') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      if (table === 'suburb_directory') {
        return {
          select: () => ({
            ilike: () => ({ limit: async () => ({ data: [{ suburb: 'Spalding', state: 'WA', postcode: '6530' }], error: null }) }),
          }),
        };
      }
      throw new Error(`the resolver must not read ${table}`);
    },
  };
}

const lookupThat = (answer: AsgsLookup) => {
  const calls: Array<[number, number]> = [];
  const fn = async (lat: number, lng: number) => { calls.push([lat, lng]); return answer; };
  return Object.assign(fn, { calls });
};

describe('storedRowDescribesPoint', () => {
  it('accepts the same point, method and release, placed', () => {
    expect(storedRowDescribesPoint(storedRow(), POINT.lat, POINT.lng)).toBe(true);
    expect(storedRowDescribesPoint(storedRow({ status: 'resolved_with_warning' }), POINT.lat, POINT.lng)).toBe(true);
  });

  it('refuses an unresolved row — the one kind a retry can clear', () => {
    expect(storedRowDescribesPoint(storedRow({ status: 'unresolved' }), POINT.lat, POINT.lng)).toBe(false);
  });

  it('refuses another point, another method or another release', () => {
    expect(storedRowDescribesPoint(storedRow(), POINT.lat + 0.001, POINT.lng)).toBe(false);
    expect(storedRowDescribesPoint(storedRow({ method: 'none' }), POINT.lat, POINT.lng)).toBe(false);
    expect(storedRowDescribesPoint(storedRow({ source_version: 'ASGS2016' }), POINT.lat, POINT.lng)).toBe(false);
    expect(storedRowDescribesPoint(null, POINT.lat, POINT.lng)).toBe(false);
  });
});

describe('resolveOneReportGeography with reuseStored', () => {
  it('answers from the stored row and neither asks the service nor writes', async () => {
    const db = fakeSupabase({ stored: storedRow() });
    const lookupPoint = lookupThat(SERVICE_DOWN);
    const out = await resolveOneReportGeography({
      supabase: db, reportId: 'r1', latitude: POINT.lat, longitude: POINT.lng, lookupPoint, reuseStored: true,
    });
    expect(out.reused).toBe(true);
    expect(out.status).toBe('resolved');
    expect(out.row?.postcode).toBe('6530');
    expect(lookupPoint.calls).toHaveLength(0);
    // The failure mode this closes: an outage writing `unresolved` over it.
    expect(db.writes).toHaveLength(0);
  });

  it('asks again when the stored row is unresolved, and writes what it finds', async () => {
    const db = fakeSupabase({ stored: storedRow({ status: 'unresolved', suburb: null, locality_code: null }) });
    const lookupPoint = lookupThat(PLACED);
    const out = await resolveOneReportGeography({
      supabase: db, reportId: 'r1', latitude: POINT.lat, longitude: POINT.lng, lookupPoint, reuseStored: true,
    });
    expect(lookupPoint.calls).toHaveLength(1);
    expect(out.reused).toBe(false);
    expect(out.row?.postcode).toBe('6530');
    expect(db.writes).toHaveLength(1);
  });

  it('a stored-row read that fails costs a request, never a geography', async () => {
    const db = fakeSupabase({ readError: 'statement timeout' });
    const lookupPoint = lookupThat(PLACED);
    const out = await resolveOneReportGeography({
      supabase: db, reportId: 'r1', latitude: POINT.lat, longitude: POINT.lng, lookupPoint, reuseStored: true,
    });
    expect(lookupPoint.calls).toHaveLength(1);
    expect(out.row?.postcode).toBe('6530');
  });

  it('the batch sweep, which does not opt in, re-resolves exactly as before', async () => {
    const db = fakeSupabase({ stored: storedRow() });
    const lookupPoint = lookupThat(PLACED);
    await resolveOneReportGeography({
      supabase: db, reportId: 'r1', latitude: POINT.lat, longitude: POINT.lng, lookupPoint,
    });
    expect(lookupPoint.calls).toHaveLength(1);
    expect(db.reads).toBe(0);
  });
});

describe('a failed write does not drop a sound resolution', () => {
  it('returns the resolved row with the write error beside it', async () => {
    const db = fakeSupabase({ writeError: 'deadlock detected' });
    const out = await resolveOneReportGeography({
      supabase: db, reportId: 'r1', latitude: POINT.lat, longitude: POINT.lng, lookupPoint: lookupThat(PLACED),
    });
    expect(out.writeError).toBe('deadlock detected');
    expect(out.row).not.toBeNull();
    expect(out.row?.postcode).toBe('6530');
    expect(out.status).toBe('resolved');
  });
});
