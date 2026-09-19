import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The blinking portal.
 *
 * ## What customers saw
 *
 * On `/client/aml`, a customer who reached Verify identity watched the page
 * appear, disappear, flash, blank its content area and come back — forever.
 * It was unusable.
 *
 * ## Why
 *
 * Two changes met and formed a cycle:
 *
 *   1. `IdentityVerificationStep` announced a "change" on its FIRST read
 *      whenever that read was not `not_started`. A check already `in_review`
 *      therefore reported a change that had not happened.
 *   2. The page answered `onStatusChange` with the same `load()` used for the
 *      first paint, and that sets `loading = true`, which swaps the entire
 *      portal for skeletons.
 *
 * So: the step reports → the page blanks → the step UNMOUNTS → the ref
 * holding what it had seen dies with it → the page finishes loading → the step
 * remounts → it reads the same `in_review` → it reports again. Forever.
 *
 * These render the REAL page with the REAL identity step, because the bug only
 * exists where the two meet. A test with either half mocked cannot see it.
 */

const overview = vi.fn();
const verificationStatus = vi.fn();
const listDocuments = vi.fn();
const startHostedVerification = vi.fn();

vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    overview: (...a: unknown[]) => overview(...a),
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    startHostedVerification: (...a: unknown[]) => startHostedVerification(...a),
    getConsents: () => Promise.resolve({ version: '2026.1', satisfied: true, outstanding: [], documents: [] }),
    getQuestionnaire: () => Promise.resolve({ response: null }),
    requestVerificationUpload: vi.fn(),
    submitVerification: vi.fn(),
  },
  uploadAmlDocument: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import PortalAml from './PortalAml';
import type { AmlPortalJourneyStatus } from '@/lib/aml/amlPortalApi';

const journey = (over: Partial<Record<string, AmlPortalJourneyStatus>> = {}) => {
  const base: Record<string, AmlPortalJourneyStatus> = {
    consent: 'complete', questionnaire: 'complete', documents: 'complete',
    verification: 'in_progress', submission: 'not_started', review: 'not_started',
  };
  return Object.entries({ ...base, ...over }).map(([step, status]) => ({
    step, status, action_required: status === 'action_required',
    safe_label: step, safe_description: `${step} copy`, target_step: step, completed_at: null,
  }));
};

const overviewPayload = (over: Record<string, any> = {}) => ({
  case: {
    id: 'case-1', reference: 'AML-0001', subject: 'A Client',
    opened_at: new Date().toISOString(),
    status: 'in_progress', portal_status: 'in_progress',
    status_label: 'In progress', status_tone: 'progress',
  },
  consent: { version: '2026.1', satisfied: true, outstanding: [], required_count: 5 },
  sections: [
    { section: 'purchasing_structure', status: 'submitted', updated_at: null },
    { section: 'personal_details', status: 'submitted', updated_at: null },
    { section: 'purchase_profile', status: 'submitted', updated_at: null },
    { section: 'funding', status: 'submitted', updated_at: null },
  ],
  requirements: [], requirement_progress: { completed: 0, total: 0 },
  open_requests: [], recent_submissions: [],
  journey: journey(),
  ...over,
});

const party = {
  party_id: null, label: 'You', status: 'not_started' as const,
  attempts_used: 0, attempts_remaining: 3, can_attempt: true,
};
const idvStatus = (over: Record<string, unknown> = {}) => ({
  enabled: true, max_attempts: 3, biometric_consent_accepted: true,
  availability: 'available', parties: [party], ...over,
});

const pill = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label},`) });

/**
 * Let every pending promise chain settle, repeatedly.
 *
 * A render loop driven by promises does not need a timer to run away, so
 * sitting on the clock proves nothing — flushing is what gives the cycle its
 * chance to turn. Thirty passes is far more than the loop needed.
 */
async function settle(passes = 30) {
  for (let i = 0; i < passes; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => {
  overview.mockReset();
  verificationStatus.mockReset();
  listDocuments.mockReset();
  startHostedVerification.mockReset();
  overview.mockResolvedValue(overviewPayload());
  verificationStatus.mockResolvedValue(idvStatus());
  listDocuments.mockResolvedValue({ documents: [] });
  localStorage.clear();
  // Land on Verify identity, where the loop lived.
  localStorage.setItem('aml_portal_resume:case-1', '6');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* ── the loop ────────────────────────────────────────────────────────────── */

describe('the identity step does not put the portal in a refresh loop', () => {
  it('sits still when the check is already in review', async () => {
    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));

    render(<PortalAml />);
    const identityCard = await screen.findByText(/with our team/i);
    const overviewCallsAfterLoad = overview.mock.calls.length;

    await settle();

    // One overview read for the first paint, and no more. This assertion is
    // the bug: it used to climb without bound.
    expect(overview.mock.calls.length).toBe(overviewCallsAfterLoad);
    expect(overviewCallsAfterLoad).toBe(1);
    // The same DOM node throughout — proof the step never unmounted.
    expect(screen.getByText(/with our team/i)).toBe(identityCard);
    // And the page never went back to skeletons.
    expect(screen.getByText('Onboarding status')).toBeTruthy();
    expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step');
  });

  it('sits still for every settled state, not just in review', async () => {
    for (const status of ['verified', 'action_required', 'contact_adviser'] as const) {
      overview.mockClear();
      verificationStatus.mockResolvedValue(
        idvStatus({ parties: [{ ...party, status, can_attempt: false }] }));

      const view = render(<PortalAml />);
      await waitFor(() => expect(screen.getByText('Onboarding status')).toBeTruthy());
      await settle(15);
      expect(overview.mock.calls.length, `${status} looped`).toBe(1);
      view.unmount();
    }
  });

  it('sits still when a hosted check is open at mount', async () => {
    verificationStatus.mockResolvedValue(idvStatus({
      parties: [{ ...party, status: 'not_started', verification_in_progress: true }],
    }));
    render(<PortalAml />);
    await waitFor(() => expect(screen.getByText('Onboarding status')).toBeTruthy());
    await settle();
    expect(overview.mock.calls.length).toBe(1);
  });

  it('reads verification status once per mount, not on a loop', async () => {
    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    render(<PortalAml />);
    await screen.findByText(/with our team/i);
    const reads = verificationStatus.mock.calls.length;
    await settle();
    // The page reads it once for availability and the step once for itself.
    // Neither repeats without the customer doing something.
    expect(verificationStatus.mock.calls.length).toBe(reads);
    expect(reads).toBeLessThanOrEqual(2);
  });
});

/* ── a genuine change still reaches the page ─────────────────────────────── */

describe('a real state change refreshes the page without erasing it', () => {
  it('not started → in review: one refresh, nothing unmounts', async () => {
    render(<PortalAml />);
    const startButton = await screen.findByRole('button', { name: /^start$/i });
    expect(overview.mock.calls.length).toBe(1);

    // The server has moved the party on since the page loaded. Clicking Start
    // re-reads it, which is where the step finds out.
    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'in_progress' }),
    }));
    fireEvent.click(startButton);

    await waitFor(() => expect(overview.mock.calls.length).toBe(2));
    // The stepper heard about it...
    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/in progress/));
    // ...and it settles there rather than going round again.
    await settle();
    expect(overview.mock.calls.length).toBe(2);
    expect(screen.getByText('Onboarding status')).toBeTruthy();
  });

  it('in review → verified: one refresh, and the step turns green', async () => {
    // A retryable in-flight check, so the step offers the customer a control.
    verificationStatus.mockResolvedValue(idvStatus({
      parties: [{ ...party, status: 'in_review', attempts_used: 1 }],
    }));
    render(<PortalAml />);
    const tryAgain = await screen.findByRole('button', { name: /try again/i });
    expect(overview.mock.calls.length).toBe(1);

    // The provider settled it while they were looking at the page.
    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'verified', can_attempt: false }] }));
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'complete' }),
    }));
    fireEvent.click(tryAgain);

    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/complete/));
    await settle();
    // Exactly one refresh — and then it stops.
    expect(overview.mock.calls.length).toBe(2);
    expect(screen.getByText('Onboarding status')).toBeTruthy();
  });
});

/* ── a failed background read keeps the page ─────────────────────────────── */

describe('a background refresh that fails', () => {
  it('keeps the working page, the current step and the customer’s progress', async () => {
    render(<PortalAml />);
    const startButton = await screen.findByRole('button', { name: /^start$/i });
    expect(screen.getByText('6 of 8 steps complete')).toBeTruthy();

    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    overview.mockRejectedValue(new Error('network'));
    fireEvent.click(startButton);

    await waitFor(() => expect(overview.mock.calls.length).toBe(2));
    await settle();

    // Everything the customer had is still on screen.
    expect(screen.getByText('Onboarding status')).toBeTruthy();
    expect(screen.getByText('6 of 8 steps complete')).toBeTruthy();
    expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step');
    // Not the "no case yet" message, and not the full-page failure card.
    expect(screen.queryByText(/hasn’t opened an AML onboarding case/)).toBeNull();
    expect(screen.queryByText(/We couldn’t load your onboarding details/)).toBeNull();
    // A quiet line instead, and no retry storm.
    expect(screen.getByText(/couldn’t check for updates just now/i)).toBeTruthy();
    expect(overview.mock.calls.length).toBe(2);
  });

  it('recovers silently when the next refresh succeeds', async () => {
    render(<PortalAml />);
    const startButton = await screen.findByRole('button', { name: /^start$/i });

    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    overview.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(startButton);
    await screen.findByText(/couldn’t check for updates just now/i);

    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'in_progress' }),
    }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() =>
      expect(screen.queryByText(/couldn’t check for updates just now/i)).toBeNull());
    expect(screen.getByText('Onboarding status')).toBeTruthy();
  });
});

/* ── the first load is still allowed to show a skeleton ──────────────────── */

describe('loading rules', () => {
  it('shows the full-page skeleton on the FIRST load only', async () => {
    let release: (v: any) => void = () => {};
    overview.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const { container } = render(<PortalAml />);

    // Nothing to preserve yet, so a skeleton is right.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
    await act(async () => { release(overviewPayload()); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('Onboarding status')).toBeTruthy());

    // Every later read leaves the page alone.
    let releaseSecond: (v: any) => void = () => {};
    overview.mockReturnValueOnce(new Promise((r) => { releaseSecond = r; }));
    verificationStatus.mockResolvedValue(
      idvStatus({ parties: [{ ...party, status: 'in_review', can_attempt: false }] }));
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    await settle(3);

    expect(screen.getByText('Onboarding status')).toBeTruthy();
    expect(pill('Verify identity')).toBeTruthy();
    await act(async () => { releaseSecond(overviewPayload()); await Promise.resolve(); });
  });

  it('still shows the retryable failure card when the FIRST load fails', async () => {
    overview.mockRejectedValue(new Error('network'));
    render(<PortalAml />);
    expect(await screen.findByText(/We couldn’t load your onboarding details/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
