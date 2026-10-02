import { describe, expect, it } from 'vitest';
import { fileSafeSegment, investmentReportFileName } from '../reportFileName.pure';
import { DOCUMENT_IDENTITY, documentTitleForTier } from '../../../../../supabase/functions/_shared/reportBindingProjection.pure';

/**
 * A downloaded Investment-family document is named by what it is, whose it is
 * and when — never by a uuid and a clock (QA-32; the five files of 15 Sep 2026
 * arrived as `9edb63bd-…_291_STONE_MASON_DRIVE_NSW_1789434458098.pdf`) — and
 * in words, the way every other format names its file (Audit 6).
 */
describe('investmentReportFileName', () => {
  const at = new Date('2026-09-15T02:30:00Z');
  const address = '291 Stone Mason Drive, Kellyville NSW 2155';

  it('names the file by tier word, whole address and date', () => {
    expect(investmentReportFileName({ tier: 'strategic', address, at }))
      .toBe('Due Diligence Report - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf');
    expect(investmentReportFileName({ tier: 'financial', address, at }))
      .toBe('Financial Analysis - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf');
    expect(investmentReportFileName({ tier: 'briefing', address, at }))
      .toBe('Executive Briefing - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf');
    expect(investmentReportFileName({ tier: 'snapshot', address, at }))
      .toBe('Snapshot Report - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf');
    expect(investmentReportFileName({ tier: 'compass', address, at }))
      .toBe('Investment Compass - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf');
  });

  it('carries no uuid and no epoch, and no placeholder where there is no address', () => {
    const name = investmentReportFileName({ tier: null, address: null, at });
    expect(name).toBe('Investment Compass - 15 Sep 2026.pdf');
  });

  it('reads no clock of its own — the instant is the caller\'s', () => {
    const name = investmentReportFileName({ tier: 'snapshot', address: 'x', at: new Date('2031-01-02T23:59:59Z') });
    expect(name).toBe('Snapshot Report - x - 02 Jan 2031.pdf');
    const again = investmentReportFileName({ tier: null, address: null, at });
    expect(again).toBe('Investment Compass - 15 Sep 2026.pdf');
    expect(again).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(again).not.toMatch(/\d{13}/);
  });

  it('says what this copy is beside the document\'s name', () => {
    expect(investmentReportFileName({ tier: 'compass', address: '1 Test St', at, suffix: 'flattened' }))
      .toBe('Investment Compass - flattened - 1 Test St - 15 Sep 2026.pdf');
    expect(investmentReportFileName({ tier: 'compass', address: '1 Test St', at, suffix: 'Version 2' }))
      .toBe('Investment Compass - Version 2 - 1 Test St - 15 Sep 2026.pdf');
  });

  it('is the same word the cover carries — one identity, from DOCUMENT_IDENTITY', () => {
    for (const tier of Object.keys(DOCUMENT_IDENTITY)) {
      expect(investmentReportFileName({ tier, address, at }).startsWith(`${documentTitleForTier(tier)} - `)).toBe(true);
    }
    // Locked decision B: the strategic tier is the Due Diligence Report wherever a person sees it.
    expect(documentTitleForTier('strategic')).toBe('Due Diligence Report');
    expect(documentTitleForTier('nonsense')).toBe(DOCUMENT_IDENTITY.compass.title);
  });

  it('fileSafeSegment applies the shared rule', () => {
    expect(fileSafeSegment('  Unit 4/12 O\'Brien St, St Kilda VIC 3182 ')).toBe('Unit_4_12_O_Brien_St_St_Kilda_VIC_3182');
    expect(fileSafeSegment('x'.repeat(100), 10)).toBe('xxxxxxxxxx');
  });
});
