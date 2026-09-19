# Lodging a report with AUSTRAC

Read this before touching `src/lib/aml/austracReportPath.pure.ts`,
`AustracReportPathCard`, the draft dialog in `AmlAustracReporting`, or the
`submit_record` / `record_receipt` operations in `aml-reporting`.

## Almost none of the machinery was missing

`aml-reporting` already refused a submission that was not MLRO-approved,
already demanded step-up MFA, already required lodgement evidence — and for
an SMR, the AUSTRAC reference specifically — and already required an explicit
no-tipping-off attestation before it would write a submission. It stamped the
SMR case event `restricted` so downstream renderers could withhold it. The
server was rigorous.

What sat in front of it was a dialog with five boxes and a table of statuses.

## The defect: every report was filed against nobody

`reports.case_id` has existed since the first migration. **The draft dialog
never set it.** So no report reached the customer's compliance file, none
appeared on their case timeline, and none could be found from their record —
the only way to a report was this page.

A report about a customer that is not on that customer's file is not on file.
The dialog now asks, and the server has always written the case event when it
was given a case; it was never given one.

## The clock is derived, and it is in BUSINESS days

| report | window | basis |
|---|---|---|
| SMR | 3 business days from the day the suspicion was formed | s.41 |
| SMR — terrorism financing | **24 hours** | s.41 |
| TTR | 10 business days from the transaction | s.43 |
| IFTI | 10 business days from the instruction | s.45 |
| Compliance report | annual, no per-report clock | s.47 |

Three rules.

**Business days, not calendar days.** A suspicion formed on a Thursday is due
the following Tuesday; a naive `+3` says Sunday, which is not a day AUSTRAC
counts. `addBusinessDays` skips weekends and a test pins that exact case.

**The clock starts at the OBLIGATION, not the reporting period.** An SMR runs
from the day the suspicion was formed, which is not the period the report
covers. It is a separate field — a deadline derived from the wrong date is
worse than no deadline — and it is kept in `reports.metadata`, so this needed
no migration.

**Terrorism financing is the same report under a tighter clock**, not a
different kind. Drafting "the wrong one" and reconciling later is not
something an operator should be able to do, so it is a flag on the SMR and it
tightens the window to 24 hours. It is also the only case that shows a TIME:
a multi-day window is a date, and printing an hour on it implies a precision
the Act does not have.

## The checks disclose; the server refuses

`austracReadiness` is what an operator sees before they set off. It blocks
nothing, because the server already refuses what must be refused. **Two gates
is how one of them becomes wrong.**

Only two checks read `blocked`, and neither is a policy the browser invented:
a report filed against no customer, and a report past its statutory window. A
late report is still a report — it says so, and asks for the lateness to be
recorded, because the lateness is itself a matter of record.

## The platform never lodges

AUSTRAC Online is the reporting entity's own account, reached with its own
credentials, by the person authorised to use it. This product holds no
AUSTRAC credentials and submits nothing.

That is said on the page rather than in a tooltip, on the step where it
matters, because the alternative is an operator waiting for a submission that
was always theirs to make. What the product does is assemble the report, hold
the evidence behind it, record who approved it, and keep the receipt on the
customer's file.

## Tipping off

Disclosing an SMR is an offence under s.123. The protection is at the
projection rather than in a caller's discretion: `CLIENT_RESTRICTED_KEYS` and
`PARTNER_RESTRICTED_KEYS` in `passportView.pure.ts` both already carry `smr`,
`austrac` and `suspic`, so a report can never travel to a client's copy of
the Passport or a partner's, whatever is added to the record above them. A
test pins both lists rather than trusting them.

## The path is the product's own shape

Six numbered steps with exactly one open, which is what Stage 5 and Stage 9
do. An operator who has learned one guided path in this product has learned
all of them, and that is worth more than a form that is locally clever.

---

## The draft dialog says why, and not only what

The first version of this work gave the report a path, a deadline and a
customer. It left the drafting itself as it found it: a narrow modal with
five boxes that explained none of them. An operator drafting their first
Suspicious Matter Report had to know, from somewhere that was not on the
screen, what the trigger is, that it covers an *attempted* service, that a
customer who walked away when identification was asked for still obliges the
report, that the customer must not be told — and that a large cash payment
with nothing else odd about it is a different report altogether.

None of that is obscure. It was simply absent from the place the decision is
made, which is the only place it is worth having.

`austracDraftGuidance.pure.ts` carries it, per obligation: **why** the report
exists, **when AUSTRAC must be informed** (the tests an operator applies),
**what that looks like** in a property-services reporting entity, **what the
report is not for** and where that belongs instead, and **what the narrative
has to answer**. The dialog renders it beside the form.

### It advises and never decides

Nothing in the guidance writes a field, chooses a kind or blocks a save. The
operator forms the suspicion and the MLRO approves the report; a module that
quietly picked for them would be this product forming a view it has no basis
to form. Two consequences are pinned by tests:

- **"Not this report" routes to the right report and never to no report.**
  A test rejects any sentence in the guidance that could be read as
  permission to lodge nothing.
- **The narrative helper inserts questions, never answers.** It is offered
  only into a narrative that is blank, so whatever it writes could be lodged
  verbatim if nobody edited it. Every line it produces is a question, which
  cannot be read as an assertion about a customer.

### The tipping-off warning is in the main column

s.123 makes disclosing a Suspicious Matter Report an offence, and it attaches
to that report alone — carrying the warning on all four kinds is how an
operator learns to read past it. It also cannot live in the reference panel:
below `lg` that panel drops underneath the entire form, and a prohibition on
what the operator may say is the one thing that must not be below the fold.
A test asserts the warning is not a descendant of the panel.

### The stored kind is translated, never used as a table key

`reports.kind` accepts five values (`smr`, `ttr`, `ifti`, `compliance`,
`annual`) and `AUSTRAC_OBLIGATIONS` is keyed by the four obligations —
`compliance` and `annual` are one obligation under two spellings. Reading the
obligation table with a raw column value returns `undefined` and throws on
the next property access, which is what the first version of the dialog did:
choosing "Compliance Report" would have crashed the screen. Nothing had ever
hit it because the table holds no rows.

`toObligationKind` is the one translation and returns **null** rather than
guessing, so a kind the table cannot place renders no clock at all instead of
asserting an SMR's three-day deadline over a report that may not have one. A
test walks exactly the values the `reports_kind_check` constraint accepts.

### An annual report is not a customer report

The same fix exposed a second wrong reading. The s.47 compliance report
accounts for the reporting entity's own programme; there is no customer to
file it against. The readiness check reported **blocked** for a customer it
can never have, and the first step of the path could never complete — a
permanent red on a correctly drafted report, which teaches an operator to
read past the checks. `isCustomerReport` is the one predicate, the customer
section explains why there is nothing to link, and the reporting period
becomes owed rather than optional.

### Numbered sections, not a wizard

The dialog is one form in four numbered parts, and deliberately not a series
of gated steps. A Suspicious Matter Report is often started the minute the
suspicion forms and finished an hour later, so requiring each part before the
next would make the obligation harder to meet rather than easier: what saves
a draft is unchanged — a kind and a title. What the numbering adds is where
the operator is, why they are being asked, and what is still owed, said in
the footer before they leave rather than discovered by the MLRO afterwards.

The panel also carries the six-step lodgement path with the two steps that
happen on this screen marked as such, so it is visible that saving a draft is
the beginning of the process and that lodgement is never made from here.

---

## Writing a report is a page, not a dialog

The draft lived in a modal. Everything about a modal was wrong for what it
held.

A report to a regulator is the **longest single piece of writing anyone does
in this product**. It is written against a statutory deadline, and it is
routinely started when the suspicion forms, left, and returned to hours
later. A dialog cannot be deep-linked, cannot be reopened where it was left,
cannot be sent to a colleague, is not reached by the browser's back button,
and closes on an outside click or the Escape key with whatever was typed in
it. Widening it — which is what the previous change did — bought room and
none of the rest.

`/admin/aml/austrac/new` and `/admin/aml/austrac/:reportId/edit` are the
draft now. Everything the dialog asked, the page asks; everything the server
refuses, it still refuses; and what saves a draft is unchanged — a kind and a
title, because a Suspicious Matter Report is often started the minute the
suspicion forms.

Four things follow from the move.

**The path sits under the hub's own.** `pathMatchesWorkspace` matches a
prefix followed by `/`, so `austrac/new` resolves to Regulatory & Assurance
and draws its secondary strip. A page listed in no workspace draws no strip
and highlights Compliance Home — reachable, and looking broken. That is how
the Passport shipped once.

**Saving hands the report back.** The dialog closed onto the report it had
just written. A page has to do that deliberately or the operator returns to a
list with nothing selected, so the draft page navigates to
`?report=<id>` and the hub opens it. `amlAustracReportPath` is where that
spelling lives.

**Leaving is not losing.** A page gives up the modal's implicit "you are in
the middle of something", so the page says it: an unsaved change guards the
browser's own unload and the page's own Back and Cancel. The handler is
registered only while there *is* an unsaved change — an always-on one makes
every navigation away from a clean page ask a question nobody needs.

**The action bar is fixed to the foot of the viewport**, not to the end of
the form. On a page carrying an eighteen-row narrative, a Save button below
it is a scroll away from wherever the operator is working, which is the one
thing the modal's own footer got right.

### The action is named for the act

"New Draft" named the row it would add to a table. An operator who has been
told they must inform AUSTRAC about something is looking for the report, not
for a draft record, so the hub's action is **"Start AUSTRAC Report"**.

### One label map

`AUSTRAC_KIND_LABEL` moved into the pure module because there were two copies
— the hub's table and the draft form each carried their own — and a report is
one thing whichever screen names it. `draftSectionsForReport` is there for
the same reason: the form and the page both ask "what is still owed" about
the same draft, and two mappings from a stored row to `DraftFacts` is how
they come to disagree.

---

## Finding the customer, and what the narrative is measured by

Three things the draft page got wrong once it was a page.

### The customer is typed, not scrolled

The customer field was a plain drop-down listing every open case in whatever
order the server returned it. On a tenant with two hundred customers that is
not a picker, it is a haystack: there was no way to type a name, and no way
to reach a customer by the **Passport reference** an operator is reading off
another screen — which is how a reference is normally carried between
screens.

It is a combobox now — type a name or a reference and the list narrows.

**The rule is not the picker's.** `caseSearch.pure.ts` holds it, and the
Compliance Passport register — where the convention started, name or case
reference — filters through the same module. A customer who can be found on
one screen and not on another is how an operator concludes a case does not
exist, so the register's filter *moved* rather than being copied.

Two things the shared rule does that a substring match does not. **Every word
must match and they may match different fields**, so "rugesh 00005" finds the
customer whose name carries one and whose reference carries the other — which
is how somebody types when reading a reference off one screen and a name off
another. And **a reference matches with or without its punctuation**:
`AML-2026-00005` is found by `aml202600005` and by `00005`, because a
reference is copied, re-typed and read aloud, and the hyphens are not part of
what anybody remembers.

It also **searches without fetching**. The list is the one the page already
loaded, filtered in the browser, so no keystroke leaves a customer's name in
a request log and typing cannot fail.

### There is no character floor

The narrative carried a 200-character minimum, rendered beside the box as
`298 / 200 characters`. Two things were wrong with it.

AUSTRAC sets no such threshold. The floor was this product's invention, and a
compliance product telling an MLRO that their account of a suspicion is too
short by an arbitrary number is asserting a standard nobody set.

And the counter **read as a cap**. "298 / 200" is the shape of an overrun, on
the one field in this product where running out of room would be a serious
problem — so the number discouraged exactly the thing it was there to
encourage.

`narrativeIsWritten` replaces it: a narrative is written, or it is not. What
replaces the floor is not nothing — the questions a narrative has to answer
are listed under the box, per obligation, from `KIND_GUIDANCE`. Guidance on
substance rather than a measure of bulk.

### The label was sitting on the box

"Narrative" shared a `flex items-end` row with the counter. The counter made
the row taller, `items-end` dropped the label to the row's foot, and the
Label primitive's `leading-none` left its descenders resting on the
textarea's own border. Removing the counter removes the row; every field on
the page now carries the same `space-y-1.5` rhythm rather than relying on the
label's own box height.

`ResizeObserver` and `scrollIntoView` are polyfilled in the test setup for
the same class of reason: jsdom implements neither, `cmdk` needs the first
and Radix's positioned surfaces the second, and a component that throws on
mount in a test is indistinguishable from one that is broken.

---

## The record download, the dead step, and which report you are reading

### "Bundle" downloaded a developer artefact

It fetched the edge function's export and saved `JSON.stringify(bundle, null,
2)` as `austrac-smr-<uuid>.json`. That file opens in a text editor. It carries
no identity, no branding, no statement of what it is, and nothing an auditor,
a colleague or a regulator's file could use — the archive record for a report
to a regulator was a debug dump.

It is a PDF now, and it is drawn by the **same renderer, under the same brand
resolver**, as the client submission record: `generateSubmissionRecordPdf` and
`resolveRecordBrand`. A workspace that has configured a brand issues under its
own name, colour ramp and report logo; a workspace that has not issues under
**Aurixa Systems** — never an empty masthead, never another tenant's marks. A
logo that cannot be fetched degrades to the wordmark rather than failing the
download: identity is required, a picture is not.

`austracBundleRecord.pure.ts` projects the bundle onto `SubmissionRecord`.
Everything on the page comes from the bundle the **server** assembled and
hashed; the module formats and does not read the database, so it cannot state
anything the export did not contain.

Two rules. **The tipping-off prohibition travels with the document** — this is
printable, e-mailable and leaveable on a desk, so an SMR record carries s.123
and says not to give it to the customer; a TTR record does not, because
carrying the warning everywhere is how an operator learns to read past it. And
**database vocabulary never reaches the page**: `awaiting_mlro` renders
"Awaiting mlro", asserted by a test.

### What the record left out, and what it led with

The first production render found the document correct and thin. It opened on
a field list; it stated what the report was called and nothing about what
obliges it; the MLRO decision — the fact that authorises lodgement — appeared
only as a version-table note reading "MLRO sign-off"; nothing said what was
still outstanding when it went; and page two was **blank apart from the
colophon**, because that block pinned itself to the foot of a fresh page when
the content overran by a centimetre. Meanwhile the section a reader reaches
last led with the row's uuid and a 64-character hash.

The rework is arrangement, not new data. **Nothing here reads the database**
that did not read it before: the obligation prose is `AUSTRAC_OBLIGATIONS` and
`KIND_GUIDANCE`, the checks are `austracReadiness` — the same module the
register and the report page render — and the approver is read from the
version row the sign-off itself writes, because `reports.mlro_signed_by` is an
id and carries no label.

The document is now, in order: the **handling restriction** (SMR only), **the
obligation** in prose, **the report**, **what happened**, the **pre-lodgement
checks** as a Check / Standing / Detail table, **MLRO approval** under a
heading of its own, **lodgement**, the **AUSTRAC acknowledgement**, the
**version history**, and **integrity**. It reads as a story — what was owed,
what the facts are, what account was given, what was outstanding, who
authorised it, what was done, what came back, how it got here, how to check
it.

Five rules carry it.

**The prohibition is met before the document is acted on.** s.123 travelled
only in the closing colophon: 8.5pt grey, at the foot of the last page, under
a centimetre of white. By the time a reader gets there they may already have
forwarded it. It is a leading section now and it is stated **once** — the
notice keeps "this is a record, not the lodgement" and no longer repeats the
offence, because a prohibition printed twice is one an operator learns to
skim. A test pins the rule (the prohibition is on the page, in first position,
exactly once) rather than the field it happens to live in.

**Never assert a deadline was met from the fact of a lodgement.** `submitted_at`
says a report went, not that it went in time. The Deadline line compares the
lodgement against the due date and says *Lodged after the window closed* where
that is what happened — this is the one document in the file that would
otherwise be saying the opposite.

**An empty field is omitted, never printed as a dash.** "YOUR REFERENCE —" and
"REPORTING PERIOD —" were two of eleven rows on the first page and neither
carried a fact.

**The uuid leaves the body and stays in the document.** It means nothing to any
party this record is for, and the document already carries the two references a
person uses. Its first eight characters ride in the running foot, where a
re-export, a support request or "which record is this printout" can still find
it. The hash stays **whole** — truncating a hash destroys the only thing it is
for — demoted below the sentence that says what it is for.

**A colophon pins to the foot only when it fits.** Otherwise it follows the top
margin of the new page, so an overrun yields a page that starts with something
rather than a blank sheet that ends with a footer.

One fact was genuinely added, and it is stated rather than counted: a record of
a report must be kept for **7 years from the day the report was made** (s.107).
The clock runs from a lodgement date this platform may not hold, so the
document states the obligation and never computes a date.

The renderer needed one generalisation to serve both. It wrote `Submission
v{n}` into the masthead, the identity line and the running foot, which is
correct for the document it was built for and wrong for an AUSTRAC record that
is not a submission and has no submission version. `RecordDocumentIdentity` is
now a defaulted parameter — the existing caller passes nothing and renders
exactly what it rendered before. The alternative was a second generator, which
is how a repository ends up with two print treatments that drift.

### Step 3's button did nothing

The path card took `onOpenStep(key)` and drew a button reading "Open" on
whichever step was open. The page handled three of the six keys. A saved draft
sits on step 3 — "Clear the pre-lodgement checks" — so the button rendered, was
clicked, and did nothing at all.

**A dead control is worse than no control**: it reads as a broken page rather
than as a step nobody can take yet. The card now takes `stepActions`, a map of
`{ label, run }`, and **a step with no entry draws no button** — which is the
honest rendering of the MLRO's sign-off to an analyst.

The label names the act rather than saying "Open": *Open the draft*, *Write the
narrative*, **Send to the MLRO**, *Sign it off*, *Record the lodgement*,
*Capture the receipt*. Step 3's act uses `upsert_report` with
`awaiting_mlro` — one of the three draft statuses the server already permits a
writer to set, so no new endpoint — and `deriveAustracPath` already counted the
step done at that status. It confirms first when checks are outstanding:
sending an incomplete report is legitimate (the MLRO may be the person who
resolves what is missing) but it should never happen by accident.

### Which report am I looking at?

The selected row was `bg-muted/40` and nothing else, which on the dark theme is
a shade of the same charcoal as the row beside it. With two reports on the
register an operator could not tell which one the entire right-hand panel was
describing.

Three signals rather than one, because a single tint is what failed: a solid
accent bar down the leading edge, a tinted ground, and the word **Viewing**
beside the title. `aria-selected` carries the same fact to a screen reader, and
the row is keyboard-operable — it was click-only, so the register could not be
worked without a mouse at all.

The detail panel now heads itself with the obligation badge, the status, the
title and the customer. It used to read "Detail" with the title in muted small
print, naming neither.

**Colour marks one thing.** A tone per obligation was the obvious first answer
and it was wrong: in the dark theme `--primary` and `--warning` are both the
brand gold, so five kinds in five tones rendered as five near-identical amber
chips — colour noise carrying no information, which is worse than no colour.
The three letters tell the obligations apart and already did. The **SMR alone**
is tinted, because s.123 is a fact about how that row must be handled rather
than a category. A test pins it.

---

## One review, not a review and a routing

The path had six steps. Two of them were the same decision:

3. **Clear the pre-lodgement checks** — completed by moving the report to
   `awaiting_mlro`.
4. **MLRO approves it** — completed by the sign-off.

Step 3 was a **hand-off**, and on a reporting entity where the person who
drafts the report *is* the MLRO — which is most of them, and is this one — it
was a report sent from somebody to themselves before they were allowed to act
on it. A ceremony with no second party.

Worse, take the routing away and the two steps complete on exactly the same
fact. **Two steps counting one thing** is how a header comes to read "2 of 6
done" above a list where nothing between them can move — the same defect Stage
9 had when completion was counted twice.

So they are one step: **"Review the checks and approve it"**. The checks are
what the approver reviews; the approval is the act. The path is five steps.

### Removing a ceremony must never remove a control

`mlro_signoff` is untouched: still MLRO-only, still server-enforced, still
recorded against the person who made it, still refusing from a terminal
status. The step is still named for the MLRO's decision, and a test asserts
both that the step exists and that it completes only on `mlro_signed_at`.

`awaiting_mlro` also still exists. The column accepts it, `mlro_signoff`
accepts a report in it, rows may already carry it, and the path opens on the
approval either way. Nothing in the product routed to it before the guided
path briefly offered to, and nothing does now — the summary tile still counts
it alongside `in_review`.

### The confirmation moved rather than being deleted

The hand-off asked before sending a report whose checks were outstanding. That
question was always about **this** decision, so it moved onto the approval:
approving an incomplete report is a legitimate thing to do and is recorded
against the person who did it, but it should never happen by accident. A
report with nothing outstanding approves in one click, exactly as it did from
the table.

Two details. The guard **excludes the checks the approval itself unlocks** —
lodgement and the receipt come after it, and listing them would ask the
approver to answer for steps their own decision enables. And it reads the same
`factsFor` projection the card does, because the table's Approve button acts
on a report that may not be the selected one, and two mappings from a row to
`AustracReportFacts` is how a confirmation comes to list another report's
checks.

### An open step with no button says whose it is

A step absent from `stepActions` draws no button — the honest rendering of
"there is nothing you can do about this one". But silence about *why* reads as
a broken page, so `stepNotes` renders "The MLRO's decision" on the open step
when this operator cannot make it. An analyst reaching the approval is a real
state with a real next actor, and it is now said on the page.

---

## The whole process, in the report

Three changes that follow from one observation: **approving from a register
row asks somebody to authorise a document they are not looking at.**

### "Review and approve" opens the report

The hub's step-3 button used to sign the report off where it stood. It now
opens the report, where the checks, the narrative and the approval are on one
screen — and approving there returns to the hub with the report selected and
the **lodgement** step open, which is the next act and is not on the report
page.

The register row's own **Approve** button is untouched. An MLRO who has
already read the report should not have to open it again, and removing a
control is not what opening the report was for.

### The approval saves first

The MLRO approves **what they are looking at**. If the narrative on screen has
not been written to the record, signing off would attest to a version nobody
read. So an unsaved change is persisted before the decision, in one act, and
the button says **"Save and approve"** while there is one — nobody has to
wonder which version they are signing off.

Approval takes the report out of the draft statuses, so this page can no
longer write to it. A report opened at `/edit` past those statuses renders
**read-only with the reason**, rather than an editable form whose Save the
server answers 403 to.

### One guard, asked from both places

`outstandingBeforeApproval` and `approvalConfirmation` are in the pure module
because the approval can now be made from two surfaces. Two copies of "what is
still owed" is how one screen comes to warn about something the other does
not. It still excludes the checks the approval itself unlocks.

### The checks lead the card

They sat under the steps, which put the thing an approver has to **read**
below the thing they are asked to **do** — and on a report whose path is long
enough to scroll, below the fold. Step 3 is "review the checks and approve
it", so the checks are the first thing on the card and the approval is reached
past them.

One rule falls out of that reorder: **no step may describe its own position on
the page.** The step text is drawn on the hub, inside the report, and in the
draft page's orientation list, and the checks sit somewhere different in each;
"the checks below" was true on one screen and wrong on the next the moment
they moved. A test rejects `above` and `below` in any step's label or detail.

### The AUSTRAC Online door is on the step that needs it

The lodgement statement and its link were a locked panel at the foot of the
card, three blocks below the step they are about. They are inside **step 4**
now — the statement that the reporting entity lodges through its own account
with its own credentials, and this product holds none and submits nothing, and
the link, prominent while that step is the open one.

### The path is drawn once per screen

The draft page's reference rail carries a five-step orientation list for
somebody **starting** a report. With the live card on the page they would be
two renderings of the same path, free to disagree about which step is open, so
the rail's list is suppressed exactly when the card is mounted — and the card
is mounted only for a saved report, which is the only kind that has anything
to approve.

---

## Opening a report, and putting one away

### The title opens the report

**Edit** was offered on a draft alone, so a submitted or approved report could
be *selected* and never *opened*: the register showed a status and a date, and
there was no way to read the document behind them. The title is the way in for
every status now.

That is safe to offer on all of them because the report page already renders
**read-only where the server would refuse a write** — and it no longer calls
itself "Edit" when nothing on it can be edited.

Clicking the row still selects it. Clicking the title opens it.

### Archiving is putting away, never throwing away

`delete_report` refuses anything past the draft statuses, and that is correct:
an approved, lodged, acknowledged, rejected or withdrawn report is a
**retained record**, kept for seven years with the evidence behind it. So the
register listed every report the entity had ever made, for ever, and the two
that still needed something were buried among the ones that did not.

Archiving hides a row from the working list and keeps every byte of it — the
row, its versions, its submissions, its receipts and its case events. It is
reversible from the archive view, and both directions are written to the
customer's case timeline. `archived_at` is the whole mechanism; `archived_by`
records who, because a compliance record's disappearance from a list is itself
worth being able to explain.

**The rule the whole feature turns on: a report may be archived only once
nothing is owed to AUSTRAC.** An archive that can hide an
approved-but-unlodged Suspicious Matter Report is not a tidy-up feature, it is
a way to lose a statutory deadline — the report leaves the list, the clock
keeps running, and nobody is looking. So `submitted`, `acknowledged`,
`rejected` and `withdrawn` archive; `draft`, `in_review`, `awaiting_mlro` and
`approved` refuse and say why, and a draft is pointed at delete instead.

`archiveBlockReason` is in `_shared` and is rendered by the register and
enforced by the edge function, so a button that exists in order to be refused
cannot happen.

Three more things it holds:

- **A lodged report with no receipt is archivable, and says so.** AUSTRAC's
  acknowledgement may never arrive, and waiting for one for ever is not a
  filing system — but the confirmation names it rather than hiding it.
- **It cannot be archived by saving the report.** `upsert_report` spreads the
  caller's object, so without stripping the stamp a client could archive a
  report by SAVING it, straight past the guard. It is deleted from the row
  alongside the MLRO and submission fields, for the same reason they are.
- **The tiles count the working register.** An archived report is a retained
  record rather than an outstanding one, and counting it would put a number
  beside a row nobody can see. The archive has its own count, on its own view.

Archived is a **view**, not a status filter: it is not a state a report is in,
it is whether the register is showing it. Putting it in the status list would
have made "All statuses" a lie.
