import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSecureFunction } = vi.hoisted(() => ({
  invokeSecureFunction: vi.fn(),
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction,
}));

import { investmentReportAdapter } from '../adapters/investmentReportAdapter';

describe('investmentReportAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes Compass rows through the canonical Compass report type', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: {
        report: {
          id: 'report-1',
          report_scope: 'address',
          report_tier: 'compass',
          report_variant: 'compass',
        },
      },
      error: null,
    });

    await expect(investmentReportAdapter.resolveRoutingContext({ reportId: 'report-1' }))
      .resolves.toEqual(expect.objectContaining({ reportType: 'investment_compass' }));
  });

  /*
   * This test used to assert `reportType: 'address'` under the name
   * "preserves report scope routing for non-Compass rows" — which is a
   * description of the defect, not of a contract.
   *
   * `investment_reports` has `report_tier`, `report_variant` and
   * `report_scope`, and has never had a `report_type`. So the old expression
   * fell through to `report_scope`, which is a GEOGRAPHY, not a format. Read
   * from production on 2026-08-16:
   *
   *   | tier      | rows | scopes present  |
   *   | compass   | 1124 | address, suburb |
   *   | snapshot  |   24 | address         |
   *   | briefing  |   21 | address         |
   *   | financial |    9 | address         |
   *   | strategic |    9 | address         |
   *
   * All 63 non-compass rows resolved to `address`, which matches no adapter,
   * no entry in `REPORT_TYPE_ALIASES` and no row in `report_templates` — so
   * `routeReportThroughTemplate` refused with `no_active_template` and fell
   * back to the legacy generator on every one of them.
   *
   * All five tiers are one format. The assertion now pins that, so a scope
   * cannot be mistaken for a format again.
   */
  it('routes every non-Compass tier to the investment format, never to a scope', async () => {
    for (const tier of ['snapshot', 'briefing', 'financial', 'strategic']) {
      invokeSecureFunction.mockResolvedValue({
        data: {
          report: {
            id: 'report-2',
            report_scope: 'address',
            report_tier: tier,
            report_variant: tier,
          },
        },
        error: null,
      });

      const ctx = await investmentReportAdapter.resolveRoutingContext({ reportId: 'report-2' });
      expect(ctx, tier).toEqual(expect.objectContaining({ reportType: 'investment' }));
      // A geography must never reach the router as a format.
      expect(ctx?.reportType, tier).not.toBe('address');
      expect(ctx?.reportType, tier).not.toBe('suburb');
      // The tier itself is still carried — it selects the variant, not the format.
      expect(ctx?.tier, tier).toBe(tier);
    }
  });

  it('does not let a suburb-scoped Compass row become a suburb format', async () => {
    // `suburb` is a scope AND a category, which is the whole reason the
    // confusion was possible. 1,124 compass rows span both scopes.
    invokeSecureFunction.mockResolvedValue({
      data: {
        report: {
          id: 'report-3',
          report_scope: 'suburb',
          report_tier: 'compass',
          report_variant: 'compass',
        },
      },
      error: null,
    });

    await expect(investmentReportAdapter.resolveRoutingContext({ reportId: 'report-3' }))
      .resolves.toEqual(expect.objectContaining({ reportType: 'investment_compass' }));
  });
});

describe('investmentReportAdapter — the "Include scoring" switch reaches the bound values', () => {
  const row = {
    id: 'report-9',
    report_scope: 'address',
    report_tier: 'compass',
    report_variant: 'compass',
    property_address: '291 Stone Mason Drive, Kellyville NSW 2155',
    report_content: '# 1. Summary\n\nProse.\n',
    investment_score: { grade: 'B+', totalScore: 68, policy: { gradeIssued: true, authority: 'v2' } },
  };

  const scoresOf = (ctx: Awaited<ReturnType<typeof investmentReportAdapter.buildBindingContext>>) =>
    ((ctx?.data as { scores?: Record<string, unknown> })?.scores ?? {});

  /*
   * The first call through the adapter loads the projection graph — the
   * financial reconciler, the narrative planner, the chart primitives —
   * behind its lazy imports: 278 ms on a warm machine, and past the 5 s
   * default on a CI runner transforming 326 spec files at once, which is
   * where this describe first timed out (15 Sep 2026). The import is paid
   * here, once, under a budget that says so; every test below then measures
   * the switch and nothing else (12 ms each, warm).
   */
  beforeAll(async () => {
    invokeSecureFunction.mockResolvedValue({ data: { report: row }, error: null });
    await investmentReportAdapter.buildBindingContext({ reportId: 'report-9' });
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSecureFunction.mockResolvedValue({ data: { report: row }, error: null });
  });

  it('carries the score by default', async () => {
    const def = await investmentReportAdapter.buildBindingContext({ reportId: 'report-9' });
    expect(scoresOf(def).grade).toBe('B+');
  });

  it('carries the score when the switch is on', async () => {
    const on = await investmentReportAdapter.buildBindingContext({ reportId: 'report-9', payload: { includeScoring: true } });
    expect(scoresOf(on).grade).toBe('B+');
  });

  it('draws no score anywhere when the switch is off — the same document the standard presentation prints', async () => {
    const off = await investmentReportAdapter.buildBindingContext({ reportId: 'report-9', payload: { includeScoring: false } });
    const scores = scoresOf(off);
    expect(scores.grade).toBeUndefined();
    expect(scores.totalScore).toBeUndefined();
    expect(Object.keys(scores)).toEqual([]);
  });
});
