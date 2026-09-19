/**
 * What a reviewer has actually looked at, before they record a decision.
 *
 * ── The two defects this replaces ─────────────────────────────────────
 * "Review the submission" was a button that did nothing: it set the section
 * the operator was already standing on, and fell through a switch that had
 * no case for it. The workspace's own comment names the failure — a click
 * that changes nothing visible is indistinguishable from a broken button.
 *
 * And the decision sat ABOVE the evidence. "Accept submission" rendered
 * before a single accordion, so a submission could be accepted with nothing
 * opened, and the record would not show the difference.
 *
 * ── What coverage is, and is not ──────────────────────────────────────
 * Coverage is a statement about THIS REVIEWER'S SESSION: which evidence
 * sections they have had open in front of them. It is disclosed beside the
 * decision and inside the accept confirmation — never a gate. Blocking is
 * what the service gate does; this screen records a review, and what an
 * unreviewed acceptance needs is to be VISIBLE, in the same words, at the
 * moment it is about to be recorded.
 *
 * It is deliberately not persisted. A section opened last week by somebody
 * else is not this reviewer having looked, and a stored "reviewed" flag
 * would turn into a second review system with its own drift.
 */

export interface SubmissionReviewFacts {
  previous_version: unknown | null;
  differences: unknown[];
  parties: number;
  documents: number;
  openRequests: number;
  /** Parties with an identity check / screening state to show. */
  verificationRows: number;
  screeningRows: number;
}

export interface ReviewSection {
  key: string;
  label: string;
  /** False when the trigger row already says everything — e.g. a count of 0. */
  hasContent: boolean;
}

/**
 * The evidence sections, in the order the panel renders them.
 *
 * `hasContent: false` is not "skip it": the trigger row itself is on screen
 * and carries the whole fact (a count of zero). Requiring a click to open an
 * empty list would train reviewers that opening sections is a ritual, which
 * is the fastest way to make coverage meaningless.
 */
export function reviewSections(facts: SubmissionReviewFacts): ReviewSection[] {
  return [
    {
      key: "differences",
      label: "Changes since previous submission",
      // A first submission has no previous version to differ from; the row
      // says "first submission" and that is the whole of it.
      hasContent: facts.previous_version !== null && facts.differences.length > 0,
    },
    { key: "consent", label: "Consent evidence", hasContent: true },
    { key: "answers", label: "Questionnaire answers", hasContent: true },
    { key: "parties", label: "Related parties", hasContent: facts.parties > 0 },
    { key: "documents", label: "Documents", hasContent: facts.documents > 0 },
    {
      key: "verification",
      label: "Identity verification by party",
      hasContent: facts.verificationRows > 0,
    },
    { key: "screening", label: "Screening by party", hasContent: facts.screeningRows > 0 },
    { key: "requests", label: "Open client requests", hasContent: facts.openRequests > 0 },
  ];
}

export interface ReviewCoverage {
  /** Sections with content the reviewer has not yet opened, in page order. */
  unopened: ReviewSection[];
  openedCount: number;
  contentCount: number;
  complete: boolean;
  /** The next section to open, or null when everything has been seen. */
  nextKey: string | null;
  sentence: string;
}

export function reviewCoverage(
  sections: ReviewSection[],
  seenKeys: Iterable<string>,
): ReviewCoverage {
  const seen = new Set(seenKeys);
  const withContent = sections.filter((s) => s.hasContent);
  const unopened = withContent.filter((s) => !seen.has(s.key));
  const complete = unopened.length === 0;
  return {
    unopened,
    openedCount: withContent.length - unopened.length,
    contentCount: withContent.length,
    complete,
    nextKey: unopened[0]?.key ?? null,
    sentence: withContent.length === 0
      ? "There is nothing in this submission to open."
      : complete
        ? `Every section with content has been opened — ${withContent.length} of `
          + `${withContent.length}.`
        : `${withContent.length - unopened.length} of ${withContent.length} sections `
          + `opened. Still to look at: ${unopened.map((s) => s.label).join(", ")}.`,
  };
}

/**
 * What the accept confirmation says about coverage.
 *
 * Null when there is nothing to add. When sections are unopened it names
 * them — the acceptance is not blocked, and it is not quiet either: what an
 * unreviewed acceptance needs is to be visible at the moment it is recorded.
 */
export function acceptDisclosure(coverage: ReviewCoverage): string | null {
  if (coverage.complete) return null;
  return `You have not opened: ${coverage.unopened.map((s) => s.label).join(", ")}. `
    + "Accepting records your review of the whole submission — open them first, "
    + "or accept knowing they were not looked at in this session.";
}

/**
 * The badge on the differences row — the reading an OLD server cannot spoil.
 *
 * ── Why the client re-derives this ────────────────────────────────────
 * The server diffed every submission against `previous?.snapshot ?? {}`. On
 * a FIRST submission that compares the sections against nothing, calls all
 * twenty fields "changes", flags them material, and pushes
 * `material_information_changed` into the risk-stale reasons — so the screen
 * showed a red "20 · material" badge directly above the sentence "This is
 * the first submission."
 *
 * The server is fixed, but this panel and the function deploy separately,
 * and the panel must read correctly against whichever is live. With no
 * previous version there is nothing to differ from, whatever the payload's
 * `differences` array says.
 */
export function differencesBadge(facts: {
  previous_version: unknown | null;
  differences: unknown[];
  differences_material: boolean;
}): { label: string; material: boolean } {
  if (facts.previous_version === null) {
    return { label: "First submission", material: false };
  }
  return {
    label: String(facts.differences.length),
    material: facts.differences_material && facts.differences.length > 0,
  };
}
