# Stage 7 — the review that shows what was looked at

Read this before touching `submissionReviewCoverage.pure.ts`,
`SubmissionReviewPanel`, the `review_submission` stage action, or the
first-submission diff in `get_submission_review`.

## Three defects, one screen

**"Review the submission" did nothing.** The stage's primary action set the
section the operator was already standing on and fell through a switch with no
case for `review_submission`. The workspace's own comment names the failure —
*a click that changes nothing visible is indistinguishable from a broken
button* — and the same class had already shipped once on Stage 6's button. It
now scrolls to and lands on the review panel.

**The decision sat above the evidence.** "Accept submission" rendered before a
single accordion, so a submission could be accepted with nothing opened, and
the record would not show the difference.

**A first submission wore a red "20 · material" badge** directly above the
sentence *"This is the first submission."* The server diffed every submission
against `previous?.snapshot ?? {}` — a first submission was compared against
nothing, every answered field became a "change", the diff came back material,
and `material_information_changed` joined the risk-stale reasons. A first
submission is not changed information; it is the information.

## Coverage: what this reviewer has had open, this session

The accordion is controlled, so every open is observed. Coverage stands beside
the decision buttons — *"1 of 5 sections opened. Still to look at: …"* — with
one button that opens the next unopened section in page order.

The rules:

- **An empty section's trigger row already says everything.** A count of zero
  is on screen without a click; requiring a click to open an empty list trains
  reviewers that opening sections is a ritual, which is the fastest way to make
  coverage meaningless. `hasContent` decides which sections count.
- **Opened once is seen.** Closing a section again does not un-see it —
  coverage is "had it in front of them", not "has it open now".
- **Deliberately not persisted.** A section opened last week by somebody else
  is not this reviewer having looked, and a stored "reviewed" flag becomes a
  second review system with its own drift. The two default-open sections count
  as seen; they are on screen from mount.
- **Disclosed, never a gate.** The accept confirmation names the unopened
  sections — *"open them first, or accept knowing they were not looked at in
  this session"* — and the button stays enabled. Blocking is the service
  gate's job; what an unreviewed acceptance needs is to be visible at the
  moment it is recorded.

## The first-submission diff, fixed on both sides

The server now diffs only when a previous version exists. And because this
panel and the function deploy separately, the panel re-derives the badge:
`previous_version === null` reads **First submission**, whatever the payload's
`differences` array says. `differencesBadge` also refuses "material" over zero
differences.

## Where the tests are

- `src/lib/aml/submissionReviewCoverage.test.ts` — sections, coverage,
  disclosure, and the badge an old server cannot spoil
- `src/components/aml/__tests__/submissionReviewCoverage.test.tsx` — the
  on-screen half: the badge against the old payload, the moving count, the
  accept disclosure, and the `review_submission` wiring
