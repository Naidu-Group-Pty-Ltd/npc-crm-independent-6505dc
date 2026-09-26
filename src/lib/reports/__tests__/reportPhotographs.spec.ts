/**
 * A client's report carries the property's own photographs — and never the wrong ones.
 *
 * The photographic masters bind `property.images.N` and nothing ever filled it,
 * so every listing-sourced report printed its cover without the photographs the
 * image library already held. The rule that fills it is stricter than the
 * marketplace gallery's, because the two differ in what an absence costs: a
 * gallery must never blank a card, while every photo slot in a report is
 * designed to print nothing when empty — so the wrong house on a client's
 * cover is the failure to refuse, and a cover without a photograph is not.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MIN_PRINT_LONG_EDGE_PX,
  photographsForReport,
  REPORT_PHOTOGRAPH_COLUMNS,
  REPORT_PHOTOGRAPH_LIMIT,
  sharedListingCounts,
  type StoredListingPhotograph,
} from '../../../../supabase/functions/_shared/reportPhotographs.pure';

const LISTING = 'recAbCdEfGhIjKlMn';

function photo(n: number, overrides: Partial<StoredListingPhotograph> = {}): StoredListingPhotograph {
  return {
    listing_id: LISTING,
    image_identity: `img-${n}`,
    storage_path: `${LISTING}/${String(n).padStart(32, '0')}.jpg`,
    position: n,
    status: 'stored',
    width: 2048,
    height: 1365,
    bytes: 400_000 + n,
    checksum: `sha-${n}`,
    source_url: `https://images.example/listing/${n}.jpg`,
    visual_kind: 'photo',
    // A perceptual hash: distinct pictures are ~32 bits apart, so nothing merges
    // that is not the same photograph.
    visual_signature: createHash('sha256').update(`picture-${n}`).digest('hex').slice(0, 16),
    ...overrides,
  };
}

const unshared = new Map<string, number>();
const paths = (rows: ReturnType<typeof photographsForReport>) => rows.map((p) => p.storagePath);

describe('which photographs may lead a client\'s document', () => {
  it('takes the gallery\'s own order — the agent\'s hero first', () => {
    const rows = [photo(2), photo(0), photo(1)];
    expect(paths(photographsForReport(rows, unshared))).toEqual([rows[1], rows[2], rows[0]].map((r) => r.storage_path));
  });

  it('only what the server has seen to be a photograph — never a plan, a graphic or an image nobody looked at', () => {
    const rows = [
      photo(0, { visual_kind: 'floorplan' }),
      photo(1, { visual_kind: 'graphic' }),
      photo(2, { visual_kind: null }),
      photo(3, { visual_kind: 'unknown' }),
      photo(4),
    ];
    expect(paths(photographsForReport(rows, unshared))).toEqual([rows[4].storage_path]);
  });

  it('a plan alone leaves the report with no photograph — unlike a gallery, which never blanks', () => {
    expect(photographsForReport([photo(0, { visual_kind: 'floorplan' })], unshared)).toEqual([]);
  });

  it('never a photograph another listing also holds — a stock render led seventeen', () => {
    const rows = [photo(0), photo(1)];
    const reuse = sharedListingCounts([
      { listing_id: LISTING, image_identity: 'img-0', checksum_listings: 17, signature_listings: 1 },
    ]);
    expect(paths(photographsForReport(rows, reuse))).toEqual([rows[1].storage_path]);
  });

  it('fails closed when the reuse reading could not be taken', () => {
    expect(photographsForReport([photo(0)], null)).toEqual([]);
  });

  it('leaves out a picture known to print soft, and keeps one whose size nobody recorded', () => {
    const small = photo(0, { width: 800, height: 533 });
    const unknown = photo(1, { width: null, height: null });
    const fine = photo(2, { width: MIN_PRINT_LONG_EDGE_PX, height: 700 });
    expect(paths(photographsForReport([small, unknown, fine], unshared)))
      .toEqual([unknown.storage_path, fine.storage_path]);
  });

  it('one photograph once — a second copy of the same file is not a second photograph', () => {
    // Which copy survives is the gallery's rendition rule (the better one);
    // what the report guarantees is that the picture is printed once.
    const rows = [photo(0), photo(1, { checksum: 'sha-0', source_url: 'https://images.example/listing/0-copy.jpg' })];
    expect(photographsForReport(rows, unshared)).toHaveLength(1);
    expect(photographsForReport([...rows, photo(2)], unshared)).toHaveLength(2);
  });

  it('never more than the most slots any master binds, and nothing unstored', () => {
    const rows = Array.from({ length: 12 }, (_, i) => photo(i));
    expect(photographsForReport(rows, unshared)).toHaveLength(REPORT_PHOTOGRAPH_LIMIT);
    expect(REPORT_PHOTOGRAPH_LIMIT).toBe(6);
    expect(photographsForReport([photo(0, { status: 'gone' }), photo(1, { storage_path: null })], unshared))
      .toEqual([]);
  });
});

describe('the reuse reading is the marketplace\'s own', () => {
  it('whichever measure saw the photograph on more listings wins', () => {
    const counts = sharedListingCounts([
      { listing_id: 'a', image_identity: 'x', checksum_listings: 1, signature_listings: 3 },
      { listing_id: 'a', image_identity: 'y', checksum_listings: null, signature_listings: null },
    ]);
    expect(counts.get('a:x')).toBe(3);
    expect(counts.get('a:y')).toBe(1);
  });

  it('is the same expression `listing-images` reads for the gallery — two readings would drift', () => {
    const gallery = readFileSync('supabase/functions/listing-images/index.ts', 'utf8');
    const report = readFileSync('supabase/functions/_shared/reportPhotographs.pure.ts', 'utf8');
    const rule = 'Math.max(Number(row.checksum_listings) || 1, Number(row.signature_listings) || 1)';
    expect(gallery).toContain(rule);
    expect(report).toContain(rule);
  });
});

describe('the broker reads them for one report, behind the report permission, and never fails the read', () => {
  const broker = readFileSync('supabase/functions/get-investment-reports/index.ts', 'utf8');

  it('reads photographs only for a single report that asked, after the permission gate', () => {
    const gate = broker.indexOf('const permission = await requireModulePermission(');
    const read = broker.indexOf('await readReportPhotographs(');
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
    expect(broker).toMatch(/table === 'investment_reports' && body\.photographs === true\s*\n?\s*\? await readReportPhotographs/);
  });

  it('selects only columns the table has, and signs from the image library\'s own private bucket for minutes', () => {
    expect(broker).toContain('.select(REPORT_PHOTOGRAPH_COLUMNS)');
    for (const column of REPORT_PHOTOGRAPH_COLUMNS.split(',').map((c) => c.trim())) {
      expect(column).toMatch(/^[a-z_]+$/);
    }
    expect(broker).toContain(".from('listing-images')");
    const ttl = Number(broker.match(/PHOTOGRAPH_URL_TTL_SECONDS = (\d+) \* 60;/)?.[1]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15);
  });

  it('every failure is an empty list, never a failed report', () => {
    const fn = broker.slice(broker.indexOf('async function readReportPhotographs('), broker.indexOf('Deno.serve('));
    // Each reader answers an empty reading from its catch — no photographs and
    // no plans — so the report read it rides on carries on without them.
    const reader = (name: string) => {
      const start = fn.indexOf(`async function ${name}(`);
      return fn.slice(start, fn.indexOf('\n}\n', start));
    };
    expect(reader('readListingPhotographs')).toMatch(
      /const none: PhotographReading = \{ photographs: \[\], floorPlans: \[\] \};[\s\S]*catch \(error\) \{[\s\S]*return none;/,
    );
    expect(reader('readCapturedPhotographs')).toMatch(/catch \(error\) \{[\s\S]*return \{ photographs: \[\] \};/);
    expect(fn).not.toMatch(/return failure\(/);
  });
});
