/**
 * What a caller may send, and what the file is called.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_SEGMENTS,
  marketIntelligenceFileName,
  marketIntelligenceReference,
  marketIntelligenceStoragePath,
  parseRenderRequest,
  STORAGE_BUCKET,
} from '../route.pure';
import { REPORT_ID } from './fixtures';

const parse = (body: unknown) => parseRenderRequest(body);

describe('parseRenderRequest', () => {
  it('accepts a uuid and nothing else is required', () => {
    const result = parse({ reportId: REPORT_ID });
    expect(result.ok).toBe(true);
    expect(result.ok && result.request).toEqual({
      reportId: REPORT_ID,
      persist: true,
      edition: null,
      audience: null,
    });
  });

  it('refuses anything that is not a uuid', () => {
    for (const bad of [null, 'string', {}, { reportId: '' }, { reportId: 'not-a-uuid' }]) {
      expect(parse(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('persists by default, because the email dispatch reads that column', () => {
    expect(parse({ reportId: REPORT_ID }).ok
      && (parse({ reportId: REPORT_ID }) as { ok: true; request: { persist: boolean } }).request.persist)
      .toBe(true);
    const off = parse({ reportId: REPORT_ID, persist: false });
    expect(off.ok && off.request.persist).toBe(false);
  });

  it('accepts the three editions and falls back to the row for anything else', () => {
    for (const audience of AUDIENCE_SEGMENTS) {
      const result = parse({ reportId: REPORT_ID, audience });
      expect(result.ok && result.request.audience).toBe(audience);
    }
    // Not an error: a stale bookmark should still produce the report it names.
    for (const bad of ['landlord', '', 42, null]) {
      const result = parse({ reportId: REPORT_ID, audience: bad });
      expect(result.ok && result.request.audience, String(bad)).toBeNull();
    }
  });

  it('is case-insensitive about the edition', () => {
    const result = parse({ reportId: REPORT_ID, audience: 'Investor' });
    expect(result.ok && result.request.audience).toBe('investor');
  });

  it('does not accept a payload — everything else is read server-side', () => {
    const result = parse({ reportId: REPORT_ID, report_data: { executiveSummary: 'injected' } });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.ok ? result.request : {})).toEqual(
      ['reportId', 'persist', 'edition', 'audience'],
    );
  });

  it('caps the edition line', () => {
    const result = parse({ reportId: REPORT_ID, edition: 'x'.repeat(200) });
    expect(result.ok && result.request.edition!.length).toBe(40);
  });
});

describe('the filename', () => {
  it('names the report and its period', () => {
    expect(marketIntelligenceFileName('April 2026', 'general'))
      .toBe('Market_Intelligence_Report_April_2026.pdf');
  });

  it('sanitises a period a locale could return with a slash in it', () => {
    // The period comes from `toLocaleDateString('en-AU', …)` server-side. It is
    // `April 2026` today, but it is a locale call, and the legacy only replaces
    // whitespace — so a locale returning `4/2026` would put a separator in a
    // filename.
    const name = marketIntelligenceFileName('4/2026', 'general');
    expect(name).not.toContain('/');
    expect(name).toBe('Market_Intelligence_Report_4_2026.pdf');
  });

  it('marks a named edition and leaves the general one unmarked', () => {
    expect(marketIntelligenceFileName('April 2026', 'investor')).toContain('_investor');
    expect(marketIntelligenceFileName('April 2026', 'general')).not.toContain('general');
  });

  it('still produces a name with no period at all', () => {
    expect(marketIntelligenceFileName('', '')).toBe('Market_Intelligence_Report_Report.pdf');
  });
});

describe('the storage path', () => {
  it('is stable per report, so a re-render replaces the current PDF', () => {
    // Unlike every other format, which carries a random segment. Here
    // `pdf_storage_path` is one column holding one location and the email
    // dispatch reads whatever is there.
    const name = marketIntelligenceFileName('April 2026', 'general');
    const a = marketIntelligenceStoragePath(REPORT_ID, name);
    const b = marketIntelligenceStoragePath(REPORT_ID, name);
    expect(a).toBe(b);
    expect(a.startsWith(`market-intelligence/${REPORT_ID}/`)).toBe(true);
  });

  it('lands in the bucket the email dispatch already reads', () => {
    expect(STORAGE_BUCKET).toBe('marketing-reports');
  });
});

describe('the cover reference', () => {
  it('is the first eight characters of the id, uppercased', () => {
    expect(marketIntelligenceReference(REPORT_ID)).toBe('33333333');
    expect(marketIntelligenceReference('abcdef12-0000-4000-8000-000000000000')).toBe('ABCDEF12');
  });
});
