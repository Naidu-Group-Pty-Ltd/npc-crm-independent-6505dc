/**
 * Validation issue routing.
 *
 * These tests exist because of a real defect: issues carried a positional step
 * *number*, the workspace resolved it as `STEPS[step - 1]`, and inserting the
 * Intake pack chip at index 1 shifted every issue one step short — a Loan
 * structure error opened the Lease income panel and put the red marker on the
 * wrong chip. The fix was to carry a stable section key instead, so the guard
 * here is that keys stay keys and land where they claim to.
 */

import { describe, expect, it } from 'vitest';
import { validateAssessment, type ValidationSection } from '../validation';
import { baseAssessment } from './fixtures';

const SECTIONS: ValidationSection[] = [
  'property', 'ownership', 'income', 'portfolio', 'lease', 'loan',
];

function allIssues(payload: ReturnType<typeof baseAssessment>) {
  const result = validateAssessment(payload);
  return [...result.errors, ...result.warnings];
}

describe('validateAssessment issue routing', () => {
  it('routes a loan-structure error to the loan section, not its neighbour', () => {
    const payload = baseAssessment();
    // Residual at or above the facility is the exact error in the report that
    // prompted this work; it was landing on Lease income.
    payload.loan.residualBalloonAmount = payload.loan.requestedLoan;

    const issue = validateAssessment(payload).errors
      .find((candidate) => candidate.field === 'loan.residualBalloonAmount');

    expect(issue).toBeDefined();
    expect(issue?.section).toBe('loan');
  });

  it('routes a lease error to the lease section', () => {
    const payload = baseAssessment();
    payload.lease.vacancyAllowancePercent = 140;

    const issue = validateAssessment(payload).errors
      .find((candidate) => candidate.field === 'lease.vacancyAllowancePercent');

    expect(issue?.section).toBe('lease');
  });

  it('only ever emits known section keys', () => {
    // A deliberately broken payload, wide enough to trip rules in every section.
    const payload = baseAssessment();
    payload.property.purchasePrice = -1;
    payload.property.state = 'ZZ' as never;
    payload.property.postcode = '21';
    payload.ownership.entities[0].ownershipPercent = 40;
    payload.ownership.entities[0].entityName = '';
    payload.ownership.entities[0].abnAcn = '';
    payload.income.addbacks[0].amount = 0;
    payload.income.addbacks.push({ ...payload.income.addbacks[0], id: 'orphan', periodId: 'gone' });
    payload.portfolio.assets[0].ownershipPercent = 500;
    payload.portfolio.liabilities[0].balance = -5;
    payload.lease.managementAllowancePercent = -3;
    payload.loan.actualRatePercent = -1;

    const issues = allIssues(payload);
    expect(issues.length).toBeGreaterThan(6);
    for (const issue of issues) {
      expect(SECTIONS).toContain(issue.section);
    }
  });

  it('names a field path that begins with its own section', () => {
    // The summary uses `field` as a DOM selector and `section` to choose the
    // step. If they disagree the user is sent to a step the field is not on.
    const payload = baseAssessment();
    payload.property.currentValuation = -1;
    payload.portfolio.assets[0].ownershipPercent = 500;
    payload.loan.requestedLoan = -1;

    for (const issue of allIssues(payload)) {
      expect(issue.field.split('.')[0]).toBe(issue.section);
    }
  });

  it('reports no blocking errors on a well-formed assessment', () => {
    const result = validateAssessment(baseAssessment());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
