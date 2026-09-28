/**
 * The check that stands between a built G-NAF register and the machine that
 * serves it — itself checked, because a gate nobody has seen refuse is a
 * placebo. `scripts/gnaf/gnafVerify.ts` reads every shard, reconciles the rows
 * with the manifest, confirms every postal area the locality index promises
 * exists, and asks the chain's own matcher for a sample of the register's own
 * addresses. Each refusal below is one it must make.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { GNAF_SHARD_COLUMNS } from '../../../../supabase/functions/_shared/geocode/gnafShard.pure.ts';
import {
  addressOfRow,
  verificationRefusals,
  verifyGnafShards,
} from '../../../../scripts/gnaf/gnafVerify.ts';

const line = (o: Record<string, string>) => GNAF_SHARD_COLUMNS.map((c) => o[c] ?? '').join('|');

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** A register on disk, shaped exactly as the builder writes one. */
function register(opts: { rowsInManifest?: number; indexExtra?: Record<string, string[]>; rows?: string[] } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'gnaf-verify-'));
  const rows = opts.rows ?? [
    line({ n1: '5', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768512', lng: '150.907511', gt: 'BC', pid: 'A' }),
    line({ n1: '5', flat: '3', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768900', lng: '150.908000', gt: 'UC', pid: 'B' }),
    line({ n1: '225', n2: '245', street: 'MAIN', type: 'STREET', locality: 'BLACKTOWN', lat: '-33.77', lng: '150.91', gt: 'PC', pid: 'C' }),
    line({ lot: '1037', street: 'HUNZA', type: 'ROAD', locality: 'BLACKTOWN', lat: '-33.772', lng: '150.912', gt: 'PC', pid: 'D' }),
    line({ n1: '12', street: 'KILDA', type: 'ROAD', suffix: 'N', locality: 'BLACKTOWN', lat: '-33.771', lng: '150.911', gt: 'FCS', pid: 'E' }),
  ];
  const v1 = join(dir, 'v1');
  mkdirSync(join(v1, 'NSW'), { recursive: true });
  writeFileSync(join(v1, 'NSW', '2148.psv.gz'), gzipSync(Buffer.from([GNAF_SHARD_COLUMNS.join('|'), ...rows].join('\n') + '\n')));
  writeFileSync(join(v1, 'manifest.json'), JSON.stringify({
    format: 1,
    release: { label: 'AUG 2026' },
    counts: { rows_written: opts.rowsInManifest ?? rows.length },
  }));
  writeFileSync(join(v1, 'localities.json.gz'), gzipSync(Buffer.from(JSON.stringify({
    format: 1,
    states: { NSW: { BLACKTOWN: ['2148'], ...(opts.indexExtra ?? {}) } },
  }))));
  return dir;
}

describe('the register checked against itself', () => {
  it('passes a register whose rows, index and addresses all agree', () => {
    const result = verifyGnafShards({ dir: register(), sampleShards: 1, perShard: 40 });
    expect(result.countedRows).toBe(5);
    // Every row once — never more asks than a shard has addresses.
    expect(result.fields.asked).toBe(5);
    expect(result.fields.not_found).toBe(0);
    expect(result.fields.wrong_place).toBe(0);
    expect(verificationRefusals(result)).toEqual([]);
  });

  it('refuses rows that do not add up to the manifest', () => {
    const result = verifyGnafShards({ dir: register({ rowsInManifest: 9 }), sampleShards: 1, perShard: 5 });
    expect(verificationRefusals(result).join('\n')).toContain('the shards hold 5 rows and the manifest says 9');
  });

  it('refuses an index that promises a postal area with no file', () => {
    const result = verifyGnafShards({ dir: register({ indexExtra: { ROOTY_HILL: ['2766'] } }), sampleShards: 1, perShard: 5 });
    expect(verificationRefusals(result).join('\n')).toContain('NSW/2766');
  });

  it('refuses where the matcher cannot find the register\'s own addresses', () => {
    // A prefixed street number (`A5`) is one the chain's parser does not read
    // as a number: the kind of normalisation gap only the real release shows.
    const rows = [line({ n1p: 'A', n1: '5', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.7', lng: '150.9', gt: 'PC', pid: 'P' })];
    const result = verifyGnafShards({ dir: register({ rows }), sampleShards: 1, perShard: 5 });
    expect(result.fields.not_found).toBe(1);
    expect(verificationRefusals(result).join('\n')).toMatch(/were not found by the matcher/);
  });

  it('writes a register row out the way a report files an address', () => {
    const base = { number: '5', first: 5, last: null, lot: '', flat: '', street: 'SECOND', type: 'AVENUE', suffix: '', locality: 'BLACKTOWN', lat: 0, lng: 0, geocodeType: 'BC', pid: 'A', state: 'NSW' as const, postcode: '2148' };
    expect(addressOfRow(base)).toBe('5 SECOND AVENUE, BLACKTOWN NSW 2148');
    expect(addressOfRow({ ...base, flat: '1408' })).toBe('1408/5 SECOND AVENUE, BLACKTOWN NSW 2148');
    expect(addressOfRow({ ...base, flat: 'g01' })).toBe('Unit G01, 5 SECOND AVENUE, BLACKTOWN NSW 2148');
    expect(addressOfRow({ ...base, number: '', first: null, lot: '1037' })).toBe('Lot 1037 SECOND AVENUE, BLACKTOWN NSW 2148');
    expect(addressOfRow({ ...base, suffix: 'N', type: 'ROAD', street: 'KILDA' })).toBe('5 KILDA ROAD north, BLACKTOWN NSW 2148');
  });
});
