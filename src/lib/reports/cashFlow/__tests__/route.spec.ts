/**
 * The request contract and the filename contract.
 *
 * The filename is the one a client sees in their downloads folder, so it is
 * pinned here rather than left to whatever the renderer happens to produce.
 */
import { describe, expect, it } from 'vitest';

import {
  cashFlowFileName,
  cashFlowStoragePath,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
} from '../route.pure';
import { cashFlowSections, cashFlowSpine, validateCashFlowSpine } from '../sections.pure';

const REPORT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PROJECTION = { years: [{ year: 1 }] };

describe('parseRenderRequest', () => {
  it('accepts a well-formed request', () => {
    const parsed = parseRenderRequest({ reportId: REPORT_ID, projection: PROJECTION });
    expect(parsed).toEqual({
      ok: true,
      request: { reportId: REPORT_ID, projection: PROJECTION, edition: null },
    });
  });

  it('refuses anything that is not a uuid', () => {
    for (const bad of ['', '  ', 'not-a-uuid', 42, null, undefined]) {
      const parsed = parseRenderRequest({ reportId: bad, projection: PROJECTION });
      expect(parsed.ok).toBe(false);
    }
  });

  it('refuses a request with no projection', () => {
    expect(parseRenderRequest({ reportId: REPORT_ID }).ok).toBe(false);
    expect(parseRenderRequest({ reportId: REPORT_ID, projection: 'years' }).ok).toBe(false);
  });

  it('refuses a body that is not an object at all', () => {
    for (const bad of [null, undefined, 'x', 7]) {
      expect(parseRenderRequest(bad)).toEqual({ ok: false, error: 'invalid json' });
    }
  });

  it('caps the edition rather than rejecting a long one', () => {
    const parsed = parseRenderRequest({ reportId: REPORT_ID, projection: PROJECTION, edition: 'x'.repeat(200) });
    expect(parsed.ok && parsed.request.edition?.length).toBe(40);
  });

  /**
   * The address and the client name are read from the database, never from the
   * caller. If either ever becomes an accepted field, this fails.
   */
  it('ignores a property address or client name sent by the caller', () => {
    const parsed = parseRenderRequest({
      reportId: REPORT_ID,
      projection: PROJECTION,
      propertyAddress: 'Somewhere else',
      clientName: 'Someone else',
    });
    expect(parsed.ok && Object.keys(parsed.request).sort())
      .toEqual(['edition', 'projection', 'reportId']);
  });
});

describe('cashFlowFileName', () => {
  it('keeps the shape the product already produces', () => {
    expect(cashFlowFileName('14 Wattlebird Grove, Marsden Park NSW 2765', '2026-08-02T04:00:00Z'))
      .toBe('Cash_Flow_Analysis_14_Wattlebird_Grove__Marsden_Park_NSW_2765_2026-08-02.pdf');
  });

  it('names the file for a property it was given no name for', () => {
    expect(cashFlowFileName('', '2026-08-02T00:00:00Z')).toBe('Cash_Flow_Analysis_Property_2026-08-02.pdf');
  });

  it('does not carry a date it cannot read', () => {
    expect(cashFlowFileName('A', 'not a date')).toBe('Cash_Flow_Analysis_A_.pdf');
  });
});

describe('cashFlowStoragePath', () => {
  it('files the document under its report and its day', () => {
    expect(cashFlowStoragePath(REPORT_ID, 'Cash_Flow_Analysis_A_2026-08-02.pdf', '2026-08-02T09:00:00Z', 'abc'))
      .toBe(`cash-flow/${REPORT_ID}/2026-08-02/abc-Cash_Flow_Analysis_A_2026-08-02.pdf`);
  });

  it('does not lose the file when the date is unreadable', () => {
    expect(cashFlowStoragePath(REPORT_ID, 'f.pdf', '', 'abc'))
      .toBe(`cash-flow/${REPORT_ID}/undated/abc-f.pdf`);
  });

  it('links for a day, which is long enough to email', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(86_400);
  });
});

describe('the document spine', () => {
  // The spine validator counts the years against the stated term, so the
  // fixture carries as many as it claims.
  const projection = (over: Record<string, unknown> = {}) => {
    const meta = { propertyAddress: 'A', clientName: 'B', preparedOn: '2026-08-02T00:00:00Z', termYears: 10 };
    const merged = { meta, ...over } as { meta: typeof meta };
    return {
      narrative: '', acquisition: {}, yearOne: {}, outcome: {},
      years: Array.from({ length: merged.meta.termYears }, (_, i) => ({ year: i + 1 })),
      assumptions: [{ label: 'Capital growth', value: '4.5%' }],
      notes: [],
      ...over,
      meta: merged.meta,
    } as never;
  };

  it('is valid for its archetype', () => {
    expect(validateCashFlowSpine(projection())).toEqual([]);
  });

  it('opens with a cover and closes with the company page', () => {
    const spine = cashFlowSpine(projection());
    expect(spine[0].slot).toBe('cover');
    expect(spine[spine.length - 1].slot).toBe('closing');
  });

  it('puts the projection on the landscape page and nothing else', () => {
    const spine = cashFlowSpine(projection());
    expect(spine.filter((e) => e.slot === 'wide-table').map((e) => e.id)).toEqual(['projection']);
  });

  it('omits the assumptions section when there is nothing to assume', () => {
    const sections = cashFlowSections(projection({ assumptions: [], notes: [] }));
    expect(sections.map((s) => s.id)).toEqual(['position', 'projection', 'growth']);
    expect(validateCashFlowSpine(projection({ assumptions: [], notes: [] }))).toEqual([]);
  });

  it('keeps it when only a note needs saying', () => {
    const sections = cashFlowSections(projection({ assumptions: [], notes: ['Depreciation excluded.'] }));
    expect(sections.map((s) => s.id)).toContain('assumptions');
  });

  it('names the term in the section title, because a caller may not send ten years', () => {
    const sections = cashFlowSections(projection({
      meta: { propertyAddress: 'A', clientName: 'B', preparedOn: '', termYears: 7 },
    }));
    expect(sections.find((s) => s.id === 'projection')?.title).toBe('The 7-year projection');
  });
});
