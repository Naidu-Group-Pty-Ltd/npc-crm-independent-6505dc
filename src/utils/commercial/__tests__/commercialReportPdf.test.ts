import { describe, expect, it } from 'vitest';
import { fmtPct } from '../commercialReportPdf';

describe('commercial report percentage formatting', () => {
  it('renders unavailable nullable yields without throwing', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });

  it('preserves percentage formatting for valid yields', () => {
    expect(fmtPct(7.125)).toBe('7.13%');
  });
});
