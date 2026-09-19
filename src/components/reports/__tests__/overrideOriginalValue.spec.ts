import { describe, expect, it } from 'vitest';
import {
  getNestedValue,
  OVERRIDE_FIELD_PATHS,
  resolveOriginalFieldValue,
} from '../overrideOriginalValue';

describe('getNestedValue', () => {
  it('reads a dot-delimited nested path', () => {
    expect(getNestedValue({ initialCosts: { propertyValue: 450000 } }, 'initialCosts.propertyValue')).toBe(450000);
  });

  it('returns undefined for missing paths, null sources, or non-object segments', () => {
    expect(getNestedValue({ initialCosts: {} }, 'initialCosts.propertyValue')).toBeUndefined();
    expect(getNestedValue(null, 'initialCosts.propertyValue')).toBeUndefined();
    expect(getNestedValue({ initialCosts: 5 }, 'initialCosts.propertyValue')).toBeUndefined();
    expect(getNestedValue({}, undefined)).toBeUndefined();
  });
});

describe('OVERRIDE_FIELD_PATHS', () => {
  it('maps the reported "Not available" fields to their real nested locations', () => {
    expect(OVERRIDE_FIELD_PATHS.purchasePrice).toBe('initialCosts.propertyValue');
    expect(OVERRIDE_FIELD_PATHS.landPrice).toBe('initialCosts.landPrice');
    expect(OVERRIDE_FIELD_PATHS.buildPrice).toBe('initialCosts.buildPrice');
    expect(OVERRIDE_FIELD_PATHS.carSpaces).toBe('propertySpecs.carSpaces');
    expect(OVERRIDE_FIELD_PATHS.interestRate).toBe('loanDetails.interestRate');
    expect(OVERRIDE_FIELD_PATHS.loanToValueRatio).toBe('keyMetrics.lvr');
  });
});

describe('resolveOriginalFieldValue', () => {
  it('pulls purchase price from the nested calculator output (API report)', () => {
    const fc = { initialCosts: { propertyValue: 450000 } };
    // Field-definition fallback is null here (the historical flat path), yet the value resolves.
    expect(resolveOriginalFieldValue(fc, {}, 'purchasePrice', null)).toBe(450000);
  });

  it('falls back to the manual override figure when financial_calculations is empty', () => {
    // Mirrors the reported report: financial_calculations is null, everything lives in manual_overrides.
    const manualOverrides = { purchasePrice: 683700, landPrice: 325000, buildPrice: 358700, carSpaces: 2 };
    expect(resolveOriginalFieldValue(null, manualOverrides, 'purchasePrice', null)).toBe(683700);
    expect(resolveOriginalFieldValue(null, manualOverrides, 'landPrice', null)).toBe(325000);
    expect(resolveOriginalFieldValue(null, manualOverrides, 'buildPrice', null)).toBe(358700);
    expect(resolveOriginalFieldValue(null, manualOverrides, 'carSpaces', null)).toBe(2);
  });

  it('resolves select-field originals (e.g. loan type) from manual_overrides', () => {
    expect(resolveOriginalFieldValue(null, { loanType: 'interest_only' }, 'loanType', null)).toBe('interest_only');
  });

  it('prefers the field-definition original/default over the manual override', () => {
    // occupancyRate has a sensible default (52) in the modal; that must win over an override of 50,
    // so fields that already showed a value are unchanged by this fix.
    expect(resolveOriginalFieldValue(null, { occupancyRate: 50 }, 'occupancyRate', 52)).toBe(52);
  });

  it('prefers the generated loan amount location over the override location', () => {
    // Calculator writes the base loan amount to initialCosts.loanAmount; an override saves to cashFlow.loanAmount.
    const fc = { initialCosts: { loanAmount: 360000 }, cashFlow: { loanAmount: 400000 } };
    expect(resolveOriginalFieldValue(fc, { loanAmount: 400000 }, 'loanAmount', null)).toBe(360000);
  });

  it('reads LVR from either keyMetrics or loanDetails', () => {
    expect(resolveOriginalFieldValue({ keyMetrics: { lvr: 80 } }, {}, 'loanToValueRatio', null)).toBe(80);
    expect(resolveOriginalFieldValue({ loanDetails: { lvr: 90 } }, {}, 'loanToValueRatio', null)).toBe(90);
  });

  it('treats 0 as a present value rather than falling through', () => {
    expect(resolveOriginalFieldValue({ annualCosts: { maintenance: 0 } }, { repairsMaintenance: 500 }, 'repairsMaintenance', null)).toBe(0);
  });

  it('returns null only when no source holds a value (genuine Not available)', () => {
    expect(resolveOriginalFieldValue(null, {}, 'landPrice', null)).toBeNull();
    expect(resolveOriginalFieldValue({}, null, 'buildPrice', null)).toBeNull();
  });

  it('does not let the manual override move the original once a nested source exists', () => {
    // With a nested source present, the override value is ignored for the Original column.
    const fc = { initialCosts: { propertyValue: 450000 } };
    expect(resolveOriginalFieldValue(fc, { purchasePrice: 999999 }, 'purchasePrice', null)).toBe(450000);
  });
});
