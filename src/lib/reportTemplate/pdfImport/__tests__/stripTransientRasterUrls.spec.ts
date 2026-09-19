import { describe, expect, it } from 'vitest';
import type { ReportTemplate } from '../../templateSchema';
import { stripTransientRasterUrls } from '../stripTransientRasterUrls';

function templateWithPages(pages: Array<Record<string, unknown>>): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages,
  } as unknown as ReportTemplate;
}

describe('stripTransientRasterUrls', () => {
  it('removes a signed background URL when a durable raster path is present', () => {
    const input = templateWithPages([{
      id: 'p1',
      background: { color: '#fff', imageUrl: 'https://storage.test/signed?page=1' },
      meta: { sourceRasterRef: { path: 'job-1/pages/page-1.png' } },
    }]);

    const output = stripTransientRasterUrls(input);

    expect(output.pages[0].background).toEqual({ color: '#fff' });
    expect((output.pages[0].meta as any).sourceRasterRef.path).toBe('job-1/pages/page-1.png');
    expect(input.pages[0].background?.imageUrl).toBe('https://storage.test/signed?page=1');
  });

  it('preserves backgrounds that have no durable PDF-import raster reference', () => {
    const input = templateWithPages([{
      id: 'p1',
      background: { imageUrl: 'https://assets.test/decorative.png' },
      meta: {},
    }]);

    expect(stripTransientRasterUrls(input)).toBe(input);
    expect(input.pages[0].background?.imageUrl).toBe('https://assets.test/decorative.png');
  });
});
