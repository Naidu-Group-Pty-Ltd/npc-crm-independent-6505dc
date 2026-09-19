/**
 * Canonical journey → what the client portal draws.
 *
 * ## The bug this exists to make impossible
 *
 * The stepper decided completion like this:
 *
 *     const st = statusFor(s.section)
 *     const done = st === 'submitted' || st === 'accepted' || st === 'complete'
 *
 * Only questionnaire steps carry a `section`. Consent, Documents, Verify
 * identity and Review & submit do not — so `statusFor` returned `undefined`
 * for all four and `done` was structurally false. A customer could accept
 * every consent, upload their document, be told "Received", press Continue,
 * and watch the step stay grey forever. Nothing was broken underneath: the
 * server had known those steps were finished the whole time, and the stepper
 * had no way to ask.
 *
 * ## What this module is, and is not
 *
 * It is a mapper. It takes the server's journey and turns it into a tone, an
 * icon hint and a sentence a screen reader can say. It derives NO business
 * truth: it cannot look at a document, a requirement, a party or a case
 * status, because it is never given one. If the journey says a step is
 * incomplete then it is incomplete here, no matter what the customer just
 * clicked.
 *
 * That is the whole point. "Done" must mean the server said so.
 */

import type {
  AmlPortalJourneyStatus, AmlPortalJourneyStep, AmlSection,
} from '@/lib/aml/amlPortalApi';

/**
 * The restrained state vocabulary. Five tones, one per journey status, so a
 * colour can never disagree with the word beside it.
 */
export type PortalStepTone = 'success' | 'progress' | 'attention' | 'muted' | 'blocked';

/** Which glyph the step draws. Decorative — the words carry the state. */
export type PortalStepIcon = 'check' | 'clock' | 'alert' | 'lock' | 'number';

export interface PortalStepPresentation {
  status: AmlPortalJourneyStatus;
  /** True ONLY for `complete`. Nothing else is a tick. */
  done: boolean;
  tone: PortalStepTone;
  icon: PortalStepIcon;
  /** What a screen reader says after the label: "Documents, complete". */
  accessibleStatus: string;
}

const PRESENTATION: Record<AmlPortalJourneyStatus, Omit<PortalStepPresentation, 'status'>> = {
  complete: {
    done: true, tone: 'success', icon: 'check', accessibleStatus: 'complete',
  },
  in_progress: {
    done: false, tone: 'progress', icon: 'clock', accessibleStatus: 'in progress',
  },
  action_required: {
    done: false, tone: 'attention', icon: 'alert', accessibleStatus: 'needs your attention',
  },
  not_started: {
    done: false, tone: 'muted', icon: 'number', accessibleStatus: 'not started',
  },
  blocked: {
    done: false, tone: 'blocked', icon: 'lock', accessibleStatus: 'not available yet',
  },
};

export function presentStep(status: AmlPortalJourneyStatus): PortalStepPresentation {
  return { status, ...(PRESENTATION[status] ?? PRESENTATION.not_started) };
}

/**
 * Portal step key → the journey step that owns it.
 *
 * The questionnaire is absent on purpose. Its child steps each keep their own
 * section status — collapsing five sections onto one aggregate would tell a
 * client who has finished four of them that they have finished none.
 */
export const STEP_TO_JOURNEY: Record<string, string> = {
  consent: 'consent',
  documents: 'documents',
  verify: 'verification',
  review: 'submission',
};

export function findJourneyStep(
  journey: AmlPortalJourneyStep[] | undefined, key: string,
): AmlPortalJourneyStep | undefined {
  return (journey ?? []).find((s) => s.step === key);
}

/**
 * One questionnaire section's own status → journey vocabulary.
 *
 * `draft` is in progress and not complete: an autosaved half-answer is not a
 * submitted section, and showing it green would be the same lie in the other
 * direction.
 */
export function sectionJourneyStatus(status: string | null | undefined): AmlPortalJourneyStatus {
  const st = String(status ?? '');
  if (['submitted', 'accepted', 'complete'].includes(st)) return 'complete';
  if (st === 'draft' || st === 'in_progress') return 'in_progress';
  return 'not_started';
}

/** A step as the portal lists it. Mirrors `PortalStep` in PortalAml. */
export interface PortalStepDescriptor {
  key: string;
  label: string;
  section?: AmlSection;
}

export interface PortalStepState {
  key: string;
  label: string;
  section?: AmlSection;
  status: AmlPortalJourneyStatus;
  presentation: PortalStepPresentation;
  /** The journey's own sentence, when it has one for this step. */
  description?: string;
}

/**
 * Resolve every visible step against the one canonical journey.
 *
 * Questionnaire children use their own section status; everything else uses
 * the journey. When the server sends no journey at all (an older deployed
 * function) the non-questionnaire steps fall back to `not_started` — grey,
 * which is what they showed before, rather than a completion nobody asserted.
 * Consent is the one exception: `overview.consent.satisfied` is a server fact
 * the portal has always been sent, so it is honoured directly.
 */
export function buildPortalStepStates(args: {
  steps: PortalStepDescriptor[];
  journey?: AmlPortalJourneyStep[];
  sections?: { section: AmlSection; status: string }[];
  consentSatisfied?: boolean;
}): PortalStepState[] {
  const sections = args.sections ?? [];

  return args.steps.map((step) => {
    let status: AmlPortalJourneyStatus;
    let description: string | undefined;

    if (step.section) {
      status = sectionJourneyStatus(
        sections.find((s) => s.section === step.section)?.status);
    } else {
      const journeyKey = STEP_TO_JOURNEY[step.key];
      const entry = journeyKey ? findJourneyStep(args.journey, journeyKey) : undefined;
      if (entry) {
        status = entry.status;
        description = entry.safe_description;
      } else if (step.key === 'consent') {
        status = args.consentSatisfied ? 'complete' : 'action_required';
      } else {
        status = 'not_started';
      }
    }

    return {
      key: step.key,
      label: step.label,
      section: step.section,
      status,
      presentation: presentStep(status),
      description,
    };
  });
}

/** What the Review screen knows about the pack having been sent. */
export interface SubmissionReceipt {
  /** A submission exists. Never "the button was pressed". */
  submitted: boolean;
  /** When the newest one was sent, if the server said. */
  submittedAt: string | null;
}

/**
 * Whether the onboarding pack has actually been submitted.
 *
 * ## Why this is a function and not a `useState`
 *
 * The Review screen used to show a toast and nothing else: the summary and an
 * enabled "Submit for review" button stayed exactly as they were, so a client
 * who had just sent their pack was looking at the same outstanding action they
 * had a second earlier — with nothing to tell them it worked, and nothing
 * stopping them pressing it again and writing a second submission version.
 *
 * The fix is not a flag saying "I clicked it". Every input here is a SERVER
 * fact about `aml.submission_versions`:
 *
 *   - `journeyStatus` is the canonical journey's `submission` step, which the
 *     server derives as complete exactly when a submission row exists;
 *   - `recentSubmissions` is `overview.recent_submissions`, the rows that
 *     derivation reads, newest first — the fallback for a deployed function old
 *     enough not to send a journey;
 *   - `justSubmittedAt` is the row `submit_for_review` returned to THIS call,
 *     which covers the seconds between the insert landing and the overview
 *     refetch that will report it. It is the same row, not a second opinion.
 *
 * So the confirmation survives a refresh, a re-login and a different device,
 * and appears only after the write it describes.
 */
export function submissionReceipt(args: {
  journeyStatus?: AmlPortalJourneyStatus;
  recentSubmissions?: Array<{ submitted_at?: string | null } | null | undefined>;
  justSubmittedAt?: string | null;
}): SubmissionReceipt {
  const rows = (args.recentSubmissions ?? []).filter(Boolean) as Array<{ submitted_at?: string | null }>;
  const submitted = args.journeyStatus === 'complete'
    || rows.length > 0
    || Boolean(args.justSubmittedAt);
  const submittedAt = rows.map((r) => r?.submitted_at).find(Boolean)
    ?? args.justSubmittedAt
    ?? null;
  return { submitted, submittedAt: submitted ? submittedAt : null };
}

export interface PortalProgress {
  completed: number;
  total: number;
  /** Rounded percentage, for the bar only. The count is the honest figure. */
  percent: number;
}

/**
 * Progress across the steps the client can actually see.
 *
 * This replaced a weighted formula — 60% of questionnaire sections plus 40% of
 * required documents — that could not see consent, identity verification or
 * submission at all, and awarded a flat zero for documents on every case
 * without formal requirements. Six of eight steps done now reads 6 of 8.
 *
 * Only `complete` counts. In progress is not nearly complete, and needing
 * attention is not partial credit.
 */
export function portalProgress(states: PortalStepState[]): PortalProgress {
  const total = states.length;
  const completed = states.filter((s) => s.presentation.done).length;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * The one-line onboarding status shown at the top of the page.
 *
 * ## The contradiction this resolves
 *
 * The header rendered `case.status_label` verbatim, and that label describes
 * the CASE in the adviser's workflow, not the client's progress through the
 * portal. A customer who had accepted every consent, answered every section
 * and started an identity check was reading "Not started" directly above
 * "5 of 8 steps complete". Both came from the server and they contradicted
 * each other in the customer's own words.
 *
 * So this is presentation, and only presentation. It never writes anything,
 * never touches case stage or the service gate, and never invents a status
 * when the server has an authoritative one to give:
 *
 *   - complete, or any caution state (action required, more information
 *     needed, contact your adviser) → the server's own label wins outright.
 *     Those are the ones the customer must not be talked out of.
 *   - otherwise, if they have finished anything or started anything →
 *     "In progress", because they demonstrably have.
 *   - otherwise → the server's label, which is "Not started" and correct.
 */
export function onboardingStatusPresentation(args: {
  caseStatus?: string | null;
  statusLabel?: string | null;
  statusTone?: 'neutral' | 'progress' | 'positive' | 'caution' | null;
  states: PortalStepState[];
}): { label: string; tone: 'neutral' | 'progress' | 'positive' | 'caution' } {
  const label = args.statusLabel || 'In progress';
  const tone = args.statusTone ?? 'progress';

  // Authoritative and never overridden: a finished case, and anything that
  // asks something of the customer or sends them to their adviser.
  if (args.caseStatus === 'complete' || tone === 'caution' || tone === 'positive') {
    return { label, tone };
  }

  const started = args.states.some((s) =>
    s.status === 'complete' || s.status === 'in_progress' || s.status === 'action_required');
  if (started) return { label: 'In progress', tone: 'progress' };

  return { label, tone };
}

/**
 * Where to put the client when they come back.
 *
 * Priority, in order:
 *   1. the first step needing their attention,
 *   2. the first step in progress they can meaningfully continue,
 *   3. the first step not started,
 *   4. the last step, when everything before it is done.
 *
 * A step that is `blocked` is never a resume target — there is nothing there
 * for them to do. Nor is a completed one: the old logic scanned questionnaire
 * sections alone, so a client who had finished every section landed back on
 * the last one they had already submitted, with the documents they still owed
 * us two steps away and no sign of it.
 */
export function resumeStepIndex(states: PortalStepState[]): number {
  if (states.length === 0) return 0;

  const byStatus = (status: AmlPortalJourneyStatus) =>
    states.findIndex((s) => s.status === status);

  const attention = byStatus('action_required');
  if (attention >= 0) return attention;

  const inProgress = byStatus('in_progress');
  if (inProgress >= 0) return inProgress;

  const notStarted = byStatus('not_started');
  if (notStarted >= 0) return notStarted;

  return states.length - 1;
}

/**
 * The step to open on load, honouring a stored choice only while it still
 * makes sense.
 *
 * Manual navigation is remembered — a client who deliberately went back to
 * check an answer should find it there. But a stored index survives a step
 * list that has grown or shrunk (the section list is conditional), survives
 * the step being finished since, and survives being written before the client
 * had consented. In each of those the canonical journey wins.
 */
export function initialStepIndex(args: {
  states: PortalStepState[];
  storedIndex?: number | null;
  consentSatisfied: boolean;
}): number {
  const { states, storedIndex } = args;
  if (states.length === 0) return 0;
  // Consent outstanding: there is exactly one place to be.
  if (!args.consentSatisfied) return 0;

  const stored = typeof storedIndex === 'number' && Number.isFinite(storedIndex)
    ? Math.trunc(storedIndex)
    : null;

  if (stored != null && stored >= 0 && stored < states.length) {
    const state = states[stored];
    // Stale in the two ways that matter: already finished, or not reachable.
    if (state.status !== 'complete' && state.status !== 'blocked') return stored;
  }

  return resumeStepIndex(states);
}
