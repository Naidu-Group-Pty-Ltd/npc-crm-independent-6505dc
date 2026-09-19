/**
 * The render request, the filename and the storage path.
 *
 * These are the parts of the route that have a contract to keep and can be
 * asserted without a database. The rest of `render-borrowing-capacity-pdf` —
 * auth, four reads, a render, an upload, two writes — is checked by
 * `deno check` and by running it.
 *
 * The filename is the contract that matters most. Four call sites download this
 * document and one publishes it to the client portal; a migration that quietly
 * renames the file renames it in the client's downloads folder too.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SCENARIO_PRESETS,
  SIGNED_URL_TTL_SECONDS,
  parseRenderRequest,
  snapshotFileName,
  snapshotStoragePath,
} from '../route.pure';

const CLIENT = '11111111-2222-4333-8444-555555555555';
const ASSESSMENT = '99999999-8888-4777-a666-555555555555';

describe('parseRenderRequest', () => {
  it('accepts a client id alone and defaults the rest', () => {
    const parsed = parseRenderRequest({ clientId: CLIENT });
    expect(parsed).toEqual({
      ok: true,
      request: { clientId: CLIENT, assessmentId: null, scenarioPresets: [], edition: null },
    });
  });

  it('takes a named assessment', () => {
    const parsed = parseRenderRequest({ clientId: CLIENT, assessmentId: ASSESSMENT });
    expect(parsed.ok && parsed.request.assessmentId).toBe(ASSESSMENT);
  });

  it.each([
    ['no body', null],
    ['a string', 'clientId=1'],
    ['no client', {}],
    ['a client that is not a uuid', { clientId: 'client-1' }],
    ['an assessment that is not a uuid', { clientId: CLIENT, assessmentId: '42' }],
  ])('refuses %s', (_label, body) => {
    expect(parseRenderRequest(body).ok).toBe(false);
  });

  /**
   * The client name is deliberately not an input. It is read from the `clients`
   * row, because a name the caller supplies is a name the caller can change —
   * and the name on a lending document is not a display preference.
   */
  it('ignores anything the caller sends that the server should decide', () => {
    const parsed = parseRenderRequest({
      clientId: CLIENT,
      clientName: 'Someone Else',
      html: '<h1>my own document</h1>',
      capacity: 9_000_000,
    });
    expect(parsed.ok && Object.keys(parsed.request).sort())
      .toEqual(['assessmentId', 'clientId', 'edition', 'scenarioPresets']);
  });

  it('caps the scenario list rather than rendering a hundred rows', () => {
    const presets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
    expect(parseRenderRequest({ clientId: CLIENT, scenarioPresets: presets(MAX_SCENARIO_PRESETS) }).ok).toBe(true);
    const over = parseRenderRequest({ clientId: CLIENT, scenarioPresets: presets(MAX_SCENARIO_PRESETS + 1) });
    expect(over.ok).toBe(false);
    expect((over as { ok: false; error: string }).error).toContain(String(MAX_SCENARIO_PRESETS));
  });

  it('bounds the edition line rather than trusting it', () => {
    const parsed = parseRenderRequest({ clientId: CLIENT, edition: 'X'.repeat(200) });
    expect(parsed.ok && parsed.request.edition).toHaveLength(40);
  });

  it('treats a non-array scenario list as none', () => {
    expect(parseRenderRequest({ clientId: CLIENT, scenarioPresets: 'all' }).ok).toBe(true);
    const parsed = parseRenderRequest({ clientId: CLIENT, scenarioPresets: 'all' });
    expect(parsed.ok && parsed.request.scenarioPresets).toEqual([]);
  });
});

describe('snapshotFileName', () => {
  /**
   * Byte-for-byte what the shipping generator produces. `[^a-zA-Z0-9] → _` is
   * the existing rule, kept exactly: "A. & J. Sample" has been arriving as
   * `A____J__Sample` — four underscores, one per non-alphanumeric — since this
   * format existed.
   */
  it('is unchanged from what the product has always produced', () => {
    expect(snapshotFileName('A. & J. Sample', '2026-08-01T04:30:00.000Z'))
      .toBe('Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-01.pdf');
  });

  it('names a client even when there is no name', () => {
    expect(snapshotFileName('', '2026-08-01T00:00:00Z'))
      .toBe('Borrowing_Capacity_Snapshot_Client_2026-08-01.pdf');
  });

  it('carries nothing a filesystem or a URL would argue with', () => {
    const name = snapshotFileName('O\'Brien & Co. — Pty/Ltd', '2026-08-01T00:00:00Z');
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('snapshotStoragePath', () => {
  const path = () => snapshotStoragePath(CLIENT, 'Report.pdf', '2026-08-01T04:30:00.000Z', 'abc-123');

  it('files under the client and the day', () => {
    expect(path()).toBe(`borrowing-capacity/${CLIENT}/2026-08-01/abc-123-Report.pdf`);
  });

  /**
   * The random segment is not decoration. Without it a second render on the
   * same day either collides or needs `upsert`, and overwriting a document a
   * client may already hold a link to is not a thing to do quietly.
   */
  it('does not collide with an earlier render on the same day', () => {
    const a = snapshotStoragePath(CLIENT, 'Report.pdf', '2026-08-01T00:00:00Z', 'one');
    const b = snapshotStoragePath(CLIENT, 'Report.pdf', '2026-08-01T23:59:59Z', 'two');
    expect(a).not.toBe(b);
  });

  it('says so rather than guessing when the date is unreadable', () => {
    expect(snapshotStoragePath(CLIENT, 'Report.pdf', '', 'x')).toContain('/undated/');
  });
});

describe('the signed link', () => {
  it('lives a day — long enough to email, short enough to expire', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(86_400);
  });
});
