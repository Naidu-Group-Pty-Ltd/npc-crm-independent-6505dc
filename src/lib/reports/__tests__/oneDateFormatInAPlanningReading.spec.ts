/**
 * One document, two date formats, and the machine-readable one in the prose.
 *
 * Page 32 of the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026 printed, in a sentence a client reads:
 *
 * > Under The Hills Local Environmental Plan 2019, **as read on 2026-09-20**,
 * > a dwelling house is permitted with development consent on this land.
 *
 * while every table on that page and the two either side of it said
 * `7 Aug 2026`, `27 Feb 2026` and `20 Sep 2026`.
 *
 * `instrumentAnchor` built its date with `retrievedAt.slice(0, 10)` — an ISO
 * prefix, which is the right thing to STORE and never the right thing to
 * print — while `planningFacts` and `infrastructureEvidence` each carried a
 * private, byte-identical `auDate` the tables went through. Two copies of one
 * rule, and the one place that reached prose had neither.
 */
import { describe, expect, it } from 'vitest';
import { auDate } from '../../../../supabase/functions/_shared/planning/auDate.pure';
import {
  instrumentAnchor,
  residentialSentence,
} from '../../../../supabase/functions/_shared/planning/landUsePermissibility.pure';

const TABLE = {
  status: 'retrieved',
  instrument: 'The Hills Local Environmental Plan 2019',
  retrievedAt: '2026-09-20T04:11:02.881Z',
} as never;

describe('the sentence page 32 printed', () => {
  it('says 20 Sep 2026, the way the tables beside it do', () => {
    expect(instrumentAnchor(TABLE))
      .toBe('Under The Hills Local Environmental Plan 2019, as read on 20 Sep 2026,');
  });

  it('carries no ISO date anywhere in the permissibility sentence', () => {
    const sentence = residentialSentence({
      dwellingHouse: 'permitted_with_consent',
      residentialGroupProhibited: true,
      otherResidential: [],
      neighbouringUsesWithConsent: [],
    }, TABLE);
    expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(sentence).toContain('as read on 20 Sep 2026');
  });

  it('still degrades exactly as it did where a date or instrument is absent', () => {
    expect(instrumentAnchor({ instrument: 'X' } as never)).toBe('Under X,');
    expect(instrumentAnchor(null)).toBe('Under the instrument in force for this land,');
    expect(instrumentAnchor({ retrievedAt: '2026-09-20' } as never))
      .toBe('Under the instrument in force for this land, as read on 20 Sep 2026,');
  });
});

describe('the one formatter all three planning modules now read', () => {
  it.each([
    ['2026-09-20', '20 Sep 2026'],
    ['2026-01-01', '1 Jan 2026'],
    ['2026-12-31', '31 Dec 2026'],
    ['2026-08-07T00:00:00.000Z', '7 Aug 2026'],
  ])('formats %s as %s', (iso, shown) => {
    expect(auDate(iso)).toBe(shown);
  });

  it('hands back what it cannot parse, because a publisher\'s own wording is a fact', () => {
    for (const s of ['Q2 2026', '2025-26', 'current', '']) {
      expect(auDate(s || null)).toBe(s || null);
    }
  });

  it('refuses an impossible month rather than printing undefined', () => {
    expect(auDate('2026-13-01')).toBe('2026-13-01');
    expect(auDate('2026-00-01')).toBe('2026-00-01');
  });

  it('answers null for nothing', () => {
    expect(auDate(null)).toBeNull();
    expect(auDate(undefined)).toBeNull();
  });
});

describe('it is named in exactly one place', () => {
  it('leaves no private copy in the planning modules', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['planningFacts', 'infrastructureEvidence', 'landUsePermissibility']) {
      const src = readFileSync(
        `supabase/functions/_shared/planning/${f}.pure.ts`, 'utf8',
      );
      expect(src, `${f} declares its own auDate`).not.toMatch(/function auDate\s*\(/);
      expect(src, `${f} does not import the shared one`)
        .toMatch(/import \{[^}]*\bauDate\b[^}]*\} from '\.\/auDate\.pure\.ts'/);
    }
  });
});
