/**
 * Renaming an assessment.
 *
 * The reported defect: on a completed assessment the name field was dead —
 * not typable, and nothing that reached it would have saved anyway, because a
 * title change travelled as an autosave and autosave refuses a completed
 * assessment ("cannot be edited. Reopen it first").
 *
 * The distinction this pins: the *figures* freeze on completion because a
 * calculation run snapshots them; the *name* does not, because it is a label —
 * and "Test" earning its real name is the normal last act of the workflow. The
 * only refusal left is an archived assessment.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';
import { StepAssessmentType } from '../StepAssessmentType';

afterEach(cleanup);

function renderStep(props: { disabled?: boolean; titleDisabled?: boolean; onTitleChange?: (t: string) => void } = {}) {
  return render(
    <StepAssessmentType
      payload={baseAssessment()}
      title="Test"
      onTitleChange={props.onTitleChange ?? (() => {})}
      onChange={() => {}}
      disabled={props.disabled}
      titleDisabled={props.titleDisabled}
    />,
  );
}

describe('the assessment name field', () => {
  it('stays typable on a completed assessment, where the figures are locked', () => {
    renderStep({ disabled: true });
    const field = screen.getByLabelText(/assessment name/i) as HTMLInputElement;
    expect(field).toBeEnabled();

    fireEvent.change(field, { target: { value: '45 Industrial Drive — Wetherill Park' } });
    expect(field.value).toBe('45 Industrial Drive — Wetherill Park');
  });

  it('locks the transaction type at the same moment it locks the figures', () => {
    renderStep({ disabled: true });
    expect(screen.getByRole('radio', { name: /commercial investment/i })).toBeDisabled();
  });

  it('says the name can be changed after completion', () => {
    renderStep({ disabled: true });
    expect(screen.getByText(/you can change it at any time, including after the assessment is complete/i))
      .toBeInTheDocument();
  });

  it('is closed only when the assessment is archived, and says which', () => {
    renderStep({ disabled: true, titleDisabled: true });
    expect(screen.getByLabelText(/assessment name/i)).toBeDisabled();
    expect(screen.getByText(/archived\. restore it to change its name/i)).toBeInTheDocument();
  });

  it('commits the new name once, on blur, rather than per keystroke', () => {
    const onTitleChange = vi.fn();
    renderStep({ disabled: true, onTitleChange });
    const field = screen.getByLabelText(/assessment name/i);

    fireEvent.change(field, { target: { value: 'Foundry' } });
    fireEvent.change(field, { target: { value: 'Foundry Link' } });
    expect(onTitleChange).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(onTitleChange).toHaveBeenCalledTimes(1);
    expect(onTitleChange).toHaveBeenCalledWith('Foundry Link');
  });
});

describe('the rename route', () => {
  it('sends the title alone, without the payload the figures live in', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true, data: { id: 'a1', version: 4 } }, error: null });
    vi.doMock('@/lib/secureInvoke', () => ({ invokeSecureFunction: invoke }));
    vi.resetModules();

    const { ciAssessmentApi } = await import('@/hooks/useCiAssessments');
    await ciAssessmentApi.rename({ assessmentId: 'a1', title: 'Foundry Link acquisition' });

    expect(invoke).toHaveBeenCalledWith('manage-ci-assessments', {
      operation: 'rename',
      assessmentId: 'a1',
      data: { title: 'Foundry Link acquisition' },
    });
    // No payload, no expectedVersion: a label change has no version race to
    // lose against the autosave timer, and carries no working data with it.
    const body = invoke.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('payload');
    expect(body).not.toHaveProperty('expectedVersion');
    vi.doUnmock('@/lib/secureInvoke');
  });
});
