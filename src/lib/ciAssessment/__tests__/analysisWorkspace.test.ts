/**
 * The analysis workspace's contracts.
 *
 * Four modules, one idea: an analysis is a *record*, and every figure on it is
 * derived from one canonical payload rather than from nine private copies of
 * the deal. What these pin is the behaviour that made the old page unusable —
 * inputs that vanished, engines that disagreed, a readiness badge that had
 * nothing to do with what the server would accept, and links that dead-ended.
 */

import { describe, expect, it } from 'vitest';

import { analysisOf, emptyAnalysisSection, withAnalysis } from '../analysis';
import { runAnalysis } from '../analysisEngine';
import { applyPropertyPrefill } from '../propertyPrefill';
import { evaluateReadiness } from '../workspaceReadiness';
import {
  initialAssessmentType, normaliseDomain, planBootstrap, workspacePath,
} from '../workspaceBootstrap';
import { runAssessment } from '../engine';
import { emptyAssessmentPayload, hydrateAssessmentPayload, type AssessmentPayload } from '../types';
import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';

function analysisPayload(): AssessmentPayload {
  const payload = emptyAssessmentPayload('commercial_investment');
  payload.property.address = '11 Example Street';
  payload.property.purchasePrice = 5_000_000;
  payload.property.currentValuation = 5_200_000;
  payload.property.lettableAreaSqm = 2_000;
  payload.property.siteAreaSqm = 5_000;
  payload.property.stampDuty = 275_000;
  payload.lease.tenancies = [{
    id: 't1', tenantName: 'Anchor tenant', areaSqm: 2_000, annualRent: 400_000,
    leaseCommencement: '2024-01-01', leaseExpiry: '2031-01-01', optionsYears: 5,
    annualEscalationPercent: 3, tenantQuality: 'national', verification: 'verified',
  }];
  payload.loan.requestedLoan = 3_000_000;
  payload.loan.actualRatePercent = 6.5;
  payload.loan.loanTermYears = 15;
  payload.loan.amortisationYears = 25;
  return payload;
}

describe('the analysis section survives a payload of any vintage', () => {
  it('reads as defaults on a record written before it existed', () => {
    const payload = emptyAssessmentPayload();
    expect(payload.analysis).toBeUndefined();
    expect(analysisOf(payload)).toEqual(emptyAnalysisSection());
  });

  it('does not write itself onto a record that never had one', () => {
    // An autosave must not rewrite an untouched historical assessment with a
    // set of assumptions nobody chose.
    const hydrated = hydrateAssessmentPayload({ assessmentType: 'commercial_investment' });
    expect(hydrated.analysis).toBeUndefined();
  });

  it('round-trips through the database shape', () => {
    const withRate = withAnalysis(emptyAssessmentPayload(), 'valuation', { targetCapRatePct: 6.25 });
    const persisted = hydrateAssessmentPayload(JSON.parse(JSON.stringify(withRate)));
    expect(analysisOf(persisted).valuation.targetCapRatePct).toBe(6.25);
    // And the untouched groups still read as defaults rather than undefined.
    expect(analysisOf(persisted).forecast.holdPeriodYears).toBe(10);
  });

  it('changes one group without disturbing the others', () => {
    const first = withAnalysis(emptyAssessmentPayload(), 'forecast', { rentalGrowthPct: 3 });
    const second = withAnalysis(first, 'industrial', { clearanceMetres: 9 });
    expect(analysisOf(second).forecast.rentalGrowthPct).toBe(3);
    expect(analysisOf(second).industrial.clearanceMetres).toBe(9);
  });
});

describe('every figure comes from the one payload', () => {
  it('values the income the lending engine calculated, not a second copy of it', () => {
    const payload = withAnalysis(analysisPayload(), 'valuation', { targetCapRatePct: 6 });
    const lending = runAssessment(payload);
    const analysis = runAnalysis(payload, lending);

    expect(analysis.valuation).not.toBeNull();
    expect(analysis.valuation?.selectedNoi).toBe(lending.summary.netOperatingIncome);
    // The yield is that income over the price on the property stage.
    expect(analysis.valuation?.passingYield).toBeCloseTo(
      (lending.summary.netOperatingIncome / 5_000_000) * 100, 1,
    );
  });

  it('moves with the price rather than holding its own', () => {
    const base = withAnalysis(analysisPayload(), 'valuation', { targetCapRatePct: 6 });
    const cheaper = { ...base, property: { ...base.property, purchasePrice: 4_000_000 } };
    const first = runAnalysis(base, runAssessment(base));
    const second = runAnalysis(cheaper, runAssessment(cheaper));
    expect(second.valuation!.passingYield!).toBeGreaterThan(first.valuation!.passingYield!);
  });

  it('runs a forecast on the loan the assessment proposes', () => {
    const payload = withAnalysis(analysisPayload(), 'forecast', {
      terminalCapRatePct: 6.5, discountRatePct: 7.5, rentalGrowthPct: 3, holdPeriodYears: 10,
    });
    const analysis = runAnalysis(payload, runAssessment(payload));

    expect(analysis.forecast).not.toBeNull();
    expect(analysis.forecast?.rows).toHaveLength(10);
    // Year one debt service is the proposed facility's, not a number typed on
    // a calculator card — there is nowhere to type one.
    expect(analysis.forecast!.rows[0].debtService).toBeGreaterThan(0);
    expect(analysis.forecast!.terminalValue).toBeGreaterThan(0);
  });

  it('says what is missing instead of producing a number nobody chose', () => {
    const payload = analysisPayload();
    const analysis = runAnalysis(payload, runAssessment(payload));
    // No exit or discount rate: the model does not run, and says which.
    expect(analysis.forecast).toBeNull();
    expect(analysis.missing.forecast.join(' ')).toMatch(/exit capitalisation rate/i);
    expect(analysis.missing.forecast.join(' ')).toMatch(/discount rate/i);
  });

  it('computes industrial metrics from the areas on the property record', () => {
    const payload = withAnalysis(analysisPayload(), 'industrial', { officeAreaSqm: 300 });
    const analysis = runAnalysis(payload, runAssessment(payload));

    expect(analysis.industrial.pricePerSqm).toBe(2_500);
    expect(analysis.industrial.rentPerSqm).toBe(200);
    expect(analysis.industrial.sitePercentCovered).toBe(40);
    expect(analysis.industrial.officeRatioPct).toBe(15);
  });

  it('is honest about an empty analysis', () => {
    const payload = emptyAssessmentPayload();
    const analysis = runAnalysis(payload, runAssessment(payload));
    expect(analysis.isEmpty).toBe(true);
    expect(analysis.valuation).toBeNull();
  });
});

describe('the units the engines actually return', () => {
  /**
   * Both of these shipped wrong for as long as it took to look at the screen:
   * a $1.4m gap on a $5m asset read as "0.3% of price", and a healthy return
   * read as "1521.3%". Neither is a type error — they are two engines with two
   * conventions, so the conventions are pinned here rather than remembered.
   */
  it('reports the valuation gap as a ratio, which the display must scale', () => {
    const payload = withAnalysis(analysisPayload(), 'valuation', { targetCapRatePct: 5 });
    const analysis = runAnalysis(payload, runAssessment(payload));
    const gap = analysis.valuation!;

    expect(gap.valuationGap).toBeGreaterThan(0);
    // A ratio: 0.28 means 28%. Below 1 for anything short of a 100% gap.
    expect(Math.abs(gap.valuationGapPct!)).toBeLessThan(1);
    expect(gap.valuationGapPct!).toBeCloseTo(gap.valuationGap! / 5_000_000, 4);
  });

  it('reports internal rates of return already scaled to percent', () => {
    const payload = withAnalysis(analysisPayload(), 'forecast', {
      terminalCapRatePct: 6.5, discountRatePct: 7.5, rentalGrowthPct: 3,
    });
    const analysis = runAnalysis(payload, runAssessment(payload));
    const irr = analysis.forecast!.leveredIrr!;

    // 15.2 means 15.2%. A display that multiplies by 100 shows 1520%.
    expect(irr).toBeGreaterThan(1);
    expect(irr).toBeLessThan(200);
  });
});

describe('linking a property fills blanks and never overwrites', () => {
  const prefill: CalculatorPrefill = {
    propertyId: 'p1',
    domain: 'industrial',
    address: '15 Foundry Way',
    assetCategory: 'industrial',
    purchasePrice: 4_500_000,
    valuation: 4_700_000,
    nlaSqm: 3_000,
    siteAreaSqm: 6_000,
    hardstandSqm: 1_200,
    clearanceMetres: 10.5,
    officePct: 10,
    marketRentPa: 320_000,
  };

  it('writes what the analysis does not have, with provenance', () => {
    const result = applyPropertyPrefill(emptyAssessmentPayload(), prefill);

    expect(result.payload.property.address).toBe('15 Foundry Way');
    expect(result.payload.property.purchasePrice).toBe(4_500_000);
    expect(result.payload.property.lettableAreaSqm).toBe(3_000);
    expect(analysisOf(result.payload).industrial.clearanceMetres).toBe(10.5);
    expect(result.applied.map((change) => change.label)).toContain('Purchase price');
    // Every written value records where it came from.
    const fields = result.payload.provenance.map((entry) => entry.field);
    expect(fields).toContain('property.purchasePrice');
    expect(result.payload.provenance[0].sourceRef).toContain('p1');
  });

  it('leaves a negotiated price alone and reports both figures', () => {
    const payload = emptyAssessmentPayload();
    payload.property.purchasePrice = 4_250_000;
    const result = applyPropertyPrefill(payload, prefill);

    expect(result.payload.property.purchasePrice).toBe(4_250_000);
    const skipped = result.skipped.find((change) => change.field === 'property.purchasePrice');
    expect(skipped).toMatchObject({ value: 4_500_000, existing: 4_250_000 });
  });

  it('derives office area from the percentage the record holds', () => {
    const result = applyPropertyPrefill(emptyAssessmentPayload(), prefill);
    expect(analysisOf(result.payload).industrial.officeAreaSqm).toBe(300);
  });
});

describe('report readiness answers to the server, not to a badge', () => {
  const base = {
    status: 'completed' as const,
    hasSavedCalculation: true,
    figuresChanged: false,
    errors: [],
    lending: null,
    analysis: null,
    clientLinked: true,
  };

  it('is ready when the route would accept it', () => {
    const readiness = evaluateReadiness(base);
    expect(readiness.canGenerate).toBe(true);
    expect(readiness.headline).toBe('Report ready');
  });

  it('blocks on the two things the route actually refuses', () => {
    expect(evaluateReadiness({ ...base, hasSavedCalculation: false }).canGenerate).toBe(false);
    expect(evaluateReadiness({ ...base, status: 'data_entry' }).canGenerate).toBe(false);
  });

  it('warns rather than blocks when the figures have moved', () => {
    const readiness = evaluateReadiness({ ...base, figuresChanged: true });
    expect(readiness.canGenerate).toBe(true);
    expect(readiness.warnings[0].message).toMatch(/moved since the saved calculation/i);
  });

  it('does not invent a restriction for an unlinked client', () => {
    // A standalone analysis is a legitimate document. It is disclosed, not
    // prevented.
    const readiness = evaluateReadiness({ ...base, clientLinked: false });
    expect(readiness.canGenerate).toBe(true);
    expect(readiness.warnings.some((item) => /not linked to a client/i.test(item.message))).toBe(true);
  });

  it('names the stage that resolves each item', () => {
    const readiness = evaluateReadiness({ ...base, hasSavedCalculation: false });
    expect(readiness.blocking[0].stage).toBe('results');
  });
});

describe('old links keep working', () => {
  it('opens the analysis a workspace link names', () => {
    expect(planBootstrap({ workspace: 'a1', domain: null, propertyId: null }))
      .toEqual({ kind: 'open', assessmentId: 'a1', propertyId: null });
  });

  it('creates an analysis around a property deep link rather than dead-ending', () => {
    // `/calculators?domain=industrial&propertyId=p1` has existed for a long
    // time and meant "analyse this building".
    expect(planBootstrap({ workspace: null, domain: 'industrial', propertyId: 'p1' }))
      .toEqual({ kind: 'create', domain: 'industrial', propertyId: 'p1', reason: 'property_link' });
  });

  it('offers a choice on a bare visit instead of minting a record', () => {
    expect(planBootstrap({ workspace: null, domain: 'commercial', propertyId: null }))
      .toEqual({ kind: 'choose', domain: 'commercial' });
  });

  it('falls back to commercial for an unknown domain', () => {
    expect(normaliseDomain('nonsense')).toBe('commercial');
    expect(normaliseDomain(null)).toBe('commercial');
    expect(initialAssessmentType('industrial')).toBe('industrial_investment');
  });

  it('escapes what it puts in a link', () => {
    expect(workspacePath('a b&c', 'results')).toBe('/calculators?workspace=a%20b%26c&stage=results');
  });
});
