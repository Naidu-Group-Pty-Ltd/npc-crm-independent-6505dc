import { describe, it, expect } from 'vitest';
import {
  formatIsoDate, isIsoDateValue, resolveBindable, resolveBindableColor, resolveBindableNumber,
} from '../bindingResolver';
import { formatCell } from '../blocks/_data';
import { formatReportDate } from '../../../../supabase/functions/_shared/reports/clientDetails/render.pure';

const ctx = (data: any, tokens: any = { colors: {}, fonts: {}, spacing: {} }) => ({ data, tokens });

describe('bindingResolver — basic paths', () => {
  it('resolves literal strings unchanged', () => {
    expect(resolveBindable('hello', ctx({}))).toBe('hello');
  });
  it('resolves a simple path', () => {
    expect(resolveBindable('{{a.b}}', ctx({ a: { b: 'x' } }))).toBe('x');
  });
  it('resolves array index syntax', () => {
    expect(resolveBindable('{{items[1].name}}', ctx({ items: [{ name: 'a' }, { name: 'b' }] }))).toBe('b');
  });
  it('returns empty string for missing path', () => {
    expect(resolveBindable('{{nope.here}}', ctx({}))).toBe('');
  });
});

describe('bindingResolver — filters', () => {
  it('applies currency filter (locale-independent shape)', () => {
    const out = resolveBindable('{{n | currency}}', ctx({ n: 1234 }));
    expect(out).toMatch(/1[\s,.\u00A0]?234/);
  });
  it('chains filters', () => {
    expect(resolveBindable('{{n | round | currency}}', ctx({ n: 1234.789 }))).toMatch(/1[\s,.\u00A0]?235/);
  });
  it('upper / lower / truncate', () => {
    expect(resolveBindable('{{s | upper}}', ctx({ s: 'hi' }))).toBe('HI');
    expect(resolveBindable('{{s | lower}}', ctx({ s: 'HI' }))).toBe('hi');
    expect(resolveBindable('{{s | truncate:3}}', ctx({ s: 'hello' }))).toMatch(/^hel/);
  });
  it('fallback filter falls back when empty', () => {
    expect(resolveBindable('{{missing | fallback:"n/a"}}', ctx({}))).toBe('n/a');
  });
  it.each([
    ['currency', '999999'],
    ['number', '-1'],
    ['percent', '101'],
    ['fixed', '101'],
    ['fixed', 'Infinity'],
    ['fixed', 'not-a-number'],
  ])('uses the default precision for an invalid %s argument', (filter, decimals) => {
    const context = ctx({ n: 12.345 });
    expect(resolveBindable(`{{n | ${filter}:${decimals}}}`, context)).toBe(
      resolveBindable(`{{n | ${filter}}}`, context),
    );
  });
});

describe('bindingResolver — numbers', () => {
  it('resolves numbers when present', () => {
    expect(resolveBindableNumber('{{n}}', ctx({ n: 42 }), 0)).toBe(42);
  });
  it('passes literal numbers through', () => {
    expect(resolveBindableNumber(15, ctx({}))).toBe(15);
  });
});

describe('bindingResolver — expressions safety', () => {
  it('returns empty string when expression cannot be evaluated', () => {
    // The evaluator is sandboxed by a character whitelist; anything rejected
    // must not throw and must not leak globals.
    expect(resolveBindable('{{= window.location }}', ctx({}))).toBe('');
  });
});


describe('bindingResolver — colours', () => {
  it('normalises CSS colour forms emitted by image/code reconstruction', () => {
    expect(resolveBindableColor('rgb(20, 40, 60)', ctx({}))).toBe('#14283c');
    expect(resolveBindableColor('rgba(255, 128, 0, 0.5)', ctx({}))).toBe('#ff8000');
    expect(resolveBindableColor('hsl(210, 50%, 40%)', ctx({}))).toBe('#336699');
    expect(resolveBindableColor('white', ctx({}))).toBe('#ffffff');
  });

  it('keeps transparent explicit for renderer skip logic', () => {
    expect(resolveBindableColor('transparent', ctx({}), 'transparent')).toBe('transparent');
  });
});

/**
 * No page prints a machine timestamp.
 *
 * A Client Details Form exported on 16 August 2026 carried
 * `Prepared 2026-08-16T08:58:56.946Z` on its cover and again under `PREPARED`
 * on page 3. `report.generatedDate` is a full ISO timestamp in all seven
 * projections — they publish `updated_at` / `created_at` / `preparedOn`
 * verbatim, under a name that promises a date — and the template it was drawn
 * from bound it with no `| date`.
 *
 * The catalogue source had already been corrected; the row the document was
 * drawn from had not, because an activated template is a copy. So the rule is
 * the renderer's: a bound value that is a bare ISO date prints as a date,
 * whatever the template says.
 */
describe('bindingResolver — dates', () => {
  it('formats a bound timestamp that carries no filter', () => {
    // The exact value, and the exact binding, that reached a client's cover.
    expect(resolveBindable('Prepared {{report.generatedDate}}', ctx({
      report: { generatedDate: '2026-08-16T08:58:56.946Z' },
    }))).toBe('Prepared 16 Aug 2026');
  });

  it('formats a bare ISO date too', () => {
    // `client_address_history.start_date` is a Postgres `date`, so it arrives
    // as `2016-02-14` — a machine date on a client-facing page just the same.
    expect(resolveBindable('{{h.startDate}}', ctx({ h: { startDate: '2016-02-14' } })))
      .toBe('14 Feb 2016');
  });

  it('leaves an explicit filter alone, including the machine form', () => {
    const data = ctx({ r: { d: '2026-08-16T08:58:56.946Z' } });
    expect(resolveBindable('{{r.d | date}}', data)).toBe('16 Aug 2026');
    expect(resolveBindable('{{r.d | date:long}}', data)).toBe('16 August 2026');
    expect(resolveBindable('{{r.d | date:short}}', data)).toBe('16/08/2026');
    // The escape hatch: an author who wants the machine form asks for it.
    expect(resolveBindable('{{r.d | date:iso}}', data)).toBe('2026-08-16');
  });

  it('does not rewrite a date inside prose', () => {
    // Whole-value only. A model citing a date in a sentence is writing, and
    // editing an author's words is not this function's business.
    const prose = 'Rates were held on 2026-08-16 and again in September.';
    expect(resolveBindable('{{note}}', ctx({ note: prose }))).toBe(prose);
  });

  it('leaves anything that is not a date', () => {
    expect(resolveBindable('{{v}}', ctx({ v: '12 Harbour St' }))).toBe('12 Harbour St');
    expect(resolveBindable('{{v}}', ctx({ v: '2026-13-45' }))).toBe('2026-13-45');
    expect(resolveBindable('{{v}}', ctx({ v: '1600000' }))).toBe('1600000');
  });

  /*
   * The timezone half is a separate defect the same change fixes.
   *
   * `new Date('2016-02-14')` is midnight UTC, and `toLocaleDateString` renders
   * it in the runtime's zone — so the old filter printed a client's move-in
   * date one day early on every render west of UTC. These documents are
   * typeset in the operator's browser, so the zone is whoever is at the
   * keyboard. The date on a client's page is not theirs to move.
   */
  describe('read, never parsed', () => {
    /*
     * The zone is passed to `toLocaleDateString` explicitly rather than set
     * through `process.env.TZ`, so these assertions do not depend on whether
     * the runtime re-reads that variable. Asserting only that `formatIsoDate`
     * is stable across zones would be vacuous — it has no `Date` in it and
     * could not vary — so each case states what the old path produced beside
     * what the new one does.
     */
    const parsed = (iso: string, timeZone: string) => new Date(iso)
      .toLocaleDateString('en-AU', { timeZone, day: '2-digit', month: 'short', year: 'numeric' });

    it('gives the day the record names, where parsing did not', () => {
      // A Postgres `date` — `client_address_history.start_date` — is midnight
      // UTC once parsed, so every zone west of UTC loses a day.
      expect(parsed('2016-02-14', 'Pacific/Honolulu')).toBe('13 Feb 2016');
      expect(parsed('2016-02-14', 'Australia/Sydney')).toBe('14 Feb 2016');
      expect(formatIsoDate('2016-02-14')).toBe('14 Feb 2016');
    });

    it('holds for a morning timestamp too', () => {
      // `2026-08-16T08:58:56.946Z` is still 15 August in Honolulu.
      expect(parsed('2026-08-16T08:58:56.946Z', 'Pacific/Honolulu')).toBe('15 Aug 2026');
      expect(formatIsoDate('2026-08-16T08:58:56.946Z')).toBe('16 Aug 2026');
    });

    it('is the same implementation the flowing render routes use', () => {
      /*
       * The real function, imported — not a copy written here.
       *
       * The first version of this test declared its own `formatReportDate`
       * with a SHORT month table and asserted the two were equal. They are
       * not: every flowing route prints `16 August 2026` and this filter's
       * default is `16 Aug 2026`. The test passed because it was comparing
       * against something nothing runs, which is the whole failure mode this
       * file exists to catch.
       *
       * They are one implementation now, and they still spell a date
       * differently on purpose — that is the `style` argument. `long` is what
       * a flowing route prints, and this pins the two together at that style
       * so the shared module cannot be changed for one caller alone.
       */
      for (const iso of ['2016-02-14', '2026-08-16T08:58:56.946Z', '2026-12-01T23:59:59+11:00']) {
        expect(formatIsoDate(iso, 'long'), iso).toBe(formatReportDate(iso));
        expect(formatIsoDate(iso), iso).not.toBe(formatReportDate(iso));
      }
      expect(formatReportDate('2026-08-16T08:58:56.946Z')).toBe('16 August 2026');
      expect(formatIsoDate('2026-08-16T08:58:56.946Z')).toBe('16 Aug 2026');
    });
  });

  it('recognises exactly the bare ISO forms', () => {
    for (const v of ['2026-08-16', '2026-08-16T08:58:56.946Z', '2026-08-16T08:58', '2026-08-16 08:58:56+10:00']) {
      expect(isIsoDateValue(v), v).toBe(true);
    }
    for (const v of ['on 2026-08-16', '2026-08-16 and later', '16/08/2026', '', 'August']) {
      expect(isIsoDateValue(v), v).toBe(false);
    }
  });

  it('formats a table cell the same way', () => {
    // `autoColumns` declares no format, so a table built from a row's own keys
    // — where a `created_at` is most likely to turn up — lands on `auto`.
    expect(formatCell('2026-08-16T08:58:56.946Z')).toBe('16 Aug 2026');
    expect(formatCell('2016-02-14', 'date')).toBe('14 Feb 2016');
    // A column that asked for the string still gets the string.
    expect(formatCell('2016-02-14', 'text')).toBe('2016-02-14');
  });
});
