/**
 * Deleting an assessment.
 *
 * "New assessment" creates a draft on the click, and there was once no way to
 * delete one, so every click that went no further left an undeletable
 * "Untitled assessment" behind. Deletion is what makes creating on the click
 * safe (`useStartAssessment.test.tsx` pins the click). These pin the delete
 * dialog: it does exactly what the server decided, and says why when the
 * answer is no.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const previewDeletion = vi.fn();
const deleteAssessment = vi.fn();
const archiveAssessment = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/ciAssessment/assessmentManagement', () => ({
  previewDeletion: (...args: unknown[]) => previewDeletion(...args),
  deleteAssessment: (...args: unknown[]) => deleteAssessment(...args),
  archiveAssessment: (...args: unknown[]) => archiveAssessment(...args),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ isSuperadmin: false, permissions: [] }),
}));

const { DeleteAssessmentDialog } = await import('../DeleteAssessmentDialog');

beforeEach(() => {
  previewDeletion.mockReset();
  deleteAssessment.mockReset().mockResolvedValue({ data: { id: 'a1', reference: 'CI-202609-AYY4E' }, error: null });
  archiveAssessment.mockReset().mockResolvedValue({ data: { id: 'a1' }, error: null });
  toast.mockReset();
});

afterEach(cleanup);

describe('Delete assessment', () => {
  const ASSESSMENT = { id: 'a1', title: 'Untitled assessment', reference: 'CI-202609-AYY4E' };

  function preview(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        allowed: true, block: null, archiveOffered: false, permitted: true, typedConfirmation: false,
        message: 'Deleting permanently removes this assessment with its calculation runs, scenarios and audit history.',
        reference: ASSESSMENT.reference, title: ASSESSMENT.title, status: 'draft',
        counts: { calculationRuns: 2, scenarios: 0 },
        ...overrides,
      },
      error: null,
    };
  }

  function openDialog() {
    const onDeleted = vi.fn();
    const onArchived = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DeleteAssessmentDialog
        assessment={ASSESSMENT}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
        onArchived={onArchived}
      />,
    );
    return { onDeleted, onArchived, onOpenChange };
  }

  it('asks the server first, then deletes a draft from one explicit button', async () => {
    previewDeletion.mockResolvedValue(preview());
    const { onDeleted } = openDialog();

    expect(await screen.findByText(/removed with it: 2 saved calculation runs/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(deleteAssessment).toHaveBeenCalledWith('a1', undefined));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(ASSESSMENT));
  });

  it('asks for the reference before deleting a completed assessment', async () => {
    previewDeletion.mockResolvedValue(preview({ status: 'completed', typedConfirmation: true }));
    openDialog();

    const button = await screen.findByRole('button', { name: /delete permanently/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type CI-202609-AYY4E to confirm/i), { target: { value: 'ci-202609-ayy4e' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(deleteAssessment).toHaveBeenCalledWith('a1', 'ci-202609-ayy4e'));
  });

  it('keeps what reached a client or a report, says why, and offers archiving', async () => {
    previewDeletion.mockResolvedValue(preview({
      allowed: false, block: 'report_issued', archiveOffered: true,
      message: 'A report has been issued from this assessment, and the assessment is kept as the record of what that document states.',
    }));
    const { onArchived } = openDialog();

    expect(await screen.findByText(/a report has been issued from this assessment/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /archive instead/i }));

    await waitFor(() => expect(archiveAssessment).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    expect(deleteAssessment).not.toHaveBeenCalled();
  });

  it('tells a user without delete permission, rather than offering a button that will fail', async () => {
    previewDeletion.mockResolvedValue(preview({ permitted: false }));
    openDialog();
    expect(await screen.findByText(/do not have permission to delete/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
    expect(screen.getByRole('button', { name: /archive instead/i })).toBeInTheDocument();
  });

  it('shows the server’s reason in place of the button when the answer changes at the last moment', async () => {
    previewDeletion.mockResolvedValue(preview());
    deleteAssessment.mockResolvedValue({
      data: null, code: 'DELETION_REFUSED',
      error: 'A report was requested from this assessment while it was being deleted, so it has been kept. Archive it instead.',
      body: { archiveOffered: true },
    });
    const { onDeleted } = openDialog();
    fireEvent.click(await screen.findByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByText(/while it was being deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('asks the server afresh every time it opens — an answer is never reused', async () => {
    previewDeletion.mockResolvedValue(preview());
    const dialog = (open: boolean) => (
      <DeleteAssessmentDialog assessment={ASSESSMENT} open={open} onOpenChange={() => {}} onDeleted={() => {}} />
    );
    const view = render(dialog(true));
    await screen.findByRole('button', { name: /delete permanently/i });
    view.rerender(dialog(false));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    view.rerender(dialog(true));
    await screen.findByRole('button', { name: /delete permanently/i });
    expect(previewDeletion).toHaveBeenCalledTimes(2);
  });

  it('reports a check that could not be made, and lets it be retried', async () => {
    previewDeletion.mockResolvedValueOnce({ data: null, error: 'Assessment request failed' }).mockResolvedValueOnce(preview());
    openDialog();
    expect(await screen.findByText(/assessment request failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
  });
});
