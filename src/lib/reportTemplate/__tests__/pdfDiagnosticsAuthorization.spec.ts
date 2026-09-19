import { describe, expect, it } from 'vitest';

import { isPdfDiagnosticsPathOwnedByJob } from '../../../../supabase/functions/_shared/pdfDiagnosticsAuthorization.pure';

describe('PDF diagnostics artifact authorization', () => {
  const jobId = '11111111-1111-4111-8111-111111111111';

  it('accepts only objects nested under the authorized job prefix', () => {
    expect(isPdfDiagnosticsPathOwnedByJob(`${jobId}/pages-manifest.json`, jobId)).toBe(true);
    expect(isPdfDiagnosticsPathOwnedByJob(`pdf-import-diagnostics/${jobId}/pages/1/raster.png`, jobId)).toBe(true);
  });

  it('rejects another job and prefix-confusion paths', () => {
    expect(isPdfDiagnosticsPathOwnedByJob('22222222-2222-4222-8222-222222222222/pages/1/ocr.json', jobId)).toBe(false);
    expect(isPdfDiagnosticsPathOwnedByJob(`${jobId}-attacker/pages/1/ocr.json`, jobId)).toBe(false);
  });

  it('rejects traversal and malformed paths', () => {
    expect(isPdfDiagnosticsPathOwnedByJob(`${jobId}/../victim/pages/1/raster.png`, jobId)).toBe(false);
    expect(isPdfDiagnosticsPathOwnedByJob(`${jobId}\\..\\victim\\raster.png`, jobId)).toBe(false);
    expect(isPdfDiagnosticsPathOwnedByJob(`${jobId}//pages-manifest.json`, jobId)).toBe(false);
  });
});
