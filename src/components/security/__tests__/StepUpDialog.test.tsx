/**
 * The reauthentication dialog has to say what it needs.
 *
 * An enforced gate accepts only password + authenticator. The dialog used to
 * open as a password box and answer an enrolled account's first Confirm with a
 * red "Enter an authenticator or recovery code." as though the operator had
 * made a mistake, and answered an account with no authenticator with one line
 * and no way forward. See `stepUpCallSites.test.ts` for why that mattered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const challenge = vi.fn();
vi.mock('@/lib/security/stepUp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/stepUp')>();
  return {
    ...actual,
    requestStepUpChallenge: (...args: unknown[]) => challenge(...args),
    webauthnSupported: () => false,
  };
});

import { StepUpDialog } from '@/components/security/StepUpDialog';

function renderDialog(onSuccess = vi.fn(), onCancel = vi.fn()) {
  render(
    <MemoryRouter>
      <StepUpDialog open capability="aml.role.set" onSuccess={onSuccess} onCancel={onCancel} />
    </MemoryRouter>,
  );
  return { onSuccess, onCancel };
}

function submitPassword() {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
}

describe('StepUpDialog', () => {
  beforeEach(() => challenge.mockReset());

  it('asks an enrolled account for its code as a step, not as an error', async () => {
    challenge.mockResolvedValueOnce({ ok: false, error: 'invalid_mfa_code' });
    renderDialog();
    submitPassword();
    expect(await screen.findByLabelText('Authenticator or recovery code')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/6-digit code from your authenticator app/)).toBeTruthy();
  });

  it('completes once the code is accepted', async () => {
    challenge
      .mockResolvedValueOnce({ ok: false, error: 'invalid_mfa_code' })
      .mockResolvedValueOnce({ ok: true, token: 't'.repeat(64), expires_at: new Date(Date.now() + 600_000).toISOString() });
    const { onSuccess } = renderDialog();
    submitPassword();
    fireEvent.change(await screen.findByLabelText('Authenticator or recovery code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(challenge).toHaveBeenLastCalledWith('aml.role.set', 'correct horse', '123456');
  });

  it('a wrong code after that IS an error', async () => {
    challenge
      .mockResolvedValueOnce({ ok: false, error: 'invalid_mfa_code' })
      .mockResolvedValueOnce({ ok: false, error: 'invalid_mfa_code' });
    renderDialog();
    submitPassword();
    fireEvent.change(await screen.findByLabelText('Authenticator or recovery code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter an authenticator or recovery code.')).toBeTruthy();
  });

  it('names a missing authenticator and offers the way to set one up', async () => {
    challenge.mockResolvedValueOnce({ ok: false, error: 'mfa_enrollment_required' });
    const { onCancel } = renderDialog();
    submitPassword();
    expect(await screen.findByText(/does not have an authenticator set up yet/)).toBeTruthy();
    // Confirming again cannot help, so it is not offered.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open security settings' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
