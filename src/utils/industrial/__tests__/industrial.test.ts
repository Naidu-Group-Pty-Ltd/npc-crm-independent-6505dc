import { describe, it, expect } from 'vitest';
import { calcRentPerSqm, rentFromPerSqm } from '../rentPerSqm';
import { calculateIndustrialNoi } from '../noi';
import { calcSiteMetrics } from '../siteMetrics';
import { calculateIndustrialWale } from '../wale';
import { industrialCapRate, calculateIndustrialYields, industrialValueFromCap } from '../yields';
import { runIndustrialDcf } from '../dcf';
import { calculateIndustrialBc } from '../industrialBorrowingCapacity';

describe('Industrial rent per sqm', () => {
  it('computes net & gross per sqm', () => {
    const r = calcRentPerSqm({ baseRentPa: 200_000, glaSqm: 1000, outgoingsPa: 30_000 });
    expect(r.netRentPerSqmPa).toBe(200);
    expect(r.outgoingsPerSqmPa).toBe(30);
    expect(r.grossRentPerSqmPa).toBe(230);
  });
  it('rentFromPerSqm inverse', () => {
    expect(rentFromPerSqm(200, 1000)).toBe(200_000);
  });
  it('zero GLA safe', () => {
    expect(calcRentPerSqm({ baseRentPa: 100_000, glaSqm: 0 }).netRentPerSqmPa).toBe(0);
  });
});

describe('Industrial NOI', () => {
  it('net lease — recovered outgoings offset opex, capex reserve subtracted', () => {
    const r = calculateIndustrialNoi({
      grossRentalIncome: 300_000,
      recoveredOutgoings: 40_000,
      vacancyAllowancePct: 4,
      outgoings: { council: 10_000, land_tax: 20_000, insurance: 10_000 },
      capexReservePa: 5_000,
    });
    // PGI 300k, vacancy 12k, EGI = 300 - 12 + 40 = 328; NOI = 328 - 40 - 5 = 283
    expect(r.noi).toBe(283_000);
    expect(r.capexReserve).toBe(5_000);
  });
});

describe('Site metrics', () => {
  it('balanced cover band ~50%', () => {
    const r = calcSiteMetrics({ glaSqm: 5000, siteAreaSqm: 10_000, hardstandSqm: 3000, price: 12_000_000 });
    expect(r.siteCoverPct).toBe(50);
    expect(r.hardstandRatioPct).toBe(30);
    expect(r.pricePerSqmGla).toBe(2400);
    expect(r.pricePerSqmSite).toBe(1200);
    expect(r.coverageBand).toBe('balanced');
  });
  it('under-developed band', () => {
    expect(calcSiteMetrics({ glaSqm: 1000, siteAreaSqm: 10_000 }).coverageBand).toBe('under-developed');
  });
  it('over-developed band', () => {
    expect(calcSiteMetrics({ glaSqm: 7000, siteAreaSqm: 10_000 }).coverageBand).toBe('over-developed');
  });
});

describe('Industrial WALE', () => {
  it('weights by income', () => {
    const asOf = new Date('2026-01-01');
    const r = calculateIndustrialWale([
      { base_rent_pa: 200_000, gla_sqm: 2000, lease_end: '2031-01-01', status: 'occupied' },
      { base_rent_pa: 100_000, gla_sqm: 1000, lease_end: '2028-01-01', status: 'occupied' },
    ], asOf);
    // (200k*5 + 100k*2) / 300k = (1000+200)/300 = 4.0
    expect(r.waleByIncome).toBeCloseTo(4, 1);
    expect(r.totalIncome).toBe(300_000);
  });
});

describe('Industrial yields', () => {
  it('cap rate basic', () => {
    expect(industrialCapRate(70_000, 1_000_000)).toBe(7);
  });
  it('equivalent yield average', () => {
    const y = calculateIndustrialYields({ passingNoi: 70_000, marketNoi: 80_000, price: 1_000_000 });
    expect(y.equivalentYield).toBe(7.5);
  });
  it('valueFromCap inverse', () => {
    expect(industrialValueFromCap(70_000, 7)).toBeCloseTo(1_000_000, 0);
  });
});

describe('Industrial DCF (re-export)', () => {
  it('produces 10 rows', () => {
    const r = runIndustrialDcf({
      purchasePrice: 8_000_000,
      acquisitionCosts: 400_000,
      initialNoi: 480_000,
      holdPeriodYears: 10,
      rentalGrowthPct: 3,
      terminalCapRatePct: 6,
      discountRatePct: 8,
    });
    expect(r.rows).toHaveLength(10);
    expect(r.unleveredIrr).not.toBeNull();
  });
});

describe('Industrial Borrowing Capacity', () => {
  it('returns lesser of ICR / DSCR / LVR caps', () => {
    const r = calculateIndustrialBc({
      noi: 400_000,
      propertyValue: 6_000_000,
      interestRatePct: 7.25,
      bufferPct: 1.0,
      loanTermYears: 20,
      maxLvr: 0.60,
      minIcr: 1.75,
      minDscr: 1.35,
    });
    expect(r.maxLoan).toBeGreaterThan(0);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.icrCap);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.dscrCap);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.lvrCap);
    expect(['icr', 'dscr', 'lvr']).toContain(r.bindingConstraint);
  });
  it('zero NOI → zero loan', () => {
    const r = calculateIndustrialBc({ noi: 0, propertyValue: 1_000_000, interestRatePct: 7 });
    expect(r.maxLoan).toBe(0);
    expect(r.bindingConstraint).toBe('none');
  });
  it('sponsor liquidity cap applies when binding', () => {
    const r = calculateIndustrialBc({
      noi: 800_000, propertyValue: 12_000_000, interestRatePct: 7,
      sponsorLiquidity: 250_000, sponsorLiquidityMultiplier: 2,
    });
    expect(r.caps.liquidityCap).toBe(500_000);
    expect(r.maxLoan).toBeLessThanOrEqual(500_000);
  });
});
