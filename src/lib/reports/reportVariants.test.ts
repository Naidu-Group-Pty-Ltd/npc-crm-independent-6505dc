import { describe, expect, it } from 'vitest';
import { CLIENT_REPORT_VARIANTS, REPORT_TYPE_CONFIG, REPORT_VARIANT_ORDER, getCanonicalReportType, getReportVariantLabel, isClientReportVariant, normalizeComparableReportType, normalizeReportType, resolveInvestmentReportType } from './reportVariants';
import { buildGeneratedReportGroups } from './generatedReportGroups';

describe('canonical report type system', () => {
  it('assigns every supported report type a distinct semantic style', () => {
    const styles = REPORT_VARIANT_ORDER.map(type => REPORT_TYPE_CONFIG[type].className);
    expect(new Set(styles).size).toBe(REPORT_VARIANT_ORDER.length);
  });
  it.each([['FIN', 'financial'], ['finance', 'financial'], ['PLDD', 'strategic'], ['brief', 'briefing'], ['snap', 'snapshot'], ['full', 'compass']])('normalizes %s to %s', (input, expected) => expect(normalizeReportType(input)).toBe(expected));
  it('safely treats an unrecognized report identifier as Other', () => expect(getCanonicalReportType('legacy-unknown')).toBe('other'));
  it('uses only persisted report_tier for comparison compatibility', () => {
    expect(normalizeComparableReportType({ report_tier: 'financial_report' })).toBe('financial');
    expect(normalizeComparableReportType({ report_tier: 'strategy' })).toBe('strategic');
    expect(normalizeComparableReportType({ report_tier: 'unsupported' })).toBeUndefined();
    expect(normalizeComparableReportType({})).toBeUndefined();
  });

  it('prefers an explicit specific tier over a legacy Compass engine', () => {
    expect(resolveInvestmentReportType({ report_variant: 'composite', report_tier: 'SNAP' })).toBe('snapshot');
    expect(resolveInvestmentReportType({ report_variant: 'compass', report_tier: 'BRIEF' })).toBe('briefing');
  });
  it('reads historical metadata aliases without exposing them', () => {
    const report = { report_variant: 'compass', metadata: { reportType: 'PLDD' } };
    expect(resolveInvestmentReportType(report)).toBe('strategic');
    expect(getReportVariantLabel(report)).toBe('Strategic');
  });
  it('keeps genuine base reports Compass and presents unknown types as Other', () => {
    expect(resolveInvestmentReportType({ report_variant: 'investment_report' })).toBe('compass');
    expect(resolveInvestmentReportType({ report_variant: 'experimental_v3' })).toBeUndefined();
    expect(getReportVariantLabel({ report_variant: 'experimental_v3' })).toBe('Other');
  });
  it('limits independent client variants to the four supported derived reports', () => {
    expect(CLIENT_REPORT_VARIANTS).toEqual(['financial', 'strategic', 'briefing', 'snapshot']);
    expect(CLIENT_REPORT_VARIANTS.every(isClientReportVariant)).toBe(true);
    expect(isClientReportVariant('compass')).toBe(false);
    expect(isClientReportVariant('PLDD')).toBe(false);
  });
  it('deduplicates and orders package badges using canonical report types', () => {
    const reports = ['briefing', 'snapshot', 'PLDD', 'FIN', 'compass', 'finance'].map((report_tier, index) => ({ id: String(index), property_address: '1 Test St', property_listing_id: 'property-1', created_at: new Date(2026, 0, index + 1).toISOString(), current_version: 1, report_tier, status: 'completed' }));
    expect(buildGeneratedReportGroups(reports).at(0)?.reportTypes).toEqual(['compass', 'financial', 'strategic', 'snapshot', 'briefing']);
    expect(resolveInvestmentReportType({ report_tier: 'PLDD' })).toBe('strategic');
  });
});
