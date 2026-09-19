/**
 * ME-6 zero-cost strategy — the acquisition footing, and the measured inventory.
 *
 * Two things are pinned here, and they fail for different reasons.
 *
 * The ACQUISITION rules are a contract: a trial measure must never acquire a
 * production right, and the default must be the conservative one. Those tests
 * fail when somebody widens the rule.
 *
 * The INVENTORY rules are about honesty: every row must carry a real
 * measurement, and no row may claim to supply a dimension its grain cannot
 * support. Those tests fail when somebody adds a source they have not measured
 * — which is the exact failure this programme has hit repeatedly, most
 * expensively when a complete sanctions register sat behind a load that had
 * never once succeeded.
 */
import { describe, it, expect } from 'vitest';
import {
  acquisitionOf,
  acquisitionLicensingConflict,
  mayEnterProductionEvidence,
  mayEnterShadowBacktest,
  mayReachClientReport,
  type EvidenceAcquisition,
  type EvidencePoint,
} from '@/lib/reports/market/marketEvidence.pure';
import {
  GROWTH_GRAINS,
  INVENTORY_MEASURED_ON,
  ZERO_COST_INVENTORY_VERSION,
  ZERO_COST_SOURCES,
  blockedByTransport,
  growthCapableToday,
  ingestableToday,
} from '@/lib/reports/market/zeroCostSources.pure';

const point = (over: Partial<EvidencePoint<number>> = {}): EvidencePoint<number> => ({
  value: 1,
  level: 'suburb',
  areaName: 'Traralgon',
  dwellingType: 'house',
  dwellingTypeMatched: true,
  provider: 'abs_res_dwell',
  asOf: '2026-Q2',
  sampleSize: null,
  periodsAvailable: null,
  method: 'observed',
  sourceNote: null,
  ...over,
});

describe('ME-6 — evidence acquisition footing', () => {
  it('defaults to licensing_unverified when no footing is declared', () => {
    expect(acquisitionOf(point())).toBe('licensing_unverified');
  });

  it('an undeclared footing is not production evidence', () => {
    expect(mayEnterProductionEvidence(point())).toBe(false);
  });

  it('admits only open_public and existing_licensed to production evidence', () => {
    const admitted: EvidenceAcquisition[] = ['open_public', 'existing_licensed'];
    const refused: EvidenceAcquisition[] = [
      'trial_shadow_only', 'commercial_upgrade_required', 'licensing_unverified',
    ];
    for (const a of admitted) {
      expect(mayEnterProductionEvidence(point({ acquisition: a })), a).toBe(true);
    }
    for (const a of refused) {
      expect(mayEnterProductionEvidence(point({ acquisition: a })), a).toBe(false);
    }
  });

  it('a trial measure may be shadow-scored but never becomes production evidence', () => {
    const trial = point({ acquisition: 'trial_shadow_only' });
    expect(mayEnterShadowBacktest(trial)).toBe(true);
    expect(mayEnterProductionEvidence(trial)).toBe(false);
  });

  it('refuses a shadow backtest only for a source that was never obtained', () => {
    expect(mayEnterShadowBacktest(point({ acquisition: 'commercial_upgrade_required' }))).toBe(false);
    expect(mayEnterShadowBacktest(point({ acquisition: 'licensing_unverified' }))).toBe(true);
  });

  it('refuses the combination that would let trial data reach a client', () => {
    for (const l of ['open', 'licensed_for_client_reports'] as const) {
      const conflict = acquisitionLicensingConflict(
        point({ acquisition: 'trial_shadow_only', licensingStatus: l }),
      );
      expect(conflict, l).not.toBeNull();
      expect(conflict).toMatch(/trial/i);
    }
  });

  it('refuses any licensing claim on a source behind an unpurchased upgrade', () => {
    expect(
      acquisitionLicensingConflict(
        point({ acquisition: 'commercial_upgrade_required', licensingStatus: 'internal_only' }),
      ),
    ).not.toBeNull();
  });

  it('allows the honest combinations', () => {
    expect(acquisitionLicensingConflict(
      point({ acquisition: 'open_public', licensingStatus: 'open' }),
    )).toBeNull();
    expect(acquisitionLicensingConflict(
      point({ acquisition: 'trial_shadow_only', licensingStatus: 'internal_only' }),
    )).toBeNull();
    expect(acquisitionLicensingConflict(
      point({ acquisition: 'commercial_upgrade_required' }),
    )).toBeNull();
  });

  it('leaves mayReachClientReport exactly as it was — no existing caller changes', () => {
    // The acquisition axis is additive. A point that declares only licensing
    // behaves identically to before this module existed.
    expect(mayReachClientReport(point())).toBe(false);
    expect(mayReachClientReport(point({ licensingStatus: 'open' }))).toBe(true);
    expect(mayReachClientReport(point({ licensingStatus: 'internal_only' }))).toBe(false);
  });
});

describe('ME-6 — the measured zero-cost inventory', () => {
  it('is versioned and carries the date its readings were taken', () => {
    expect(ZERO_COST_INVENTORY_VERSION).toBe('me6.zerocost.3');
    expect(INVENTORY_MEASURED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('every source carries a real measurement, never an assumption', () => {
    for (const s of ZERO_COST_SOURCES) {
      expect(s.measurement.length, s.id).toBeGreaterThan(40);
      expect(s.reachability, s.id).not.toBe('not_measured');
    }
  });

  it('no source claims to supply Growth at a grain the scorer does not price', () => {
    // A state mean price is context. Letting it read as Growth is precisely how
    // an "evidence-backed" score comes to rest on nothing about the suburb. A
    // council or postcode median is Growth at ITS grain — the scorer's
    // geography factor prices it (postcode 80, LGA 55) and every point names
    // the area it describes — which is why the rule stops at the state.
    const coarse = ['state', 'capital_city'];
    for (const s of ZERO_COST_SOURCES) {
      if (coarse.includes(s.grain)) expect(s.supplies, s.id).not.toBe('growth');
      if (s.supplies === 'growth') expect(GROWTH_GRAINS, s.id).toContain(s.grain);
    }
  });

  it('separates a licensing block from a transport block', () => {
    // Both look like "no data" and they send an operator to opposite remedies.
    for (const s of blockedByTransport()) {
      expect(s.acquisition, s.id).toBe('open_public');
      expect(s.reachability, s.id).not.toBe('reachable_production');
    }
    for (const s of ingestableToday()) {
      expect(['reachable_production', 'reachable_archive'], s.id).toContain(s.reachability);
      expect(s.acquisition, s.id).toBe('open_public');
    }
  });

  it('records Victoria as openly licensed, walled at the publisher, and reached through the archive', () => {
    const vic = ZERO_COST_SOURCES.find((s) => s.id === 'vic_property_sales_median_by_suburb');
    expect(vic).toBeDefined();
    expect(vic!.acquisition).toBe('open_public');
    expect(vic!.supplies).toBe('growth');
    expect(vic!.grain).toBe('suburb');
    expect(vic!.dwellingSegmented).toBe(true);
    expect(vic!.reachability).toBe('reachable_archive');
    // The measurement must name BOTH egresses (one refusal proves nothing) AND the route that answered.
    expect(vic!.measurement).toMatch(/production/i);
    expect(vic!.measurement).toMatch(/development/i);
    expect(vic!.measurement).toMatch(/Internet Archive/);
    expect(vic!.measurement).toMatch(/pg_net 245237/);
    const sa = ZERO_COST_SOURCES.find((s) => s.id === 'sa_metro_median_house_sales')!;
    expect(sa.reachability).toBe('reachable_archive');
    expect(sa.measurement).toMatch(/Internet Archive/);
    expect(sa.measurement).toMatch(/pg_net 245280/);
  });

  it('declares the ABS state series as the growth floor without letting it claim Growth', () => {
    const abs = ZERO_COST_SOURCES.find((s) => s.id === 'abs_res_dwell_st')!;
    expect(abs.growthFloor).toBe(true);
    expect(abs.supplies).toBe('context');
    expect(abs.grain).toBe('state');
    expect(abs.measurement).toMatch(/pg_net 245217/);
    expect(abs.measurement).toMatch(/only where nothing finer answered/);
    expect(ZERO_COST_SOURCES.filter((s) => s.growthFloor)).toHaveLength(1);
  });

  it('records which of the corpus the zero-cost stack can now reach for Growth, and what it still cannot', () => {
    // 15 Sep 2026: Queensland (50.8% of the Growth-ready corpus) is reached at
    // LGA grain and New South Wales at postcode grain, both measured from the
    // production egress. Western Australia (20.6%) still publishes no open
    // median sale price series, and nothing here may pretend otherwise.
    const growth = growthCapableToday();
    expect(growth.map((s) => s.id)).toEqual(expect.arrayContaining([
      'qld_qgso_rlda_dwelling_sales', 'nsw_dcj_rent_and_sales_report_sales', 'melbourne_house_prices_small_area',
      // 16 Sep 2026: Victoria and South Australia at suburb grain through the Internet Archive.
      'vic_property_sales_median_by_suburb', 'sa_metro_median_house_sales',
    ]));
    for (const s of growth) {
      expect(s.jurisdiction, `${s.id} must not claim to cover WA Growth`).not.toBe('WA');
      expect(['reachable_production', 'reachable_archive'], s.id).toContain(s.reachability);
      expect(s.acquisition, s.id).toBe('open_public');
    }
    const qld = growth.find((s) => s.id === 'qld_qgso_rlda_dwelling_sales')!;
    expect(qld.grain).toBe('lga');
    expect(qld.dwellingSegmented).toBe(true);
    expect(qld.measurement).toMatch(/pg_net 240150/);
    const nsw = growth.find((s) => s.id === 'nsw_dcj_rent_and_sales_report_sales')!;
    expect(nsw.grain).toBe('postcode');
    expect(nsw.measurement).toMatch(/one workbook per quarter/i);
  });

  it('never records an unverified licence as open', () => {
    for (const s of ZERO_COST_SOURCES) {
      if (/custom \(other\)|not an open licence|not established/i.test(s.licence)) {
        expect(s.acquisition, s.id).not.toBe('open_public');
      }
    }
  });
});
