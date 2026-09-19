# Stage 10 — Ongoing CDD, the review cycle, and the reminders it raises

Read this before touching `_shared/aml/reviewSchedule.pure.ts`,
`_shared/aml/complianceReminders.ts`, `armOngoingCdd` in `aml-reliance`, the
review operations in `aml-monitoring`, or `src/lib/aml/displayDate.ts`.

## Dates are Day/Month/Year, and never the reader's machine

The card read **"Next periodic review 8/29/2029"** beside **"Screening
refresh Due 8/21/2027"** — month first, for an Australian reporting entity.
Both came from `toLocaleDateString()` with **no locale**, which takes
whatever the browser happens to be set to.

Two of those numbers are ambiguous to a reader, and a third of the calendar
is silently wrong by months: `8/9/2027` is the ninth of August or the eighth
of September depending on who is looking. A compliance date is read by an
auditor, quoted in a report and typed into a regulator's form. It must not
depend on the machine it is read on.

`AU_LOCALE` in `displayDate.ts` is the one place the locale is named, and the
sweep took **779 un-localed call sites across 230 files** onto the `en-AU`
the rest of the product already used explicitly at 100+ sites — so this
adopts a convention rather than inventing one. `amlDateFormat.test.ts` fails
any AML or partner-compliance module that formats a date on the reader's
locale, which is the rule rather than the symptom.

## A review is completed at least annually

The defaults were `{ prohibited: 3, high: 12, medium: 24, low: 36 }`. Under
them a low-risk customer's identity, screening and circumstances went **three
years** without review while the same card showed their screening refresh
falling due at two — two obligations on one customer, running on different
clocks, with the slower one attached to the more searching question.

AUSTRAC fixes no interval: ongoing CDD is risk-based, so the interval is a
**programme parameter**. `reviewSchedule.pure.ts` is where the programme
states it.

Two rules, and they are not the same rule:

- **Higher risk reviews MORE often, never less.** `prohibited` stays at three
  months. A rating exists to make the cycle tighter.
- **The annual ceiling binds a configured interval too.** A tenant may set a
  shorter cycle in `tenant_settings.review_interval_config` and it is
  honoured exactly; a longer one is clamped — and `resolveReviewInterval`
  **reports that it clamped**, so the audit event records it rather than an
  operator's configured value being silently overridden.

### The interval was written twice

`DEFAULT_REVIEW_INTERVALS` served `schedule_periodic_review` and the daily
sweep; an inline `defaults` object thirty lines away served
`complete_review`. Only the first was ever edited, so **completing a review
booked the next one on a cycle the rest of the product had stopped believing
in**. One module now, and a test asserts the copies are gone.

### The repair

Open periodic reviews were booked under the old table and would otherwise sit
at their old dates for years. A review that is not yet complete is a
**forward-looking obligation, not a historical record**, so bringing it
forward is correct and loses nothing. The migration only ever moves a due
date **earlier**, only for open periodic reviews, never on an ended
relationship, and leaves `original_due_at` exactly as it was.

Applied to production: `AML-2026-00005` moved from **29/08/2029 → 29/08/2027**
(annual from the date the cycle started), with `original_due_at` preserved.

## A scheduled review reaches the Reminders hub

A scheduled review lived in `aml.existing_customer_reviews` and on one card at
the foot of one stage. The Command Centre's Reminders hub aggregates
`client_reminders`, client follow-ups and deal milestones — and AML reviews
appeared in **none** of them. The one obligation with a statutory character
and a multi-year horizon was the one nobody would see coming, on the one
screen built for exactly that.

`complianceReminders.ts` writes to `client_reminders`, because **a second
reminder system is how two reminder systems disagree**. Writing there means an
AML review is reminded about everywhere reminders already are — the hub, the
Calendar, the client record — with no new surface and no new notion of "due".

Three rules:

- **Idempotent by source.** `source_ref` carries the id of the thing the
  reminder is about, and the partial unique index on `(client_id,
  reminder_type, source_ref)` makes re-running an operation an update rather
  than a duplicate. A reminder somebody typed has a NULL `source_ref` and can
  never collide.
- **A reminder is never the record.** It points at an obligation recorded
  elsewhere and holds no compliance state. Deleting every row this module
  writes loses nothing but the prompt.
- **It never fails the act it accompanies.** Scheduling a review, issuing a
  Passport and ending a relationship are the compliance acts. Every function
  reports its outcome and throws nothing. A case with no CRM client is
  *skipped* — an AML case can be opened against a subject before a client
  record exists, and that is a real state, not a failure.

Completing a review **completes** its reminder rather than deleting it: the
hub should show what happened, not a row that silently vanished.

### The column decides

`client_reminders.reminder_type` is CHECK-constrained to a closed list, and
the AML kinds were not in it — so **every write this feature makes would have
been rejected at the column**, while looking from inside the edge function
exactly like a write that had not been attempted. The same class as
`template_library_entries_category_check`. The list is widened rather than the
values bent into `review`, because what kind of reminder this is is precisely
what the column is for, and the hub filters and icons on it.

## Issuing the Passport arms ongoing CDD

Issuance is the moment the record becomes something a partner may rely on, and
therefore the moment the obligation to keep it current begins. It had to be
scheduled by hand from a card at the foot of the last stage, so **a case could
carry a live, relied-upon Compliance Passport with no ongoing CDD booked at
all**.

`armOngoingCdd` books the first periodic review on issuance and puts it, and
the issuance itself, on the customer's reminders. Three rules:

- **It never moves an obligation that already exists.** Re-issuing a document
  is not a reason to re-schedule a scheduled review.
- **It never touches a case whose relationship has ended.**
- **It never fails the issuance.** The attestation is the compliance act; the
  reminder is a prompt.

The wording is in one place because a reminder is read months or years later
by somebody who was not there. It names the case, the obligation and where to
go — and says nothing about risk ratings, screening outcomes or decisions,
because **a reminder row is not a disclosure boundary and must not become
one**. A test asserts that.

## The rail no longer offers to undo the decision

"Advance status" sat in the right rail on every stage. On a cleared case it
offered **"Under review"** behind an *optional* reason and no confirmation —
and one click there regresses four things at once: `status`, `case_stage`,
`client_portal_status` and, through `STATUS_TO_SERVICE_GATE`,
`service_gate_status`, which flips a live Passport to "Refresh required".

A reason-optional undo of a reason-bearing act, on the two stages that exist
*because* the decision was recorded. It is suppressed on Passport & Partners
and Ongoing CDD, and nowhere else.

**The act is not removed.** Re-deciding a case is the Decision stage's own
control, with its rationale; closing is the case header's; a closed case can
still be reopened from either stage, because that card sits outside the gate.
And hiding a button was never authorisation — the server enforces every
transition exactly as before.
