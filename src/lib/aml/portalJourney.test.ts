/**
 * The server-derived onboarding journey.
 *
 * ## The defect these were written for
 *
 * `docsDone` was `requiredReqs.length > 0 && requiredReqs.every(...)`. On a
 * case with no formal document requirements — the common one — the guard made
 * the whole expression false before it looked at anything the client had sent,
 * so the documents step could never be complete however many documents they
 * uploaded. A customer sent us their visa grant notice, the server stored it,
 * the screen said "Received", and the journey said nothing had arrived.
 *
 * The requirements list is a REQUEST for documents. `aml.documents` is the
 * record of what came back. Both are needed and only one was being read.
 *
 * The second defect is quieter: the overview counted `open` AND `responded`
 * client requests into `openRequestCount`, so a client who had already
 * answered their adviser was still told their adviser was waiting on them.
 */
import { describe, expect, it } from 'vitest';
import {
  buildJourney, documentsJourneyStatus, submissionBlockers, verificationJourneyStatus,
  type JourneyDocument, type JourneyParty, type JourneyRequirement,
  type PortalJourneyStatus,
} from '../../../supabase/functions/_shared/aml/portalJourney.pure.ts';

const req = (over: Partial<JourneyRequirement> = {}): JourneyRequirement => ({
  id: 'req-1', required: true, status: 'pending', ...over,
});
const doc = (over: Partial<JourneyDocument> = {}): JourneyDocument => ({
  requirement_id: null, status: 'uploaded', ...over,
});

const statusOf = (journey: ReturnType<typeof buildJourney>, key: string): PortalJourneyStatus =>
  journey.find((s) => s.step === key)!.status;

const journeyFor = (over: Partial<Parameters<typeof buildJourney>[0]> = {}) => buildJourney({
  consentSatisfied: true,
  activeSections: ['purchasing_structure', 'personal_details', 'purchase_profile', 'funding'],
  sectionMap: new Map([
    ['purchasing_structure', { status: 'submitted' }],
    ['personal_details', { status: 'submitted' }],
    ['purchase_profile', { status: 'submitted' }],
    ['funding', { status: 'submitted' }],
  ]),
  requirements: [],
  documents: [],
  parties: [{ status: 'not_started' }],
  submissions: [],
  openRequestCount: 0,
  portalStatus: 'in_progress',
  ...over,
});

describe('documents journey state', () => {
  it('is not started with no requirements and no documents', () => {
    expect(documentsJourneyStatus({ requirements: [], documents: [] })).toBe('not_started');
  });

  it('is COMPLETE with no requirements and one uploaded document', () => {
    // The whole point. Nothing was formally requested and the client sent
    // something anyway; there is nothing outstanding, so the step is done.
    expect(documentsJourneyStatus({
      requirements: [], documents: [doc({ status: 'uploaded' })],
    })).toBe('complete');
  });

  it('ignores optional requirements when deciding on freeform uploads', () => {
    expect(documentsJourneyStatus({
      requirements: [req({ required: false, status: 'pending' })],
      documents: [doc()],
    })).toBe('complete');
  });

  it('is complete when the one required requirement has been met', () => {
    expect(documentsJourneyStatus({
      requirements: [req({ status: 'uploaded' })],
      documents: [doc({ requirement_id: 'req-1' })],
    })).toBe('complete');
    expect(documentsJourneyStatus({
      requirements: [req({ status: 'accepted' })], documents: [],
    })).toBe('complete');
  });

  it('needs attention when one of several required requirements is missing', () => {
    expect(documentsJourneyStatus({
      requirements: [
        req({ id: 'req-1', status: 'uploaded' }),
        req({ id: 'req-2', status: 'pending' }),
      ],
      documents: [doc({ requirement_id: 'req-1' })],
    })).toBe('action_required');
  });

  it('needs attention when a required document was rejected', () => {
    expect(documentsJourneyStatus({
      requirements: [req({ status: 'rejected' })],
      documents: [doc({ requirement_id: 'req-1', status: 'rejected' })],
    })).toBe('action_required');
  });

  it('needs attention when the rejection has not reached the requirement row yet', () => {
    // Staff reject the file; the requirement is still marked `uploaded`. The
    // client is the one who has to act, so the journey must say so.
    expect(documentsJourneyStatus({
      requirements: [req({ status: 'uploaded' })],
      documents: [doc({ requirement_id: 'req-1', status: 'rejected' })],
    })).toBe('action_required');
  });

  it('does not count a rejected or superseded freeform upload as arrival', () => {
    for (const status of ['rejected', 'superseded']) {
      expect(documentsJourneyStatus({
        requirements: [], documents: [doc({ status })],
      })).toBe('not_started');
    }
  });
});

describe('identity verification journey state', () => {
  const parties = (...statuses: string[]): JourneyParty[] => statuses.map((status) => ({ status }));

  it('is complete only when every party is verified', () => {
    expect(verificationJourneyStatus(parties('verified'))).toBe('complete');
    expect(verificationJourneyStatus(parties('verified', 'verified'))).toBe('complete');
    expect(verificationJourneyStatus(parties('verified', 'in_review'))).toBe('in_progress');
  });

  it('never reports a check still running as verified', () => {
    expect(verificationJourneyStatus(parties('in_review'))).toBe('in_progress');
  });

  it('reports a failed or retakeable check as needing attention', () => {
    expect(verificationJourneyStatus(parties('action_required'))).toBe('action_required');
    expect(verificationJourneyStatus(parties('in_review', 'action_required'))).toBe('action_required');
  });

  it('treats contact_adviser as blocked, not as an action the client can take', () => {
    expect(verificationJourneyStatus(parties('contact_adviser'))).toBe('blocked');
    expect(verificationJourneyStatus(parties('verified', 'contact_adviser'))).toBe('blocked');
  });

  it('is not started when nobody has begun, and an action once anybody has', () => {
    expect(verificationJourneyStatus(parties('not_started', 'not_started'))).toBe('not_started');
    expect(verificationJourneyStatus(parties('verified', 'not_started'))).toBe('action_required');
    expect(verificationJourneyStatus([])).toBe('not_started');
  });
});

describe('buildJourney', () => {
  it('reports the real scenario: one freeform upload, no requirements', () => {
    const journey = journeyFor({ documents: [doc({ status: 'uploaded' })] });
    expect(statusOf(journey, 'documents')).toBe('complete');
    expect(journey.find((s) => s.step === 'documents')!.action_required).toBe(false);
  });

  it('blocks the questionnaire until consent is satisfied', () => {
    const journey = journeyFor({
      consentSatisfied: false, sectionMap: new Map(),
    });
    expect(statusOf(journey, 'consent')).toBe('action_required');
    expect(statusOf(journey, 'questionnaire')).toBe('blocked');
  });

  it('says verified only from party state, never from case status', () => {
    const journey = journeyFor({ portalStatus: 'complete', parties: [{ status: 'in_review' }] });
    expect(statusOf(journey, 'verification')).toBe('in_progress');
    expect(journey.find((s) => s.step === 'verification')!.safe_description)
      .not.toContain('You are verified');
  });

  it('marks submission ready only when every required step, identity included, is done', () => {
    const journey = journeyFor({
      documents: [doc()], parties: [{ status: 'verified' }],
    });
    expect(statusOf(journey, 'submission')).toBe('action_required');
    expect(journey.find((s) => s.step === 'submission')!.safe_description)
      .toBe('Everything we need from you is ready to send.');
  });

  it('is ready with NO requirements and NO uploads — optional documents do not block', () => {
    // Requirements are raised by explicit staff action only; a case with none
    // is one where NPC asked for nothing, and its documents copy reads "There
    // is nothing we need from you here right now." Forcing an upload here
    // would strand every such case — 5 of 5 production cases at the time this
    // was written.
    const journey = journeyFor({
      requirements: [], documents: [], parties: [{ status: 'verified' }],
    });
    expect(statusOf(journey, 'documents')).toBe('not_started');
    expect(statusOf(journey, 'submission')).toBe('action_required');
  });

  it('is NOT ready while a required document is outstanding', () => {
    const journey = journeyFor({
      requirements: [req({ status: 'pending' })], parties: [{ status: 'verified' }],
    });
    expect(statusOf(journey, 'documents')).toBe('action_required');
    expect(statusOf(journey, 'submission')).toBe('not_started');
  });

  it('is NOT ready while a required document sits rejected', () => {
    const journey = journeyFor({
      requirements: [req({ status: 'uploaded' })],
      documents: [doc({ requirement_id: 'req-1', status: 'rejected' })],
      parties: [{ status: 'verified' }],
    });
    expect(statusOf(journey, 'submission')).toBe('not_started');
  });

  it('is ready once every required document is met', () => {
    const journey = journeyFor({
      requirements: [req({ status: 'accepted' })], parties: [{ status: 'verified' }],
    });
    expect(statusOf(journey, 'submission')).toBe('action_required');
  });

  it('is NOT ready while identity verification is anything short of complete', () => {
    for (const status of ['not_started', 'in_review', 'action_required', 'contact_adviser']) {
      // Whatever the documents say — met requirements or nothing asked for.
      for (const documents of [[doc()], []] as const) {
        const journey = journeyFor({ documents: [...documents], parties: [{ status }] });
        expect(statusOf(journey, 'submission'), `party ${status}`).toBe('not_started');
      }
    }
  });

  it('marks submission complete once a version exists', () => {
    const journey = journeyFor({ submissions: [{ version_number: 1 }] });
    expect(statusOf(journey, 'submission')).toBe('complete');
  });

  it('counts only unanswered requests as an adviser action', () => {
    expect(statusOf(journeyFor({ openRequestCount: 1 }), 'review')).toBe('action_required');
    expect(statusOf(journeyFor({ openRequestCount: 0, submissions: [{}] }), 'review'))
      .toBe('in_progress');
  });

  it('names every holding step as a blocker, in journey vocabulary', () => {
    expect(submissionBlockers({
      consent: 'complete', questionnaire: 'complete',
      documents: 'action_required', verification: 'in_progress',
    })).toEqual(['documents', 'verification']);
    expect(submissionBlockers({
      consent: 'action_required', questionnaire: 'blocked',
      documents: 'complete', verification: 'complete',
    })).toEqual(['consent', 'questionnaire']);
    // Optional-and-untouched documents are the one non-complete state that
    // does not hold: `not_started` is unreachable while anything is required.
    expect(submissionBlockers({
      consent: 'complete', questionnaire: 'complete',
      documents: 'not_started', verification: 'complete',
    })).toEqual([]);
    expect(submissionBlockers({
      consent: 'complete', questionnaire: 'complete',
      documents: 'complete', verification: 'complete',
    })).toEqual([]);
  });

  it('every step carries client-safe copy and a target', () => {
    const journey = journeyFor();
    for (const step of journey) {
      expect(step.safe_label.length).toBeGreaterThan(0);
      expect(step.safe_description.length).toBeGreaterThan(0);
      expect(step.target_step.length).toBeGreaterThan(0);
      // No internal AML vocabulary reaches a customer.
      expect(`${step.safe_label} ${step.safe_description}`)
        .not.toMatch(/risk|score|threshold|mlro|screening|provider|didit/i);
    }
  });
});
