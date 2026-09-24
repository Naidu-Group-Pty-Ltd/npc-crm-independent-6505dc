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

function renderStep(props: {
  disabled?: boolean; titleDisabled?: boolean; onTitleChange?: (t: string) => void; title?: string;
} = {}) {
  return render(
    <StepAssessmentType
      payload={baseAssessment()}
      title={props.title ?? 'Test'}
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

/*
 * "New assessment" creates the draft on the click and opens this step, so a
 * draft nobody has named yet arrives here called "Untitled assessment". That is
 * the list's word for it, not a name, and the server refuses an empty one.
 */
describe('an assessment nobody has named yet', () => {
  it('shows an empty name field with its placeholder, not the placeholder name as text', () => {
    renderStep({ title: 'Untitled assessment' });
    const field = screen.getByLabelText(/assessment name/i) as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.placeholder).toMatch(/45 Industrial Drive/);
    expect(screen.getByText(/reads “Untitled assessment” until you name it/i)).toBeInTheDocument();
  });

  it('sends nothing when the field is left empty — an empty name is never saved', () => {
    const onTitleChange = vi.fn();
    renderStep({ title: 'Untitled assessment', onTitleChange });
    const field = screen.getByLabelText(/assessment name/i);
    fireEvent.focus(field);
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('saves the name once it is typed, trimmed', () => {
    const onTitleChange = vi.fn();
    renderStep({ title: 'Untitled assessment', onTitleChange });
    const field = screen.getByLabelText(/assessment name/i);
    fireEvent.change(field, { target: { value: '  45 Industrial Drive — acquisition ' } });
    fireEvent.blur(field);
    expect(onTitleChange).toHaveBeenCalledTimes(1);
    expect(onTitleChange).toHaveBeenCalledWith('45 Industrial Drive — acquisition');
  });

  it('does not refill the field while it is being retyped', () => {
    vi.useFakeTimers();
    try {
      const onTitleChange = vi.fn();
      renderStep({ title: 'Test', onTitleChange });
      const field = screen.getByLabelText(/assessment name/i) as HTMLInputElement;
      fireEvent.change(field, { target: { value: '' } });
      // The pause that would commit a typed name commits nothing for an empty
      // field, and leaves it empty for the name about to be typed.
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(onTitleChange).not.toHaveBeenCalled();
      expect(field.value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts a real name back when its field is cleared and left, rather than sending nothing to the server', () => {
    const onTitleChange = vi.fn();
    renderStep({ title: 'Test', onTitleChange });
    const field = screen.getByLabelText(/assessment name/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(field.value).toBe('Test');
  });

  it('shows an archived one what it is actually called, since its field cannot be edited', () => {
    renderStep({ title: 'Untitled assessment', disabled: true, titleDisabled: true });
    expect((screen.getByLabelText(/assessment name/i) as HTMLInputElement).value).toBe('Untitled assessment');
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
