import { describe, expect, it } from 'vitest';
import { eligiblePortfolioReports } from '../sendPortfolioEligibility';

describe('eligiblePortfolioReports', () => {
  it('keeps only completed reports for the canonical client and selects newest first', () => {
    const reports = eligiblePortfolioReports([
      { id: 'older', client_id: 'client-a', created_at: '2026-07-01T00:00:00Z', status: 'completed', pdf_file_path: 'a.pdf' },
      { id: 'other-client', client_id: 'client-b', created_at: '2026-07-03T00:00:00Z', status: 'completed', pdf_file_path: 'b.pdf' },
      { id: 'generating', client_id: 'client-a', created_at: '2026-07-04T00:00:00Z', status: 'generating', pdf_file_path: null },
      { id: 'newest', client_id: 'client-a', created_at: '2026-07-02T00:00:00Z', status: 'completed', pdf_file_path: 'c.pdf' },
    ], 'client-a');
    expect(reports.map(report => report.id)).toEqual(['newest', 'older']);
  });
});
