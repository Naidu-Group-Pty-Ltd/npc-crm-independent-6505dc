/**
 * Click-to-field error navigation.
 *
 * Two things have to hold for the error summary to be worth clicking:
 *
 *  1. every issue the validator can raise names a `field` that exists in the
 *     DOM as `data-ci-field`, so the jump lands on a control rather than on the
 *     top of a long step; and
 *  2. `focusAssessmentField` actually rings and focuses it.
 *
 * The first is the one that rots — a new validation rule is cheap to add and
 * easy to forget to anchor — so it is asserted by rendering the real step
 * panels against a deliberately broken payload rather than by inspection.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { validateAssessment, type ValidationIssue } from '@/lib/ciAssessment/validation';
import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { focusAssessmentField } from '../fieldFocus';
import { StepPropertyTransaction } from '../StepPropertyTransaction';
import { StepOwnership } from '../StepOwnership';
import { StepIncome } from '../StepIncome';
import { StepPortfolio } from '../StepPortfolio';
import { StepLeaseIncome } from '../StepLeaseIncome';
import { StepLoanStructure } from '../StepLoanStructure';

/**
 * A payload that trips at least one rule in each of the six validated
 * sections, so the anchor sweep below has something to look for everywhere.
 */
function brokenAssessment(): AssessmentPayload {
  const payload = baseAssessment();

  payload.property.purchasePrice = -1;
  payload.property.currentValuation = -1;
  payload.property.depositOrContribution = -1;
  payload.property.state = 'ZZ' as never;
  payload.property.postcode = '21';
  payload.property.contractDate = '2026-07-15';
  payload.property.settlementDate = '2026-01-01';
  payload.property.valuationDate = '2099-01-01';

  payload.ownership.entities[0].ownershipPercent = 40;
  payload.ownership.entities[0].entityName = '';
  payload.ownership.entities[0].abnAcn = '';

  payload.income.addbacks[0].amount = 0;
  payload.income.periods.push({ ...payload.income.periods[0], id: 'period-dupe' });

  payload.portfolio.assets[0].ownershipPercent = 500;
  payload.portfolio.assets[0].currentBalance = 9_000_000;
  payload.portfolio.liabilities[0].balance = -5;

  payload.lease.vacancyAllowancePercent = 140;
  payload.lease.managementAllowancePercent = -3;
  payload.lease.tenancies[0].annualRent = -1;
  payload.lease.tenancies[0].leaseExpiry = '2020-01-01';

  payload.loan.actualRatePercent = -1;
  payload.loan.requestedLoan = -1;
  payload.loan.interestOnlyPeriodYears = payload.loan.loanTermYears + 5;

  return payload;
}

/** Render every step panel at once — the anchors are what matter, not layout. */
function renderAllSteps(payload: AssessmentPayload, issues: ValidationIssue[]) {
  const noop = () => {};
  return render(
    <>
      <StepPropertyTransaction payload={payload} onChange={noop} issues={issues} />
      <StepOwnership payload={payload} onChange={noop} issues={issues} />
      <StepIncome payload={payload} onChange={noop} issues={issues} />
      <StepPortfolio payload={payload} onChange={noop} issues={issues} />
      <StepLeaseIncome payload={payload} onChange={noop} issues={issues} />
      <StepLoanStructure payload={payload} onChange={noop} issues={issues} canOverridePolicy />
    </>,
  );
}

beforeEach(() => {
  // jsdom implements neither, and both are called on the happy path.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('validation issues have somewhere to land', () => {
  it('anchors every blocking error to a rendered field', () => {
    const payload = brokenAssessment();
    const { errors } = validateAssessment(payload);
    expect(errors.length).toBeGreaterThan(8);
    // Guard against the sweep passing because it only found errors in one
    // section — the point is that all six validated steps are covered.
    expect([...new Set(errors.map((issue) => issue.section))].sort()).toEqual(
      ['income', 'lease', 'loan', 'ownership', 'portfolio', 'property'],
    );

    const { container } = renderAllSteps(payload, errors);

    const missing = errors
      .map((issue) => issue.field)
      .filter((field) => !container.querySelector(`[data-ci-field="${field}"]`));

    expect(missing).toEqual([]);
  });

  it('anchors warnings too, so a warning-only field is still reachable', () => {
    const payload = brokenAssessment();
    const result = validateAssessment(payload);
    const issues = [...result.errors, ...result.warnings];
    expect(result.warnings.length).toBeGreaterThan(0);

    const { container } = renderAllSteps(payload, issues);

    const missing = result.warnings
      .map((issue) => issue.field)
      // An add-back orphaned from a deleted period genuinely has no row to
      // point at; nothing else is allowed to be unanchored.
      .filter((field) => !field.endsWith('.periodId'))
      .filter((field) => !container.querySelector(`[data-ci-field="${field}"]`));

    expect(missing).toEqual([]);
  });

  it('marks the anchored field invalid so the highlight is not colour alone', () => {
    const payload = brokenAssessment();
    const { errors } = validateAssessment(payload);
    const { container } = renderAllSteps(payload, errors);

    const loanField = container.querySelector('[data-ci-field="loan.requestedLoan"]');
    expect(loanField).not.toBeNull();
    expect(loanField?.getAttribute('data-ci-invalid')).toBe('true');
    expect(loanField?.querySelector('[aria-invalid="true"]')).not.toBeNull();
  });
});

describe('focusAssessmentField', () => {
  it('scrolls to the field, rings it and focuses its control', () => {
    document.body.innerHTML = `
      <div data-ci-field="loan.requestedLoan"><input id="requested" /></div>
    `;
    const target = document.querySelector('[data-ci-field="loan.requestedLoan"]')!;

    expect(focusAssessmentField('loan.requestedLoan')).toBe(true);
    expect(target.classList.contains('ci-field-flash')).toBe(true);
    expect(document.activeElement?.id).toBe('requested');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('clears a previous highlight rather than stacking rings', () => {
    document.body.innerHTML = `
      <div data-ci-field="loan.requestedLoan"><input /></div>
      <div data-ci-field="loan.actualRatePercent"><input /></div>
    `;

    focusAssessmentField('loan.requestedLoan');
    focusAssessmentField('loan.actualRatePercent');

    expect(document.querySelectorAll('.ci-field-flash')).toHaveLength(1);
    expect(document.querySelector('.ci-field-flash')?.getAttribute('data-ci-field'))
      .toBe('loan.actualRatePercent');
  });

  it('reports failure for a field that is not on the page', () => {
    document.body.innerHTML = '<div data-ci-field="loan.requestedLoan"></div>';
    expect(focusAssessmentField('income.addbacks.4.periodId')).toBe(false);
    expect(focusAssessmentField('')).toBe(false);
  });
});
