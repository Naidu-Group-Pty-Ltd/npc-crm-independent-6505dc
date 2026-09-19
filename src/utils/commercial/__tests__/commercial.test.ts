import { describe, it, expect } from 'vitest';
import { calculateNoi } from '../noiCalculator';
import { capRate, calculateYields, valueFromCap } from '../capRateCalculator';
import { calculateCoverage, maxLoanByIcr, annualPI } from '../icrDscrCalculator';
import { calculateWale } from '../waleCalculator';
import { calculateCommercialGst } from '../gstCommercial';
import { runDcf } from '../dcfEngine';
import { fmtPct } from '../commercialReportPdf';

describe('NOI calculator', () => {
  it('computes NOI with vacancy and full recovery', () => {
    const r = calculateNoi({
      grossRentalIncome: 100_000,
      recoveredOutgoings: 20_000,
      vacancyAllowancePct: 5,
      outgoings: { council: 5_000, insurance: 5_000, management: 10_000 },
    });
    expect(r.potentialGrossIncome).toBe(100_000);
    expect(r.vacancyLoss).toBe(5_000);
    expect(r.totalOutgoings).toBe(20_000);
    // EGI = 100k - 5k + 20k = 115k; NOI = 115k - 20k = 95k
    expect(r.noi).toBe(95_000);
  });
});

describe('Cap rate', () => {
  it('passing yield = NOI/price * 100', () => {
    expect(capRate({ noi: 70_000, price: 1_000_000 })).toBe(7);
  });
  it('value from cap', () => {
    expect(valueFromCap(70_000, 7)).toBeCloseTo(1_000_000, 2);
  });
  it('returns null for zero price', () => {
    expect(capRate({ noi: 10_000, price: 0 })).toBeNull();
  });
  it('yields set', () => {
    const y = calculateYields({ passingNoi: 70_000, marketNoi: 80_000, price: 1_000_000 });
    expect(y.passingYield).toBe(7);
    expect(y.reversionaryYield).toBe(8);
    expect(y.equivalentYield).toBe(7.5);
  });
});

describe('Commercial report formatting', () => {
  it('renders unavailable yields without throwing', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(7.125)).toBe('7.13%');
  });
});

describe('ICR / DSCR', () => {
  it('ICR = NOI / interest', () => {
    const r = calculateCoverage({ noi: 150_000, loanAmount: 1_000_000, interestRatePct: 7 });
    expect(r.annualInterest).toBeCloseTo(70_000);
    expect(r.icr).toBe(2.14);
  });
  it('DSCR with P&I', () => {
    const r = calculateCoverage({ noi: 150_000, loanAmount: 1_000_000, interestRatePct: 7, loanTermYears: 25 });
    expect(r.annualDebtService).toBeGreaterThan(0);
    expect(r.dscr).toBeGreaterThan(1);
  });
  it('max loan by ICR', () => {
    expect(maxLoanByIcr(150_000, 7, 1.5)).toBeCloseTo(150_000 / 1.5 / 0.07, 0);
  });
  it('annualPI sanity', () => {
    const pi = annualPI(500_000, 6, 25);
    expect(pi).toBeGreaterThan(30_000);
    expect(pi).toBeLessThan(45_000);
  });
});

describe('WALE', () => {
  it('weights by income', () => {
    const asOf = new Date('2025-01-01');
    const leases = [
      { base_rent_pa: 100_000, nla_sqm: 500, lease_end: '2030-01-01', status: 'occupied' },
      { base_rent_pa: 50_000, nla_sqm: 250, lease_end: '2027-01-01', status: 'occupied' },
    ];
    const r = calculateWale(leases, asOf);
    expect(r.totalIncome).toBe(150_000);
    // weighted: (100k*5 + 50k*2) / 150k = (500 + 100)/150 = 4.0
    expect(r.waleByIncome).toBeCloseTo(4, 1);
  });
  it('excludes vacant', () => {
    const r = calculateWale([{ base_rent_pa: 100_000, lease_end: '2030-01-01', status: 'vacant' }]);
    expect(r.occupiedCount).toBe(0);
  });
});

describe('Commercial GST', () => {
  it('going concern is GST-free', () => {
    const r = calculateCommercialGst({ purchasePrice: 2_000_000, treatment: 'going_concern' });
    expect(r.gstAmount).toBe(0);
  });
  it('margin scheme on $500k margin', () => {
    const r = calculateCommercialGst({ purchasePrice: 1_500_000, priorCost: 1_000_000, treatment: 'margin_scheme' });
    expect(r.gstAmount).toBeCloseTo(500_000 / 11, 2);
  });
  it('standard with registered purchaser → claimable', () => {
    const r = calculateCommercialGst({ purchasePrice: 1_100_000, treatment: 'standard', purchaserRegistered: true });
    expect(r.gstClaimable).toBeCloseTo(100_000, 0);
  });
});

describe('DCF engine', () => {
  it('produces correct number of rows and positive terminal value', () => {
    const r = runDcf({
      purchasePrice: 5_000_000,
      acquisitionCosts: 250_000,
      initialNoi: 350_000,
      holdPeriodYears: 10,
      rentalGrowthPct: 3,
      vacancyAllowancePct: 5,
      terminalCapRatePct: 6.5,
      discountRatePct: 8,
    });
    expect(r.rows).toHaveLength(10);
    expect(r.terminalValue).toBeGreaterThan(0);
    expect(r.unleveredIrr).not.toBeNull();
    expect(r.unleveredIrr!).toBeGreaterThan(0);
  });

  it('levered IRR > unlevered IRR when borrowing accretive', () => {
    const r = runDcf({
      purchasePrice: 5_000_000,
      acquisitionCosts: 250_000,
      initialNoi: 400_000,
      holdPeriodYears: 10,
      rentalGrowthPct: 3,
      terminalCapRatePct: 6.5,
      discountRatePct: 8,
      loanAmount: 3_000_000,
      interestRatePct: 6,
      loanTermYears: 25,
    });
    expect(r.leveredIrr).not.toBeNull();
    expect(r.unleveredIrr).not.toBeNull();
    expect(r.leveredIrr!).toBeGreaterThan(r.unleveredIrr!);
    expect(r.equityMultiple).toBeGreaterThan(1);
  });
});

import { calculateCommercialBc } from '../commercialBorrowingCapacity';

describe('Commercial Borrowing Capacity', () => {
  it('returns the lesser of ICR / DSCR / LVR caps', () => {
    const r = calculateCommercialBc({
      noi: 250_000,
      propertyValue: 3_500_000,
      interestRatePct: 7.25,
      bufferPct: 1.0,
      loanTermYears: 25,
      maxLvr: 0.65,
      minIcr: 1.5,
      minDscr: 1.25,
    });
    expect(r.maxLoan).toBeGreaterThan(0);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.icrCap);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.dscrCap);
    expect(r.maxLoan).toBeLessThanOrEqual(r.caps.lvrCap);
    expect(['icr', 'dscr', 'lvr']).toContain(r.bindingConstraint);
    expect(r.coverageAtMax.icr).toBeGreaterThanOrEqual(1.5 - 0.01);
  });

  it('returns zero loan when NOI is zero', () => {
    const r = calculateCommercialBc({ noi: 0, propertyValue: 1_000_000, interestRatePct: 7 });
    expect(r.maxLoan).toBe(0);
    expect(r.bindingConstraint).toBe('none');
  });

  it('applies sponsor liquidity cap when binding', () => {
    const r = calculateCommercialBc({
      noi: 500_000, propertyValue: 10_000_000, interestRatePct: 7,
      sponsorLiquidity: 200_000, sponsorLiquidityMultiplier: 2,
    });
    expect(r.caps.liquidityCap).toBe(400_000);
    expect(r.maxLoan).toBeLessThanOrEqual(400_000);
  });
});
