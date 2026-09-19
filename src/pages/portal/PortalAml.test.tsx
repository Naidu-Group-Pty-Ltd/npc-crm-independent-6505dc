import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * The Client Portal's onboarding stepper.
 *
 * ## The scenario these were written from
 *
 * A real customer uploaded `IMMI_Grant_Notification.pdf`. The case had no
 * formal document requirements. The server stored the file, the Documents
 * screen showed it as Received, they pressed Continue — and the Documents pill
 * stayed grey. So did Consent, which they had completed before any of it.
 *
 * The cause was structural rather than a wrong comparison: completion was read
 * from `sections.find(x => x.section === step.section)?.status`, and Consent,
 * Documents, Verify identity and Review & submit have no `section`. Four of
 * the eight steps could never turn green no matter what the server said.
 *
 * These render the page against a server journey and assert on what a customer
 * would actually see — including the two things that must stay separate:
 * the step you are ON, and the step you have FINISHED.
 */

const overview = vi.fn();
const verificationStatus = vi.fn();
const listDocuments = vi.fn();
const getQuestionnaire = vi.fn();
const saveQuestionnaire = vi.fn();
const submitForReview = vi.fn();

vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    overview: (...a: unknown[]) => overview(...a),
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    getConsents: () => Promise.resolve({ version: '2026.1', satisfied: true, outstanding: [], documents: [] }),
    getQuestionnaire: (...a: unknown[]) => getQuestionnaire(...a),
    saveQuestionnaire: (...a: unknown[]) => saveQuestionnaire(...a),
    submitForReview: (...a: unknown[]) => submitForReview(...a),
    listRequirements: () => Promise.resolve({ requirements: [] }),
  },
  uploadAmlDocument: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The identity step owns a camera, a provider window and ~1,500 lines of its
// own state. It has its own suite; here it is a placeholder so the stepper can
// be asserted on without any of that.
vi.mock('@/components/portal/IdentityVerificationStep', () => ({
  IdentityVerificationStep: () => <div data-testid="idv-step" />,
}));
// Stands in for the real Documents screen, exposing the two things the page
// wires into it: "an upload landed, re-read the case" and "Continue".
vi.mock('@/components/portal/DocumentsStep', () => ({
  DocumentsStep: ({ onChange, onNext }: { onChange: () => void; onNext: () => void }) => (
    <div data-testid="documents-step">
      <button type="button" onClick={onChange}>upload landed</button>
      <button type="button" onClick={onNext}>Continue</button>
    </div>
  ),
}));

import PortalAml from './PortalAml';
import type { AmlPortalJourneyStatus } from '@/lib/aml/amlPortalApi';

const JOURNEY_DEFAULTS: Record<string, AmlPortalJourneyStatus> = {
  consent: 'complete',
  questionnaire: 'complete',
  documents: 'not_started',
  verification: 'not_started',
  submission: 'not_started',
  review: 'not_started',
};

const journey = (over: Partial<Record<string, AmlPortalJourneyStatus>> = {}) =>
  Object.entries({ ...JOURNEY_DEFAULTS, ...over }).map(([step, status]) => ({
    step, status, action_required: status === 'action_required',
    safe_label: step, safe_description: `${step} copy`, target_step: step, completed_at: null,
  }));

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
  requirements: [],
  requirement_progress: { completed: 0, total: 0 },
  open_requests: [],
  recent_submissions: [],
  journey: journey(),
  ...over,
});

/** The stepper pill for a step, by its visible label. */
const pill = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label},`) });

beforeEach(() => {
  overview.mockReset();
  verificationStatus.mockReset();
  listDocuments.mockReset();
  getQuestionnaire.mockReset();
  saveQuestionnaire.mockReset();
  submitForReview.mockReset();
  overview.mockResolvedValue(overviewPayload());
  getQuestionnaire.mockResolvedValue({ response: null });
  saveQuestionnaire.mockResolvedValue({ response: null });
  submitForReview.mockResolvedValue({
    submission: { version_number: 1, submitted_at: '2026-08-14T02:00:00.000Z' },
    next_version: 1,
  });
  verificationStatus.mockResolvedValue({
    enabled: true, max_attempts: 3, biometric_consent_accepted: true,
    availability: 'available', parties: [],
  });
  listDocuments.mockResolvedValue({ documents: [] });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* ── the four steps that could never turn green ──────────────────────────── */

describe('stepper completion', () => {
  it('turns Consent green when the server says the consents are satisfied', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).toHaveAccessibleName(/Consent, complete/));
  });

  it('turns Documents green after an upload, with no formal requirements', async () => {
    // The exact production scenario: one freeform document, no requirements.
    overview.mockResolvedValue(overviewPayload({ journey: journey({ documents: 'complete' }) }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
  });

  it('keeps Documents green after moving on to Verify identity', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'action_required' }),
    }));
    render(<PortalAml />);
    // Resume lands on Verify identity; Documents stays complete behind it.
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/);
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
  });

  it('turns questionnaire steps green from their own section status', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Source of funds')).toHaveAccessibleName(/complete/));
    expect(pill('Personal details')).toHaveAccessibleName(/Personal details, complete/);
  });

  it('does not collapse the questionnaire into one status', async () => {
    overview.mockResolvedValue(overviewPayload({
      sections: [
        { section: 'purchasing_structure', status: 'submitted', updated_at: null },
        { section: 'personal_details', status: 'submitted', updated_at: null },
        { section: 'purchase_profile', status: 'draft', updated_at: null },
        { section: 'funding', status: 'not_started', updated_at: null },
      ],
      journey: journey({ questionnaire: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Purchasing structure')).toHaveAccessibleName(/complete/));
    expect(pill('Purchase profile')).toHaveAccessibleName(/in progress/);
    expect(pill('Source of funds')).toHaveAccessibleName(/not started/);
  });

  it('turns Review & submit green once a submission exists', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'complete', submission: 'complete' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Review & submit')).toHaveAccessibleName(/complete/));
  });
});

describe('identity verification never goes green early', () => {
  it('shows a running check as in progress, not as success', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/in progress/));
    expect(pill('Verify identity')).not.toHaveAccessibleName(/complete/);
  });

  it('shows a failed check as needing attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() =>
      expect(pill('Verify identity')).toHaveAccessibleName(/needs your attention/));
  });

  it('shows a contact-adviser state as blocked rather than actionable', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() =>
      expect(pill('Verify identity')).toHaveAccessibleName(/not available yet/));
  });

  it('turns green once the server settles the party as verified', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'complete' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/complete/));
  });
});

/* ── the production scenario, end to end on the page ─────────────────────── */

/**
 * The customer who found this. They uploaded `IMMI_Grant_Notification.pdf` to
 * a case with no formal document requirements, saw it listed as Received,
 * pressed Continue — and Documents stayed grey.
 */
describe('upload → Continue, with no formal requirements', () => {
  it('turns Documents green on the upload and keeps it green after Continue', async () => {
    overview
      // Landing on Documents: nothing uploaded yet.
      .mockResolvedValueOnce(overviewPayload({ journey: journey({ documents: 'not_started' }) }))
      // The upload landed; the server now derives documents as complete from
      // `aml.documents`, with no requirement row anywhere in the case.
      .mockResolvedValue(overviewPayload({
        requirements: [], requirement_progress: { completed: 0, total: 0 },
        journey: journey({ documents: 'complete', verification: 'action_required' }),
      }));

    localStorage.setItem('aml_portal_resume:case-1', '5'); // Documents
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, not started/);

    fireEvent.click(screen.getByRole('button', { name: 'upload landed' }));

    // Green while they are still standing on it: current AND complete.
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    expect(pill('Documents')).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // ...and still green once they move on.
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/);
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
  });
});

/* ── current location and completion are separate ────────────────────────── */

describe('current step and completion', () => {
  it('marks the current step with aria-current and shows it complete at the same time', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', submission: 'action_required' }),
    }));
    localStorage.setItem('aml_portal_resume:case-1', '5'); // Documents
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    // Stored step is complete, so the canonical journey wins and moves them on.
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
    expect(pill('Review & submit')).toHaveAttribute('aria-current', 'step');
  });

  it('shows the active step as current even when it is also complete', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    // Documents needs attention, so resume puts them there — and it is current.
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/needs your attention/);
    // Nothing else claims to be the current step.
    expect(screen.getAllByRole('button', { current: 'step' })).toHaveLength(1);
  });
});

/* ── progress ────────────────────────────────────────────────────────────── */

describe('overall progress', () => {
  it('counts actual step states, not a questionnaire/document formula', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();
  });

  it('gives no credit for an untouched optional documents step', async () => {
    render(<PortalAml />);
    expect(await screen.findByText('5 of 8 steps complete')).toBeTruthy();
  });

  it('credits a freeform upload the old formula could never see', async () => {
    // Zero required requirements: the retired 60/40 formula capped this at 60%
    // however much the client uploaded.
    overview.mockResolvedValue(overviewPayload({
      requirement_progress: { completed: 0, total: 0 },
      journey: journey({ documents: 'complete' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();
  });
});

/* ── resume ──────────────────────────────────────────────────────────────── */

describe('resume', () => {
  it('resumes to Documents when documents need attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('resumes to Verify identity once documents are done', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
  });

  it('does not jump back to a completed questionnaire step', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '4'); // Source of funds, submitted
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('handles a stored step that no longer exists', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '99');
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('sends an unconsented client to Consent whatever was stored', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '5');
    overview.mockResolvedValue(overviewPayload({
      consent: { version: '2026.1', satisfied: false, outstanding: ['privacy_notice'], required_count: 5 },
      journey: journey({ consent: 'action_required', questionnaire: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).toHaveAttribute('aria-current', 'step'));
  });
});

/* ── accessibility & layout ──────────────────────────────────────────────── */

describe('accessibility', () => {
  it('says the state of every step in words, not only in colour', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    expect(pill('Verify identity')).toHaveAccessibleName(/Verify identity, in progress, current step/);
    expect(pill('Review & submit')).toHaveAccessibleName(/Review & submit, not started/);
  });

  it('keeps every unlocked step keyboard reachable', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toBeTruthy());
    for (const label of ['Consent', 'Personal details', 'Documents', 'Verify identity', 'Review & submit']) {
      expect(pill(label)).not.toBeDisabled();
    }
  });

  it('locks every step but Consent until the consents are accepted', async () => {
    overview.mockResolvedValue(overviewPayload({
      consent: { version: '2026.1', satisfied: false, outstanding: ['privacy_notice'], required_count: 5 },
      journey: journey({ consent: 'action_required', questionnaire: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).not.toBeDisabled());
    expect(pill('Documents')).toBeDisabled();
  });
});

describe('stepper layout', () => {
  it('is one scrollable row rather than a wrapping grid', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toBeTruthy());
    const list = pill('Documents').closest('ol')!;
    // `flex-wrap` is what orphaned "Review & submit" onto a second line.
    expect(list.className).not.toContain('flex-wrap');
    expect(list.className).toContain('flex');
    expect(list.parentElement!.className).toContain('overflow-x-auto');
    expect(pill('Review & submit').className).toContain('whitespace-nowrap');
  });
});

/* ── review summary ──────────────────────────────────────────────────────── */

describe('review & submit summary', () => {
  const openReview = async () => {
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit for review/ })).toBeTruthy());
  };

  it('summarises the whole journey, not just questionnaire sections', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    const summary = within(screen.getByRole('list', { name: 'Your onboarding summary' }));
    // Consent, documents and identity are all in the summary now; it used to
    // list questionnaire sections and required documents alone.
    expect(summary.getByText('Consent')).toBeTruthy();
    expect(summary.getByText('Documents')).toBeTruthy();
    expect(summary.getByText('Verify identity')).toBeTruthy();
    expect(summary.getByText('Personal details')).toBeTruthy();
    // Raw backend enums never reach the page.
    expect(summary.queryByText(/submitted|accepted|in_review/)).toBeNull();
  });

  it('says everything has been received when nothing is outstanding', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText('Everything we need from you has been received.')).toBeTruthy();
  });

  it('holds the pack while an identity check is still running', async () => {
    // The old behaviour — "still being checked… You can submit your
    // information now" — let a pack go to review ahead of its identity
    // outcome. Submission now waits for every step, this one included.
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'in_progress', submission: 'not_started',
      }),
    }));
    await openReview();
    expect(await screen.findByText(/Verify identity — in progress/)).toBeTruthy();
    expect(screen.queryByText('Everything we need from you has been received.')).toBeNull();
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeDisabled();
  });

  it('holds an unverified pack, and names identity — not optional documents', async () => {
    // The default journey: no requirements raised, nothing uploaded, identity
    // not started. Identity is what holds the pack; the untouched OPTIONAL
    // documents step ("There is nothing we need from you here right now") is
    // not named as something the client owes.
    overview.mockResolvedValue(overviewPayload({ journey: journey() }));
    await openReview();
    expect(await screen.findByText('One step still needs to be completed')).toBeTruthy();
    expect(screen.getByText(/Verify identity — not started/)).toBeTruthy();
    expect(screen.queryByText(/Documents — not started/)).toBeNull();
    expect(screen.queryByText('Everything we need from you has been received.')).toBeNull();
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeDisabled();
  });

  it('submits with optional documents untouched once identity is complete', async () => {
    // A case where staff raised no document requirements: documents stay
    // "not started" and that must not strand the submission — every current
    // production case has zero requirement rows.
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'not_started', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText('Everything we need from you has been received.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit for review/ })).not.toBeDisabled();
  });

  it('enables submission when every step is complete', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText('Everything we need from you has been received.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit for review/ })).not.toBeDisabled();
  });

  it('names the step still needing attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required', verification: 'complete' }),
    }));
    await openReview();
    expect(await screen.findByText('One step still needs to be completed')).toBeTruthy();
    expect(screen.getByText(/Documents — needs your attention/)).toBeTruthy();
  });
});

/* ── adviser requests ────────────────────────────────────────────────────── */

describe('adviser requests', () => {
  it('shows an open request as an action for the client', async () => {
    overview.mockResolvedValue(overviewPayload({
      open_requests: [{
        id: 'r1', kind: 'info', subject: 'Please confirm your address', message: null,
        status: 'open', created_at: new Date().toISOString(),
        action_code: 'provide_clarification', action_target: {}, due_at: null,
      }],
      journey: journey({ review: 'action_required' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('Action required')).toBeTruthy();
  });

  it('does not treat an already-answered request as an outstanding action', async () => {
    overview.mockResolvedValue(overviewPayload({
      open_requests: [{
        id: 'r1', kind: 'info', subject: 'Please confirm your address', message: null,
        status: 'responded', created_at: new Date().toISOString(),
        action_code: 'provide_clarification', action_target: {}, due_at: null,
      }],
      // The server no longer counts `responded` into openRequestCount, so the
      // journey is not action_required and the badge reads as sent.
      journey: journey(),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('Response sent')).toBeTruthy();
    expect(screen.queryByText('Action required')).toBeNull();
  });
});

/* ── purchasing structure: only the questions the structure can answer ───── */

/**
 * A purchaser told the portal they were buying as an Individual and was then
 * asked for a company legal name, an ABN, their trustees and directors, and
 * anyone controlling more than 25% of themselves. All five fields rendered
 * unconditionally, and anything typed into them was autosaved into
 * `aml.questionnaire_responses.payload` — where it stayed after the structure
 * was corrected, went out in the next draft, and was frozen into the snapshot
 * an analyst reads.
 *
 * So these assert the two halves together: what is on screen, and what leaves
 * on the wire.
 */
describe('purchasing structure — entity questions', () => {
  /** The Radix radio for a structure. Radix puts the value on the button. */
  const structure = (type: string) =>
    screen.getAllByRole('radio').find(r => r.getAttribute('value') === type)!;

  const ENTITY_LABELS = [
    'Entity legal name', 'ABN / ACN (if applicable)', 'Trustee / Director names',
    'Beneficial owners (>25% control)', 'Registered address',
  ];

  const openStructure = async (payload: Record<string, unknown> | null = null) => {
    getQuestionnaire.mockResolvedValue({
      response: payload ? { payload, status: 'draft', updated_at: null } : null,
    });
    render(<PortalAml />);
    await waitFor(() => expect(pill('Purchasing structure')).toBeTruthy());
    fireEvent.click(pill('Purchasing structure'));
    await waitFor(() => expect(screen.getByText(/Purchasing entity type/)).toBeTruthy());
  };

  /** The payload of the most recent save call. */
  const lastSaved = () => saveQuestionnaire.mock.calls.at(-1)![2] as Record<string, unknown>;

  it('shows every entity question for a company', async () => {
    await openStructure({ entity_type: 'Company' });
    for (const label of ENTITY_LABELS) expect(screen.getByText(label), label).toBeTruthy();
  });

  it('hides every entity question the moment Individual is chosen', async () => {
    await openStructure({ entity_type: 'Company' });
    expect(screen.getByText('Entity legal name')).toBeTruthy();

    fireEvent.click(structure('Individual'));

    // Gone from the DOM, not merely invisible — an input nobody can see is
    // still an input that saves.
    await waitFor(() => expect(screen.queryByText('Entity legal name')).toBeNull());
    for (const label of ENTITY_LABELS) expect(screen.queryByText(label), label).toBeNull();
    // ...and no refresh was needed to get there.
    expect(screen.getByText(/Purchasing entity type/)).toBeTruthy();
  });

  it('keeps the questions an individual does answer', async () => {
    await openStructure({ entity_type: 'Individual' });
    expect(screen.getByText(/Purchasing entity type/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save draft' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Submit section/ })).not.toBeDisabled();
  });

  it('hides them for a joint purchase, which is not a legal entity', async () => {
    // Two people buying in their own names: no legal name, no ABN, no
    // registered office. Their co-purchasers are collected as related parties.
    await openStructure({ entity_type: 'Company' });
    fireEvent.click(structure('Joint'));
    await waitFor(() => expect(screen.queryByText('Entity legal name')).toBeNull());
    expect(screen.getByText(/add each co-purchaser/)).toBeTruthy();
  });

  it('brings them back — empty — when the client switches to an entity again', async () => {
    await openStructure({ entity_type: 'Company', entity_name: 'Example Pty Ltd' });
    expect(screen.getByDisplayValue('Example Pty Ltd')).toBeTruthy();

    fireEvent.click(structure('Individual'));
    await waitFor(() => expect(screen.queryByText('Entity legal name')).toBeNull());

    fireEvent.click(structure('Trust'));
    await waitFor(() => expect(screen.getByText('Entity legal name')).toBeTruthy());
    // The company's name was discarded at the switch, not parked out of sight.
    expect(screen.queryByDisplayValue('Example Pty Ltd')).toBeNull();
  });

  it('shows them for every entity structure', async () => {
    for (const type of ['Company', 'Trust', 'SMSF', 'Partnership']) {
      await openStructure({ entity_type: type });
      expect(screen.getByText('Entity legal name'), type).toBeTruthy();
      expect(screen.getByText('Beneficial owners (>25% control)'), type).toBeTruthy();
      cleanup();
    }
  });

  it('clears entity answers out of the saved draft when the client switches', async () => {
    // Flow B, end to end: Company → entity information → Individual → save.
    await openStructure({
      entity_type: 'Company',
      entity_name: 'Example Pty Ltd', abn_acn: '12345678901',
      controllers: 'Ada Example', beneficial_owners: 'Ada Example — 60%',
      registered_address: '1 Example Street',
    });

    fireEvent.click(structure('Individual'));
    await waitFor(() => expect(screen.queryByText('Entity legal name')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());

    // The saved draft is an Individual purchaser and says nothing else.
    expect(lastSaved()).toEqual({ entity_type: 'Individual' });
  });

  it('never submits an entity answer against an individual', async () => {
    await openStructure({ entity_type: 'Company', entity_name: 'Example Pty Ltd' });
    fireEvent.click(structure('Individual'));
    await waitFor(() => expect(screen.queryByText('Entity legal name')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Submit section/ }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());

    const [, , payload, submit] = saveQuestionnaire.mock.calls.at(-1)!;
    expect(submit).toBe(true);
    expect(payload).toEqual({ entity_type: 'Individual' });
  });

  it('strips a legacy payload that was stored before the fields were gated', async () => {
    // Nothing on this screen collected these any more, so nothing may be
    // written back for them either — even by a client who never touched the
    // structure question this visit.
    await openStructure({ entity_type: 'Individual', entity_name: 'Old Pty Ltd', abn_acn: '123' });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());
    expect(lastSaved()).toEqual({ entity_type: 'Individual' });
  });

  it('leaves a company payload exactly as the client typed it', async () => {
    const typed = {
      entity_type: 'Company', entity_name: 'Example Pty Ltd', abn_acn: '12345678901',
      controllers: 'Ada Example', beneficial_owners: 'Ada Example — 60%',
      registered_address: '1 Example Street',
    };
    await openStructure(typed);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());
    expect(lastSaved()).toEqual(typed);
  });
});

/* ── the two AUD amount fields ───────────────────────────────────────────── */

/**
 * "Target price range (AUD)" and "Estimated deposit amount (AUD)" show a `$`.
 *
 * It is drawn beside the input, never written into it, so the assertions that
 * matter are the negative ones: what loads, what is displayed and what is
 * saved must all be exactly the characters the client typed. A `$` that
 * reaches the payload is a string where a figure was, and it would travel
 * from here into the saved draft, the submission and the case file.
 */
describe('AUD amount fields', () => {
  const openSection = async (label: string, payload: Record<string, unknown>) => {
    getQuestionnaire.mockResolvedValue({ response: { payload, status: 'draft', updated_at: null } });
    render(<PortalAml />);
    await waitFor(() => expect(pill(label)).toBeTruthy());
    fireEvent.click(pill(label));
  };
  const lastSaved = () => saveQuestionnaire.mock.calls.at(-1)![2] as Record<string, unknown>;
  const saveDraft = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());
  };

  it('shows the target price range with a $ that is not part of the value', async () => {
    await openSection('Purchase profile', { price_range: '1000000' });

    const input = await screen.findByDisplayValue('1000000');
    // Displayed, and adjacent — not inside the field.
    expect(input.parentElement!.textContent).toContain('$');
    expect(screen.queryByDisplayValue('$1000000')).toBeNull();
    expect(screen.queryByDisplayValue('$ 1000000')).toBeNull();
  });

  it('shows the deposit amount with a $ that is not part of the value', async () => {
    await openSection('Source of funds', { deposit: '200000' });

    const input = await screen.findByDisplayValue('200000');
    expect(input.parentElement!.textContent).toContain('$');
    expect(screen.queryByDisplayValue('$200000')).toBeNull();
  });

  it('saves both amounts as the client typed them, with no symbol attached', async () => {
    await openSection('Purchase profile', { price_range: '1000000' });
    fireEvent.change(await screen.findByDisplayValue('1000000'), { target: { value: '1250000' } });
    await saveDraft();
    // The whole point: a presentation change that the payload cannot see.
    expect(lastSaved()).toEqual({ price_range: '1250000' });

    cleanup();
    saveQuestionnaire.mockClear();

    await openSection('Source of funds', { deposit: '200000' });
    fireEvent.change(await screen.findByDisplayValue('200000'), { target: { value: '250000' } });
    await saveDraft();
    expect(lastSaved()).toEqual({ deposit: '250000' });
  });

  it('leaves every other field on both sections without one', async () => {
    // Scoped to two fields. `Input` was not given an adornment slot, which
    // would have put a dollar sign in front of every input in the product.
    await openSection('Purchase profile', {
      price_range: '1000000', property_types: 'House', timeframe: '60 days',
    });

    for (const other of ['House', '60 days']) {
      const input = await screen.findByDisplayValue(other);
      expect(input.parentElement!.textContent, other).not.toContain('$');
    }
  });
});

/* ── review & submit: the confirmation ───────────────────────────────────── */

/**
 * Pressing "Submit for review" used to fire a toast and change nothing else.
 * The summary and the enabled button stayed exactly as they were, so a client
 * had no confirmation their pack had gone, no idea what happened next, and
 * nothing between them and a second submission version.
 */
describe('review & submit — submission', () => {
  const ready = (over: Record<string, any> = {}) => overviewPayload({
    journey: journey({
      documents: 'complete', verification: 'complete', submission: 'action_required',
    }),
    ...over,
  });

  const openReview = async () => {
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit for review/ })).toBeTruthy());
  };

  it('calls the real submission when the button is pressed', async () => {
    overview.mockResolvedValue(ready());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));
    await waitFor(() => expect(submitForReview).toHaveBeenCalledWith('case-1'));
  });

  it('shows a submitting state and refuses a second click while it runs', async () => {
    overview.mockResolvedValue(ready());
    let release: (v: any) => void = () => {};
    submitForReview.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));
    const button = await screen.findByRole('button', { name: /Submitting…/ });
    expect(button).toBeDisabled();

    // The double-click that used to write a second submission version.
    fireEvent.click(button);
    expect(submitForReview).toHaveBeenCalledTimes(1);

    release({ submission: { submitted_at: '2026-08-14T02:00:00.000Z' }, next_version: 1 });
    await waitFor(() => expect(screen.getByText('Onboarding submitted successfully')).toBeTruthy());
  });

  it('confirms only after the submission has actually succeeded', async () => {
    overview.mockResolvedValue(ready());
    await openReview();
    // Before the click: no confirmation anywhere on the page.
    expect(screen.queryByText('Onboarding submitted successfully')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));

    const heading = await screen.findByText('Onboarding submitted successfully');
    expect(heading).toBeTruthy();
    expect(screen.getByText(/submitted to your adviser for review/)).toBeTruthy();
  });

  it('tells the client what happens next, without promising a response time', async () => {
    overview.mockResolvedValue(ready());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));

    await screen.findByText('What happens next');
    const first = screen.getByText(/Your adviser will review your information and documents/);
    // A numbered sequence, not a paragraph — these happen in order.
    expect(first.closest('ol')).not.toBeNull();
    expect(screen.getByText(/your adviser will ask for it here/)).toBeTruthy();
    expect(screen.getByText(/don’t need to submit again/)).toBeTruthy();
    expect(screen.getByText(/keep using your client portal/)).toBeTruthy();
    // Nothing in the onboarding model defines a turnaround, so nothing claims one.
    expect(screen.queryByText(/business day|within \d+ (hour|day)/i)).toBeNull();
  });

  it('stops presenting submission as an outstanding action once it is done', async () => {
    overview.mockResolvedValue(ready());
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));

    await screen.findByText('Onboarding submitted successfully');
    expect(screen.queryByRole('button', { name: /Submit for review/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Submitted/ })).toBeDisabled();
    // The readiness banner is about what they still owe; it is not the answer
    // to "did that work?".
    expect(screen.queryByText('Everything we need from you has been received.')).toBeNull();
  });

  it('keeps the confirmation after a refresh, from the server journey alone', async () => {
    // Flow E: a returning client. Nothing about this state lives in the page.
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'complete',
        review: 'in_progress',
      }),
      recent_submissions: [{ version_number: 1, status: 'submitted', submitted_at: '2026-08-14T02:00:00.000Z' }],
    }));
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);

    expect(await screen.findByText('Onboarding submitted successfully')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submitted/ })).toBeDisabled();
    expect(submitForReview).not.toHaveBeenCalled();
  });

  it('recognises a submission from the rows alone, on an older server', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: undefined,
      consent: { version: '2026.1', satisfied: true, outstanding: [], required_count: 5 },
      recent_submissions: [{ version_number: 1, status: 'submitted', submitted_at: null }],
    }));
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);
    expect(await screen.findByText('Onboarding submitted successfully')).toBeTruthy();
  });

  it('shows no success and allows a safe retry when submission fails', async () => {
    overview.mockResolvedValue(ready());
    submitForReview.mockRejectedValueOnce(new Error('Cannot submit — required documents missing'));
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));

    expect(await screen.findByText('We couldn’t submit your onboarding')).toBeTruthy();
    expect(screen.getByText(/required documents missing/)).toBeTruthy();
    expect(screen.queryByText('Onboarding submitted successfully')).toBeNull();
    // Still on the Review screen, and the action is live again for a retry.
    const retry = screen.getByRole('button', { name: /Submit for review/ });
    expect(retry).not.toBeDisabled();

    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Onboarding submitted successfully')).toBeTruthy());
    // The failure notice does not linger over a success.
    expect(screen.queryByText('We couldn’t submit your onboarding')).toBeNull();
    expect(submitForReview).toHaveBeenCalledTimes(2);
  });

  it('offers a resubmission only when the adviser has asked for one', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'complete',
        review: 'action_required',
      }),
      recent_submissions: [{ version_number: 1, status: 'submitted', submitted_at: null }],
      open_requests: [{
        id: 'r1', kind: 'info', subject: 'Please confirm your address', message: null,
        status: 'open', created_at: new Date().toISOString(),
        action_code: 'provide_clarification', action_target: {}, due_at: null,
      }],
    }));
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);
    expect(await screen.findByText('Onboarding submitted successfully')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send updated information/ })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Submitted$/ })).toBeNull();
  });

  it('says why an untouched Documents step is not a contradiction', async () => {
    // "Documents — not started" beside "everything received" is correct and
    // reads like a mistake: no requirement was raised, so nothing is owed.
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'not_started', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText('Everything we need from you has been received.')).toBeTruthy();
    expect(screen.getByText(/haven’t asked you for any documents/)).toBeTruthy();
  });

  it('still names an outstanding step after submission rather than only confirming', async () => {
    // A document rejected after the pack went: the confirmation is true, and it
    // is not the last thing this client should be reading.
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'action_required', verification: 'complete', submission: 'complete',
        review: 'action_required',
      }),
      recent_submissions: [{ version_number: 1, status: 'submitted', submitted_at: null }],
    }));
    render(<PortalAml />);
    // Resume rightly sends them to the rejected document; the Review screen is
    // what this asserts on, so open it deliberately.
    await waitFor(() => expect(pill('Review & submit')).toBeTruthy());
    fireEvent.click(pill('Review & submit'));

    expect(await screen.findByText('Onboarding submitted successfully')).toBeTruthy();
    expect(screen.getByText(/Documents — needs your attention/)).toBeTruthy();
    // Resubmission is offered, and held by the same rule the server enforces.
    expect(screen.getByRole('button', { name: /Send updated information/ })).toBeDisabled();
  });
});

/**
 * The political-exposure question.
 *
 * It was two radio buttons under "Are you a Politically Exposed Person
 * (PEP)?" and nothing else. A customer who has never met the term answers
 * "no" to a phrase they do not know — and the definition they were never
 * shown covers immediate FAMILY MEMBERS and CLOSE ASSOCIATES, which is
 * exactly what that question never reaches. A "yes" was no more useful: no
 * office, no jurisdiction, no relationship, so the MLRO had to go back to
 * the customer for what should have been asked once.
 *
 * The stored answer is still `pep: 'yes' | 'no'`, so nothing about the
 * screening policy that reads it changes.
 */
describe('the political-exposure declaration', () => {
  const openPersonal = async (payload: Record<string, unknown> = {}) => {
    getQuestionnaire.mockResolvedValue({
      response: { payload, status: 'draft', updated_at: null },
    });
    render(<PortalAml />);
    await waitFor(() => expect(pill('Personal details')).toBeTruthy());
    fireEvent.click(pill('Personal details'));
    await waitFor(() => expect(screen.getByText(/prominent public position/i)).toBeTruthy());
  };
  const lastSaved = () => saveQuestionnaire.mock.calls.at(-1)![2] as Record<string, unknown>;
  const saveDraft = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveQuestionnaire).toHaveBeenCalled());
  };

  it('asks a question the customer can actually answer', async () => {
    await openPersonal();
    // The three limbs of the definition, in plain words, before the answer.
    const explainer = screen.getByText(/senior role in government/i).textContent!;
    expect(explainer).toMatch(/immediate family member/i);
    expect(explainer).toMatch(/close business or personal\s+associate/i);
    // And it says what answering yes actually means for them.
    expect(explainer).toMatch(/does not affect your\s+purchase/i);
  });

  it('asks nothing further while the answer is no', async () => {
    await openPersonal({ pep: 'no' });
    expect(screen.queryByText(/What is the position or office\?/i)).toBeNull();
  });

  it('collects the position, the jurisdiction and the relationship on a yes', async () => {
    await openPersonal({ pep: 'yes' });
    expect(screen.getByText(/Who holds the position\?/i)).toBeTruthy();
    expect(screen.getByText(/What is the position or office\?/i)).toBeTruthy();
    expect(screen.getByText(/In which country or jurisdiction\?/i)).toBeTruthy();
  });

  it('saves the detail beside the answer, not instead of it', async () => {
    await openPersonal({ pep: 'yes', pep_relationship: 'family_member' });
    fireEvent.change(screen.getByPlaceholderText(/Member of Parliament/i), {
      target: { value: 'Judge of the Federal Court' },
    });
    await saveDraft();
    expect(lastSaved()).toMatchObject({
      pep: 'yes', pep_relationship: 'family_member',
      pep_role: 'Judge of the Federal Court',
    });
  });

  it('drops the detail when the customer corrects the answer to no', async () => {
    /*
     * A field nobody can see is still a field that saves. Without the prune,
     * an office the customer typed and then withdrew would have stayed in
     * the payload, in the submission snapshot, and in front of the MLRO — an
     * answer nobody gave, presented as one they did.
     */
    await openPersonal({
      pep: 'yes', pep_relationship: 'self', pep_role: 'Judge', pep_country: 'Australia',
      full_name: 'Rugesh Naidu',
    });
    fireEvent.click(screen.getAllByRole('radio', { name: /^No$/ })[0]);
    await saveDraft();
    const saved = lastSaved();
    expect(saved.pep).toBe('no');
    expect(saved).not.toHaveProperty('pep_role');
    expect(saved).not.toHaveProperty('pep_country');
    expect(saved).not.toHaveProperty('pep_relationship');
    // and nothing else on the section is disturbed
    expect(saved.full_name).toBe('Rugesh Naidu');
  });
});
