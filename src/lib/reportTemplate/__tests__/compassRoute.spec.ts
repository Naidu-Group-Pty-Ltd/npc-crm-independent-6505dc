import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveReportTemplate, resolveRoutingContext } = vi.hoisted(() => ({
  resolveReportTemplate: vi.fn(),
  resolveRoutingContext: vi.fn(),
}));

vi.mock('../adapters', () => ({
  getAdapter: () => ({
    reportType: 'investment',
    supportsProduction: true,
    resolveRoutingContext,
    buildBindingContext: vi.fn(),
  }),
  listAdapters: () => [],
}));

vi.mock('../resolveTemplate', () => ({
  resolveReportTemplate,
}));

import { tryRouteThroughTemplateBuilder } from '../compassRoute';

describe('Compass Template Builder route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not resolve a template for a non-Compass report', async () => {
    resolveRoutingContext.mockResolvedValue({
      reportId: 'report-1',
      reportType: 'feasibility_study',
      variant: null,
      tier: null,
    });

    await expect(tryRouteThroughTemplateBuilder('report-1')).resolves.toBeNull();
    expect(resolveReportTemplate).not.toHaveBeenCalled();
  });

  it('continues resolving approved Compass reports', async () => {
    resolveRoutingContext.mockResolvedValue({
      reportId: 'report-2',
      reportType: 'investment_compass',
      variant: null,
      tier: 'compass',
    });
    resolveReportTemplate.mockResolvedValue(null);

    await expect(tryRouteThroughTemplateBuilder('report-2')).resolves.toBeNull();
    expect(resolveReportTemplate).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'investment_compass',
    }));
  });
});
