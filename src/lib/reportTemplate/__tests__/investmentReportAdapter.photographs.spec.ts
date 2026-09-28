/**
 * The Investment adapter binds the property's photographs where the masters look.
 *
 * Kept apart from the inlining spec: the adapter's other readers (the brand
 * assets, the structure guide) use the network too, so the photograph step is
 * replaced at its own module boundary rather than by stubbing `fetch` for the
 * whole adapter.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSecureFunction, inlineSpy } = vi.hoisted(() => ({
  invokeSecureFunction: vi.fn(),
  inlineSpy: vi.fn(async () => [] as string[]),
}));
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction }));
vi.mock('../adapters/reportPhotographs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../adapters/reportPhotographs')>()),
  inlineReportPhotographs: (...args: unknown[]) => inlineSpy(...(args as [])),
}));

import { investmentReportAdapter } from '../adapters/investmentReportAdapter';

describe('the Investment adapter binds them where the masters look', () => {
  const row = {
    id: 'report-p',
    report_scope: 'address',
    report_tier: 'compass',
    report_variant: 'compass',
    property_address: '60 Lawley Street, Spalding WA 6530',
    property_listing_id: 'recAbCdEfGhIjKlMn',
    property_specs: { bedrooms: 4 },
    report_content: '# 1. Summary\n\nProse.\n',
  };

  beforeAll(async () => {
    // The projection graph loads behind lazy imports on the first call — see
    // `investmentReportAdapter.spec.ts` — so it is paid once, here.
    invokeSecureFunction.mockResolvedValue({ data: { report: row }, error: null });
    await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    inlineSpy.mockImplementation(async () => []);
  });

  it('asks the broker for the photographs with the report, in one read', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { report: row }, error: null });
    await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'get-investment-reports',
      expect.objectContaining({ reportId: 'report-p', photographs: true }),
    );
  });

  it('PRESERVATION — a report with no photographs binds no images, and keeps the property it had', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { report: row }, error: null });
    const ctx = await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    const property = (ctx?.data as { property?: Record<string, unknown> }).property ?? {};
    expect(property.images).toBeUndefined();
    expect(property.bedrooms).toBe(4);
  });

  it('binds the inlined photographs as `property.images`, lead first', async () => {
    const photographs = [
      { url: 'https://project.supabase.co/storage/v1/object/sign/listing-images/a.jpg?token=t', width: 2048, height: 1365 },
      { url: 'https://project.supabase.co/storage/v1/object/sign/listing-images/b.jpg?token=t', width: 2048, height: 1365 },
    ];
    inlineSpy.mockImplementation(async () => ['data:image/jpeg;base64,LEAD', 'data:image/jpeg;base64,SECOND']);
    invokeSecureFunction.mockResolvedValue({ data: { report: row, photographs }, error: null });
    const ctx = await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    expect(inlineSpy).toHaveBeenCalledWith(photographs);
    const property = (ctx?.data as { property?: Record<string, unknown> }).property ?? {};
    expect(property.images).toEqual(['data:image/jpeg;base64,LEAD', 'data:image/jpeg;base64,SECOND']);
    expect(property.bedrooms).toBe(4);
  });

  it('binds the floor plans apart, as `property.floorPlans`, and never among the photographs', async () => {
    const photographs = [{ url: 'https://project.supabase.co/storage/v1/object/sign/listing-images/a.jpg?token=t', width: 2048, height: 1365 }];
    const floorPlans = [{ url: 'https://project.supabase.co/storage/v1/object/sign/listing-images/plans/p.png?token=t', width: 1199, height: 751 }];
    inlineSpy.mockImplementation(async (...args: unknown[]) =>
      (args[0] === floorPlans ? ['data:image/png;base64,PLAN'] : ['data:image/jpeg;base64,LEAD']));
    invokeSecureFunction.mockResolvedValue({ data: { report: row, photographs, floorPlans }, error: null });
    const ctx = await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    const property = (ctx?.data as { property?: Record<string, unknown> }).property ?? {};
    expect(property.images).toEqual(['data:image/jpeg;base64,LEAD']);
    expect(property.floorPlans).toEqual(['data:image/png;base64,PLAN']);
    expect(property.bedrooms).toBe(4);
  });

  it('a report with no floor plan binds none, and a broker that sends none changes nothing', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { report: row, photographs: [] }, error: null });
    const ctx = await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    const property = (ctx?.data as { property?: Record<string, unknown> }).property ?? {};
    expect(property.floorPlans).toBeUndefined();
  });

  it('photographs that could not be inlined leave the property exactly as it was', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: { report: row, photographs: [{ url: 'https://project.supabase.co/storage/v1/object/sign/x.jpg' }] },
      error: null,
    });
    const ctx = await investmentReportAdapter.buildBindingContext({ reportId: 'report-p' });
    expect(ctx).not.toBeNull();
    expect(((ctx?.data as { property?: Record<string, unknown> }).property ?? {}).images).toBeUndefined();
  });

  it('the photographs are bound under the name every photographic master reads', () => {
    // `plateSrc`/`coverHero` bind `{{property.images.N}}`; a different key here
    // would fill nothing and look exactly like a report with no photographs.
    const blocks = readFileSync('scripts/template-library/investmentCompass/blocks.ts', 'utf8');
    expect(blocks).toContain('`{{property.images.${index}}}`');
  });
});
