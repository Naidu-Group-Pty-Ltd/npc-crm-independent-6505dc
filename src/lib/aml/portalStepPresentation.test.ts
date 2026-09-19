/**
 * Canonical journey → what the stepper draws.
 *
 * ## The bug
 *
 * The stepper read `sections.find(x => x.section === step.section)?.status`.
 * Consent, Documents, Verify identity and Review & submit carry no `section`,
 * so that lookup was `undefined` for all four and "done" was structurally
 * unreachable. A client could accept every consent, upload their document, be
 * told "Received", press Continue — and the pill stayed grey forever, on a
 * server that had known it was finished the whole time.
 *
 * So the assertions below are mostly about the four steps that could never go
 * green, and about the two things that must stay separate: WHERE YOU ARE and
 * HOW FAR YOU HAVE GOT.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPortalStepStates, initialStepIndex, onboardingStatusPresentation, portalProgress,
  presentStep, resumeStepIndex, sectionJourneyStatus, submissionReceipt,
  type PortalStepDescriptor,
} from './portalStepPresentation';
import type { AmlPortalJourneyStatus, AmlPortalJourneyStep, AmlSection } from './amlPortalApi';

const STEPS: PortalStepDescriptor[] = [
  { key: 'consent', label: 'Consent' },
  { key: 'purchasing_structure', label: 'Purchasing structure', section: 'purchasing_structure' },
  { key: 'personal_details', label: 'Personal details', section: 'personal_details' },
  { key: 'purchase_profile', label: 'Purchase profile', section: 'purchase_profile' },
  { key: 'funding', label: 'Source of funds', section: 'funding' },
  { key: 'documents', label: 'Documents' },
  { key: 'verify', label: 'Verify identity' },
  { key: 'review', label: 'Review & submit' },
];

const journeyStep = (step: string, status: AmlPortalJourneyStatus): AmlPortalJourneyStep => ({
  step, status, action_required: status === 'action_required',
  safe_label: step, safe_description: `${step} description`,
  target_step: step, completed_at: null,
});

const journey = (over: Partial<Record<string, AmlPortalJourneyStatus>> = {}): AmlPortalJourneyStep[] => {
  const base: Record<string, AmlPortalJourneyStatus> = {
    consent: 'complete',
    questionnaire: 'complete',
    documents: 'not_started',
    verification: 'not_started',
    submission: 'not_started',
    review: 'not_started',
  };
  return Object.entries({ ...base, ...over }).map(([k, v]) => journeyStep(k, v));
};

const sections = (status = 'submitted') =>
  (['purchasing_structure', 'personal_details', 'purchase_profile', 'funding'] as AmlSection[])
    .map((section) => ({ section, status }));

const states = (over: Partial<Record<string, AmlPortalJourneyStatus>> = {}, sectionStatus = 'submitted') =>
  buildPortalStepStates({
    steps: STEPS, journey: journey(over), sections: sections(sectionStatus), consentSatisfied: true,
  });

const byKey = (list: ReturnType<typeof states>, key: string) => list.find((s) => s.key === key)!;

describe('step presentation vocabulary', () => {
  it('only complete is a tick', () => {
    expect(presentStep('complete').done).toBe(true);
    for (const status of ['in_progress', 'action_required', 'not_started', 'blocked'] as const) {
      expect(presentStep(status).done).toBe(false);
    }
  });

  it('gives each state its own tone and glyph, never colour alone', () => {
    expect(presentStep('complete').tone).toBe('success');
    expect(presentStep('in_progress').tone).toBe('progress');
    expect(presentStep('action_required').tone).toBe('attention');
    expect(presentStep('not_started').tone).toBe('muted');
    expect(presentStep('blocked').tone).toBe('blocked');
    expect(presentStep('complete').icon).toBe('check');
    expect(presentStep('action_required').icon).toBe('alert');
    expect(presentStep('blocked').icon).toBe('lock');
  });

  it('says the state in words a screen reader can read', () => {
    expect(presentStep('complete').accessibleStatus).toBe('complete');
    expect(presentStep('in_progress').accessibleStatus).toBe('in progress');
    expect(presentStep('action_required').accessibleStatus).toBe('needs your attention');
    expect(presentStep('not_started').accessibleStatus).toBe('not started');
  });
});

describe('questionnaire sections keep their own status', () => {
  it('maps submitted / accepted / complete to complete and a draft to in progress', () => {
    for (const st of ['submitted', 'accepted', 'complete']) {
      expect(sectionJourneyStatus(st)).toBe('complete');
    }
    expect(sectionJourneyStatus('draft')).toBe('in_progress');
    expect(sectionJourneyStatus('not_started')).toBe('not_started');
    expect(sectionJourneyStatus(undefined)).toBe('not_started');
  });

  it('does not collapse every section onto one aggregate', () => {
    const list = buildPortalStepStates({
      steps: STEPS,
      journey: journey({ questionnaire: 'action_required' }),
      sections: [
        { section: 'purchasing_structure', status: 'submitted' },
        { section: 'personal_details', status: 'submitted' },
        { section: 'purchase_profile', status: 'draft' },
        { section: 'funding', status: 'not_started' },
      ],
      consentSatisfied: true,
    });
    expect(byKey(list, 'purchasing_structure').presentation.done).toBe(true);
    expect(byKey(list, 'purchase_profile').status).toBe('in_progress');
    expect(byKey(list, 'funding').status).toBe('not_started');
  });
});

describe('the four steps that could never turn green', () => {
  it('consent turns complete when the server says so', () => {
    expect(byKey(states({ consent: 'complete' }), 'consent').presentation.done).toBe(true);
    expect(byKey(states({ consent: 'action_required' }), 'consent').presentation.tone)
      .toBe('attention');
  });

  it('documents turns complete when the journey says so', () => {
    expect(byKey(states({ documents: 'complete' }), 'documents').presentation.done).toBe(true);
  });

  it('verify does NOT turn green while a check is running', () => {
    const inProgress = byKey(states({ verification: 'in_progress' }), 'verify');
    expect(inProgress.presentation.done).toBe(false);
    expect(inProgress.presentation.tone).toBe('progress');
    expect(byKey(states({ verification: 'complete' }), 'verify').presentation.done).toBe(true);
  });

  it('review & submit turns complete once submitted', () => {
    expect(byKey(states({ submission: 'complete' }), 'review').presentation.done).toBe(true);
  });

  it('renders action_required and blocked in their own states', () => {
    expect(byKey(states({ documents: 'action_required' }), 'documents').presentation.tone)
      .toBe('attention');
    expect(byKey(states({ verification: 'blocked' }), 'verify').presentation.tone)
      .toBe('blocked');
  });

  it('degrades to grey — never to a false tick — when the server sends no journey', () => {
    const list = buildPortalStepStates({
      steps: STEPS, journey: undefined, sections: sections(), consentSatisfied: true,
    });
    // Consent is the one exception: `consent.satisfied` is a server fact the
    // portal has always been sent.
    expect(byKey(list, 'consent').presentation.done).toBe(true);
    for (const key of ['documents', 'verify', 'review']) {
      expect(byKey(list, key).presentation.done).toBe(false);
      expect(byKey(list, key).status).toBe('not_started');
    }
  });
});

describe('overall progress', () => {
  it('counts the steps the client can see, and only completed ones', () => {
    const list = states({ documents: 'complete', verification: 'in_progress' });
    expect(portalProgress(list)).toEqual({ completed: 6, total: 8, percent: 75 });
  });

  it('does not credit in progress, action required or blocked', () => {
    const list = states({
      documents: 'action_required', verification: 'in_progress', submission: 'not_started',
    });
    expect(portalProgress(list).completed).toBe(5);
  });

  it('does not inflate completion when documents are optional and untouched', () => {
    const list = states({ documents: 'not_started' });
    expect(portalProgress(list).completed).toBe(5);
    expect(portalProgress(list).percent).toBe(63);
  });

  it('reaches 100 only when every visible step is complete', () => {
    const list = states({ documents: 'complete', verification: 'complete', submission: 'complete' });
    expect(portalProgress(list)).toEqual({ completed: 8, total: 8, percent: 100 });
  });
});

describe('resume', () => {
  it('resumes to Documents when that is what needs attention', () => {
    const list = states({ documents: 'action_required' });
    expect(list[resumeStepIndex(list)].key).toBe('documents');
  });

  it('resumes to Verify identity once documents are done', () => {
    const list = states({ documents: 'complete', verification: 'action_required' });
    expect(list[resumeStepIndex(list)].key).toBe('verify');
  });

  it('never resumes to a completed questionnaire step', () => {
    const list = states({ documents: 'complete', verification: 'in_progress' });
    expect(list[resumeStepIndex(list)].key).toBe('verify');
  });

  it('lands on review when everything before it is done', () => {
    const list = states({
      documents: 'complete', verification: 'complete', submission: 'action_required',
    });
    expect(list[resumeStepIndex(list)].key).toBe('review');
  });

  it('never resumes to a blocked step', () => {
    // Verify identity is blocked — the client cannot act on it — so the next
    // thing they CAN reach wins, even though it sits after it.
    const list = states({
      documents: 'complete', verification: 'blocked', submission: 'not_started',
    });
    expect(list[resumeStepIndex(list)].key).toBe('review');
  });

  it('honours a stored step that is still meaningful', () => {
    const list = states({ documents: 'action_required' });
    expect(initialStepIndex({ states: list, storedIndex: 6, consentSatisfied: true })).toBe(6);
  });

  it('overrides a stored step that is already complete', () => {
    const list = states({ documents: 'complete', verification: 'action_required' });
    // 5 is Documents, finished since it was stored.
    expect(list[initialStepIndex({ states: list, storedIndex: 5, consentSatisfied: true })].key)
      .toBe('verify');
  });

  it('handles a stored step from a step list that has since changed shape', () => {
    const list = states({ documents: 'action_required' });
    for (const stored of [99, -1, Number.NaN, null]) {
      const idx = initialStepIndex({ states: list, storedIndex: stored, consentSatisfied: true });
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(list.length);
      expect(list[idx].key).toBe('documents');
    }
  });

  it('sends an unconsented client to consent whatever was stored', () => {
    const list = buildPortalStepStates({
      steps: STEPS, journey: journey({ consent: 'action_required', questionnaire: 'blocked' }),
      sections: sections('not_started'), consentSatisfied: false,
    });
    expect(initialStepIndex({ states: list, storedIndex: 6, consentSatisfied: false })).toBe(0);
  });
});

/* ── the top-of-page status ──────────────────────────────────────────────── */

/**
 * A customer was shown "Not started" directly above "5 of 8 steps complete".
 * Both came from the server; the first describes the CASE in the adviser's
 * workflow and the second describes what the customer has done.
 */
describe('onboarding status', () => {
  const notStarted = () => states({
    consent: 'not_started', questionnaire: 'not_started',
    documents: 'not_started', verification: 'not_started', submission: 'not_started',
  }, 'not_started');

  it('says In progress once anything has been completed', () => {
    expect(onboardingStatusPresentation({
      caseStatus: 'not_started', statusLabel: 'Not started', statusTone: 'neutral',
      states: states({ verification: 'in_progress' }),
    })).toEqual({ label: 'In progress', tone: 'progress' });
  });

  it('says In progress once anything has been started', () => {
    expect(onboardingStatusPresentation({
      caseStatus: 'not_started', statusLabel: 'Not started', statusTone: 'neutral',
      states: buildPortalStepStates({
        steps: STEPS,
        journey: journey({
          consent: 'action_required', questionnaire: 'blocked', documents: 'not_started',
          verification: 'not_started', submission: 'not_started',
        }),
        sections: sections('not_started'),
        consentSatisfied: false,
      }),
    })).toEqual({ label: 'In progress', tone: 'progress' });
  });

  it('still says Not started when genuinely nothing has happened', () => {
    expect(onboardingStatusPresentation({
      caseStatus: 'not_started', statusLabel: 'Not started', statusTone: 'neutral',
      states: notStarted(),
    })).toEqual({ label: 'Not started', tone: 'neutral' });
  });

  it('never talks over an authoritative caution status', () => {
    // "Additional information required" and "Please contact your adviser" are
    // the ones the customer must not be reassured out of.
    for (const label of ['Additional information required', 'Please contact your adviser']) {
      expect(onboardingStatusPresentation({
        caseStatus: 'additional_info_required', statusLabel: label, statusTone: 'caution',
        states: states({ documents: 'complete' }),
      })).toEqual({ label, tone: 'caution' });
    }
  });

  it('never talks over a completed case', () => {
    expect(onboardingStatusPresentation({
      caseStatus: 'complete', statusLabel: 'Complete', statusTone: 'positive',
      states: states({ documents: 'complete', verification: 'complete', submission: 'complete' }),
    })).toEqual({ label: 'Complete', tone: 'positive' });
  });

  it('falls back safely when the server sends no label', () => {
    const result = onboardingStatusPresentation({ states: notStarted() });
    expect(result.label.length).toBeGreaterThan(0);
  });
});

/* ── has the pack actually been submitted? ───────────────────────────────── */

/**
 * The Review screen's submitted state, which used to not exist.
 *
 * Pressing "Submit for review" fired a toast and refreshed; the button stayed
 * enabled and the page stayed identical, so the client had no confirmation and
 * nothing stopped a second submission version. Every input here is a server
 * fact about `aml.submission_versions` — none of them is "the button was
 * clicked" — which is what makes the confirmation survive a refresh.
 */
describe('submissionReceipt', () => {
  it('is not submitted before anything has been sent', () => {
    expect(submissionReceipt({ journeyStatus: 'action_required', recentSubmissions: [] }))
      .toEqual({ submitted: false, submittedAt: null });
  });

  it('is not submitted merely because the screen is ready to submit', () => {
    // "Everything we need from you is ready to send" is the state a client
    // presses the button FROM. It must never render as the state after it.
    expect(submissionReceipt({ journeyStatus: 'action_required' }).submitted).toBe(false);
  });

  it('is submitted once the canonical journey says a submission exists', () => {
    expect(submissionReceipt({ journeyStatus: 'complete' }).submitted).toBe(true);
  });

  it('reads the submission rows when the server sends no journey', () => {
    // An older deployed function; the rows the journey is derived FROM are the
    // same fact, so a confirmation is still owed.
    expect(submissionReceipt({
      recentSubmissions: [{ submitted_at: '2026-08-14T02:00:00Z' }],
    })).toEqual({ submitted: true, submittedAt: '2026-08-14T02:00:00Z' });
  });

  it('takes the newest submission date, which is the first row', () => {
    expect(submissionReceipt({
      journeyStatus: 'complete',
      recentSubmissions: [
        { submitted_at: '2026-08-14T02:00:00Z' },
        { submitted_at: '2026-07-01T02:00:00Z' },
      ],
    }).submittedAt).toBe('2026-08-14T02:00:00Z');
  });

  it('covers the gap between the insert landing and the refetch', () => {
    // The row `submit_for_review` just returned — the same row, seconds early.
    expect(submissionReceipt({
      journeyStatus: 'action_required',
      recentSubmissions: [],
      justSubmittedAt: '2026-08-14T02:00:00Z',
    })).toEqual({ submitted: true, submittedAt: '2026-08-14T02:00:00Z' });
  });

  it('never reports a date for a pack that has not been sent', () => {
    expect(submissionReceipt({ recentSubmissions: [] }).submittedAt).toBeNull();
  });

  it('survives a server that sends a submission with no timestamp', () => {
    expect(submissionReceipt({ journeyStatus: 'complete', recentSubmissions: [{}] }))
      .toEqual({ submitted: true, submittedAt: null });
  });

  it('degrades to not submitted when it is told nothing at all', () => {
    expect(submissionReceipt({})).toEqual({ submitted: false, submittedAt: null });
  });
});
