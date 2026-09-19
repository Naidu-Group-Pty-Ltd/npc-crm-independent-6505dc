/**
 * The client-safe onboarding journey, derived on the server.
 *
 * ## Why this is a module and not a function in the edge handler
 *
 * The journey is the ONE canonical statement of where a client is. The portal
 * stepper, the overall progress figure, the resume target, the review summary
 * and the high-level journey strip all render it — so a defect here is a
 * defect the client sees in four places at once, and it needs tests that run
 * without a database. It used to live inside `aml-client-portal/index.ts`,
 * where the only thing that could check it was a source-text assertion.
 *
 * ## The defect this move fixed
 *
 * `docsDone` was `requiredReqs.length > 0 && requiredReqs.every(...)`. Read it
 * as the client experiences it: a case with no formal document requirements —
 * the common one — could upload documents forever and the documents step could
 * never be complete, because the `length > 0` guard made the whole expression
 * false before it looked at anything the client had actually sent. The
 * requirements list is a REQUEST for documents; it is not the record of what
 * arrived. `aml.documents` is.
 *
 * ## What this module may and may not decide
 *
 * It decides journey state from facts it is handed. It never fetches, never
 * writes, and never sees a risk rating, a score, a threshold, a provider name
 * or a reviewer note — the caller passes statuses only. Everything it returns
 * is shown verbatim to a customer, so every string here is customer copy.
 *
 * Pure and dependency-free: no `@/` aliases, no imports, parses under Deno and
 * imports cleanly into a vitest suite in `src/`.
 */

export type PortalJourneyStatus =
  | 'complete'
  | 'in_progress'
  | 'action_required'
  | 'not_started'
  | 'blocked';

export interface PortalJourneyStep {
  /** Stable machine key. The portal maps its own steps onto these. */
  step: string;
  status: PortalJourneyStatus;
  /** Redundant with `status`, kept because callers filter on it. */
  action_required: boolean;
  safe_label: string;
  safe_description: string;
  /** Which portal step answers this one. */
  target_step: string;
  completed_at: string | null;
}

/** A requested document, as `aml.document_requirements` records it. */
export interface JourneyRequirement {
  id?: string | null;
  required?: boolean | null;
  status?: string | null;
}

/**
 * A document the client actually sent.
 *
 * Deliberately two fields. The journey needs to know whether something valid
 * arrived and which request it answers — it has no business with filenames,
 * storage paths, checksums or uploader ids, and cannot leak what it is never
 * given.
 */
export interface JourneyDocument {
  requirement_id?: string | null;
  status?: string | null;
}

/** A party's client-visible verification state (see verificationParties.pure). */
export interface JourneyParty {
  status: string;
  can_attempt?: boolean;
}

/** A questionnaire section is answered when the client has submitted it. */
const SECTION_DONE = ['submitted', 'accepted', 'complete'];

/** The steps a submission may be held on, in the order the client sees them. */
export type SubmissionBlocker = 'consent' | 'questionnaire' | 'documents' | 'verification';

/**
 * Whether one step, in one state, holds the submission.
 *
 * Consent, the questionnaire and identity verification must be COMPLETE — a
 * step that is not started, in progress or blocked is outstanding. `blocked`
 * verification means the adviser has to settle the client's identity (a staff
 * sighting projects the party as verified, which releases this), and a pack
 * must not go to review ahead of that.
 *
 * ## Documents are the one deliberate exception
 *
 * `documentsJourneyStatus` already encodes whether anything is REQUIRED:
 * when requirement rows exist it answers only `complete` or `action_required`
 * (an outstanding or rejected required document is `action_required`, never
 * `not_started`); `not_started` is reachable ONLY when no requirements exist
 * and nothing was uploaded — the state whose customer copy is "There is
 * nothing we need from you here right now."
 *
 * Requirements are raised by explicit staff action alone
 * (`seed_default_requirements` / `upsert_requirement` in `aml-cases`, both
 * write-role gated); nothing seeds them at case creation, and cases with zero
 * requirement rows are the production norm. So `not_started` documents means
 * NPC has chosen not to ask for anything — treating it as a blocker would
 * make every such case unsubmittable until the client uploads a document
 * nobody asked for. It does not hold the pack; `action_required` always does.
 */
export function stepHoldsSubmission(
  step: SubmissionBlocker, status: PortalJourneyStatus,
): boolean {
  if (step === 'documents') {
    return status !== 'complete' && status !== 'not_started';
  }
  return status !== 'complete';
}

/**
 * The ONE submission-readiness rule.
 *
 * Shared by `buildJourney` (which renders it), `submit_for_review` in
 * `aml-client-portal` (which enforces it) and the Review screen (which reads
 * it through the journey and `stepHoldsSubmission`) — so the progress cards,
 * the "everything received" banner, the Submit button and the backend
 * validation cannot disagree.
 *
 * ## The contradiction this replaced
 *
 * Readiness used to be `consent && questionnaire && documents !== action_required`,
 * and the backend checked only sections and *formally required* documents.
 * Identity verification was not consulted anywhere — measured on a production
 * case: an unfinished identity check, zero documents, three accepted
 * submissions. Verification is now a hard requirement; documents hold the
 * pack exactly when something REQUIRED is outstanding (see
 * `stepHoldsSubmission` for why optional-and-untouched does not).
 */
export function submissionBlockers(args: {
  consent: PortalJourneyStatus;
  questionnaire: PortalJourneyStatus;
  documents: PortalJourneyStatus;
  verification: PortalJourneyStatus;
}): SubmissionBlocker[] {
  const steps: SubmissionBlocker[] = ['consent', 'questionnaire', 'documents', 'verification'];
  return steps.filter((step) => stepHoldsSubmission(step, args[step]));
}

/** A requested document has arrived when a file is attached and not rejected. */
const REQUIREMENT_MET = ['uploaded', 'accepted'];

/**
 * A document row that counts as something the client sent us.
 *
 * `rejected` does not: staff asked for it again. `superseded` does not: a
 * newer row replaced it, and that newer row is the one that counts. `deleted`
 * never reaches here — the caller filters it out at the query.
 */
const DOCUMENT_VALID = ['uploaded', 'accepted'];

function statusOf(value: unknown): string {
  return String(value ?? '');
}

/**
 * The documents step, from what was asked for AND what arrived.
 *
 * - Requirements exist → every required one must be met; a rejection against a
 *   required request needs the client's attention even if the requirement row
 *   has not caught up.
 * - No requirements, something valid uploaded → complete. Nothing was asked
 *   for and the client sent something anyway; there is nothing outstanding.
 * - No requirements, nothing uploaded → not started. Optional, not overdue.
 */
export function documentsJourneyStatus(args: {
  requirements: JourneyRequirement[];
  documents: JourneyDocument[];
}): PortalJourneyStatus {
  const required = (args.requirements ?? []).filter((r) => Boolean(r?.required));
  const documents = args.documents ?? [];

  if (required.length > 0) {
    const requiredIds = new Set(
      required.map((r) => String(r?.id ?? '')).filter((id) => id.length > 0));
    const rejectedAgainstRequired = documents.some((d) =>
      statusOf(d?.status) === 'rejected' &&
      d?.requirement_id != null &&
      requiredIds.has(String(d.requirement_id)));
    if (rejectedAgainstRequired) return 'action_required';
    return required.every((r) => REQUIREMENT_MET.includes(statusOf(r?.status)))
      ? 'complete'
      : 'action_required';
  }

  return documents.some((d) => DOCUMENT_VALID.includes(statusOf(d?.status)))
    ? 'complete'
    : 'not_started';
}

/**
 * Identity verification, across every party the client must resolve.
 *
 * The ordering is the point. "Complete" is the narrowest branch and is checked
 * first, so nothing short of every party holding an authoritative result can
 * reach it — a capture the client finished, a check the provider is still
 * running and a party nobody has started are all NOT verified, and the client
 * is never shown a tick for any of them.
 *
 * `contact_adviser` is `blocked` rather than `action_required` because there
 * is nothing the client can do in the portal: telling them to act, on a step
 * with no action, is worse than telling them to wait.
 */
export function verificationJourneyStatus(parties: JourneyParty[]): PortalJourneyStatus {
  const list = parties ?? [];
  if (list.length === 0) return 'not_started';
  if (list.every((p) => statusOf(p?.status) === 'verified')) return 'complete';
  if (list.some((p) => statusOf(p?.status) === 'contact_adviser')) return 'blocked';
  if (list.some((p) => statusOf(p?.status) === 'action_required')) return 'action_required';
  if (list.every((p) => statusOf(p?.status) === 'not_started')) return 'not_started';
  // Some parties are settled and others have not begun — the client still has
  // someone to verify, which is an action even though work is under way.
  if (list.some((p) => statusOf(p?.status) === 'not_started')) return 'action_required';
  return 'in_progress';
}

function step(
  key: string,
  status: PortalJourneyStatus,
  label: string,
  description: string,
  target: string,
  completedAt: string | null = null,
): PortalJourneyStep {
  return {
    step: key,
    status,
    action_required: status === 'action_required',
    safe_label: label,
    safe_description: description,
    target_step: target,
    completed_at: completedAt,
  };
}

/**
 * Stage 22 — the server-derived journey. The portal renders exactly what this
 * returns; no completion claim is computed client-side. "Verified" appears
 * only when every applicable party holds an authoritative electronic result or
 * an accepted staff sighting — never from case status alone. Completion
 * wording stays restrained: reuse claims belong to the passport/consent
 * machinery, not this journey.
 */
export function buildJourney(args: {
  consentSatisfied: boolean;
  activeSections: string[];
  sectionMap: Map<string, { status?: string | null }>;
  requirements: JourneyRequirement[];
  /** Rows from `aml.documents`, already filtered of `deleted`. */
  documents: JourneyDocument[];
  parties: JourneyParty[];
  submissions: unknown[];
  /**
   * Requests still waiting on the CLIENT. A request they have already answered
   * is waiting on the adviser and must not be counted here — it kept the
   * adviser-review step amber after the client had done everything asked.
   */
  openRequestCount: number;
  portalStatus: string;
}): PortalJourneyStep[] {
  const sectionsDone = args.activeSections.every((sec) =>
    SECTION_DONE.includes(statusOf(args.sectionMap.get(sec)?.status)));
  const sectionsStarted = args.activeSections.some((sec) => {
    const st = statusOf(args.sectionMap.get(sec)?.status);
    return st.length > 0 && st !== 'not_started';
  });

  const consentStatus: PortalJourneyStatus = args.consentSatisfied ? 'complete' : 'action_required';
  const questionnaireStatus: PortalJourneyStatus = sectionsDone
    ? 'complete'
    : !args.consentSatisfied
      ? 'blocked'
      : 'action_required';
  const documentsStatus = documentsJourneyStatus({
    requirements: args.requirements ?? [],
    documents: args.documents ?? [],
  });
  const verificationStatus = verificationJourneyStatus(args.parties ?? []);

  const submitted = (args.submissions ?? []).length > 0;
  const complete = args.portalStatus === 'complete';

  // What `submit_for_review` enforces, verbatim — one function, two callers,
  // so the sentence the client reads and the gate the server applies cannot
  // drift apart. See `submissionBlockers`.
  const readyToSubmit = submissionBlockers({
    consent: consentStatus,
    questionnaire: questionnaireStatus,
    documents: documentsStatus,
    verification: verificationStatus,
  }).length === 0;

  const submissionStatus: PortalJourneyStatus = submitted
    ? 'complete'
    : readyToSubmit
      ? 'action_required'
      : 'not_started';

  return [
    step('consent', consentStatus,
      'Consents', args.consentSatisfied
        ? 'You have accepted the current consents.'
        : 'Please review and accept the consents to continue.', 'consent'),
    step('questionnaire', questionnaireStatus,
      'Your information', sectionsDone
        ? 'All required sections are submitted.'
        : sectionsStarted
          ? 'Some sections still need to be completed.'
          : 'Tell us about you and your purchase.', 'questionnaire'),
    step('documents', documentsStatus,
      'Documents',
      documentsStatus === 'complete'
        ? 'We have everything you have sent us.'
        : documentsStatus === 'action_required'
          ? 'Some requested documents are outstanding.'
          : 'There is nothing we need from you here right now.', 'documents'),
    step('verification', verificationStatus,
      'Identity verification',
      verificationStatus === 'complete'
        ? 'You are verified.'
        : verificationStatus === 'in_progress'
          ? 'We are checking your identity documents.'
          : verificationStatus === 'blocked'
            ? 'We will complete your identity check with you directly.'
            : 'Identity verification is still to be completed.', 'verify'),
    step('submission', submissionStatus,
      'Review and submit', submitted
        ? 'Your information has been submitted for review.'
        : readyToSubmit
          ? 'Everything we need from you is ready to send.'
          : 'Submit your onboarding once everything above is complete.', 'review'),
    step('review',
      complete
        ? 'complete'
        : args.openRequestCount > 0
          ? 'action_required'
          : submitted ? 'in_progress' : 'not_started',
      complete ? 'Complete' : 'Adviser review',
      complete
        ? 'Your onboarding is complete.'
        : args.openRequestCount > 0
          ? 'Your adviser has asked for something — see your requests.'
          : 'Your adviser is reviewing your information.', 'review'),
  ];
}
