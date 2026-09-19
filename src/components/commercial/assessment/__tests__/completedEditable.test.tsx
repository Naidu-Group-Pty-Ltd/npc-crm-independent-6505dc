/**
 * A completed assessment, on screen.
 *
 * Two rules, and they only make sense together. The fields are **open**,
 * because a deal keeps moving after an assessment is marked complete. And the
 * moment the working data moves away from the completed calculation, the
 * workspace **says so** — because the stored run, and any report produced from
 * it, still state the completed figures. Editing without that notice would
 * leave two sets of numbers in play with nothing to tell them apart.
 *
 * The step components are exercised directly: what is under test is the
 * gating, not the workspace's data loading.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';
import { StepPropertyTransaction } from '../StepPropertyTransaction';
import { StepAssessmentType } from '../StepAssessmentType';

afterEach(cleanup);

describe('the fields of a completed assessment', () => {
  it('accept an edit — the property step is open', () => {
    // `disabled` now tracks the archive, not completion, so a completed
    // assessment renders exactly as an in-progress one does.
    const onChange = vi.fn();
    render(
      <StepPropertyTransaction
        payload={baseAssessment()}
        onChange={onChange}
        issues={[]}
        disabled={false}
      />,
    );

    const valuation = screen.getByLabelText(/current valuation/i);
    expect(valuation).toBeEnabled();
    fireEvent.change(valuation, { target: { value: '6100000' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('locks only for an archived assessment', () => {
    render(
      <StepPropertyTransaction
        payload={baseAssessment()}
        onChange={() => {}}
        issues={[]}
        disabled
      />,
    );
    expect(screen.getByLabelText(/current valuation/i)).toBeDisabled();
  });

  it('explains the lock as the archive, not as completion', () => {
    render(
      <StepAssessmentType
        payload={baseAssessment()}
        title="Test"
        onTitleChange={() => {}}
        onChange={() => {}}
        disabled
        titleDisabled
      />,
    );
    expect(screen.getByText(/archived\. restore it to change its name/i)).toBeInTheDocument();
  });
});
