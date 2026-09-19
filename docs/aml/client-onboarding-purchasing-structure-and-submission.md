# Client Portal onboarding — purchasing structure, and the submitted state

Two defects in `src/pages/portal/PortalAml.tsx` (Client Portal → Identity &
Compliance). They are unrelated to each other; both were reported as "the page
doesn't do what it says".

---

## 1. Every purchaser was asked the entity questions

The **Purchasing structure** section asks six things: the entity type, and five
that only a legal entity has an answer to — entity legal name, ABN/ACN,
trustee/director names, beneficial owners over 25%, and the registered office
address. `PurchasingStructureForm` rendered all five unconditionally. An
**Individual** purchaser was asked to name their trustees and directors, and to
list anyone controlling more than 25% of themselves.

Rendering was the visible half. The invisible half is what mattered: anything
typed into those inputs was autosaved into `aml.questionnaire_responses.payload`
and **stayed there when the client corrected the structure**. It went out in the
next draft, and `submit_for_review` froze it into the `snapshot` an analyst
reads. A pack declaring `entity_type: 'Individual'` that also carries a company
name and an ABN is not a presentation bug — it is a purchaser record that
contradicts itself, in the one document the AML file is assembled from.

### The rule, and where it lives

`supabase/functions/_shared/aml/purchasingStructure.pure.ts` — one module, two
callers:

- the form renders `collectsEntityFields(entity_type)` and **conditionally
  renders** the five questions (an input nobody can see is still an input that
  saves);
- changing the type applies `prunePurchasingStructure` **in the same state
  write**, so nothing survives the change invisibly;
- `save_questionnaire` applies the identical function at the write boundary, so
  the guarantee holds for any caller — the browser, a stale tab, the mobile app
  — and not only for a client who happened to press the radio.

Three things worth knowing.

**`Joint` sits with `Individual`.** Two people buying in their own names are not
a legal entity: no legal name, no ABN/ACN, no registered office, no >25%
controller. The server already treats it that way — `ENTITY_STRUCTURES` in
`aml-client-portal/index.ts` raises the `entity_details` section for
Company/Trust/SMSF/Partnership and not for Joint, and co-purchasers are
collected as `related_parties`. `purchasingStructure.test.ts` re-reads that
literal out of the edge function and fails when the two sets drift.

**`registered_address` is the entity's registered office, not a purchaser
address.** `entity_details` collects the same key under the same label and
requires it of companies and trusts; an individual's own address is
`personal_details.address` ("Residential address"). It is hidden with the rest.

**The field list is in the pure module for a reason.** `beneficial_owners` is
also the name of a staff-side ownership table, and
`amlPortalContracts.test.ts` asserts the string never appears in
`aml-client-portal/index.ts`. Putting the list beside the operation would have
failed a portal-safety contract for a reason that has nothing to do with this
change.

### What did NOT change

Validation. `validateQuestionnaireSection('purchasing_structure', …)` has always
required `entity_type` and nothing else, which is why an Individual could always
save a draft and submit the section. The defect was never a validation error —
it was five questions on screen and five keys in the row.

Superseded **sections** are still retained. A client who answers
`entity_details` as a Company and then switches to Individual keeps that row in
storage; it simply drops out of the active checklist (`applicableSections`), and
the snapshot records `applicable_sections` alongside it. That is a deliberate
existing decision and this change does not touch it — the pruning here is within
the `purchasing_structure` payload only.

---

## 2. Pressing "Submit for review" changed nothing on the page

`ReviewStep.submit` called the API, fired a `toast.success`, and refreshed the
overview. That was all. The summary and the enabled **Submit for review** button
stayed exactly as they were, so a client who had just sent their pack was
looking at the same outstanding action a second later — with no confirmation it
worked, no statement of what happens next, and nothing between them and a second
`submission_versions` row. A toast is the least durable surface in the product:
gone in four seconds, gone on refresh.

Nothing was broken underneath. The server had recorded the submission, pushed
the case to `kyc_complete` / `client_submitted` / `client_portal_status:
'submitted'`, and the journey's `submission` step had been `complete` since —
the screen just never read its own step.

### The submitted state

`submissionReceipt` in `src/lib/aml/portalStepPresentation.ts`. Every input is a
server fact about `aml.submission_versions`; none of them is "the button was
clicked":

| input | what it is |
| --- | --- |
| `journeyStatus` | the canonical journey's `submission` step — complete exactly when a row exists |
| `recentSubmissions` | `overview.recent_submissions`, the rows that derivation reads (fallback for a server old enough not to send a journey) |
| `justSubmittedAt` | the row `submit_for_review` returned to *this* call — the same row, covering the seconds until the refetch reports it |

So the confirmation survives a refresh, a re-login and a different device, and
appears only after the write it describes. `onSubmitted` is now **awaited**, so
the button cannot go live again before the refreshed journey backs the
confirmation.

The screen gained: a `Submitting…` label with the existing spinner and a
disabled button while the request runs; a success alert with **What happens
next** (an adviser review, the request mechanism this page already renders, and
continued access — no response time, because nothing in the onboarding model
defines one); a persistent destructive alert on failure beside the existing
toast, retryable; and a disabled **Submitted** button in place of the primary
action.

Two states keep working:

- **The adviser asks for something.** `submit_for_review` writes version N+1 by
  design, and that is how a client answers a request. A secondary **Send updated
  information** button appears when an open `client_request` exists, or when a
  step has fallen back to needing attention since — gated on the same readiness
  rule the server enforces, so it is disabled while something is outstanding.
  Otherwise resubmitting is an accident rather than an intention, and the button
  is the disabled "Submitted".
- **Something goes outstanding after submission.** A rejected document flips the
  documents step back to `action_required`. The confirmation is still true and
  still shown, and the outstanding-step alert is shown with it — a confirmation
  on its own would be the last thing that client should be reading.

### "Everything we need from you has been received" beside "Documents — not started"

Checked, and **the logic is right**. `documentsJourneyStatus` reaches
`not_started` only when no requirement row exists *and* nothing was uploaded —
i.e. NPC has asked for nothing. Requirements are raised by explicit staff action
(`seed_default_requirements` / `upsert_requirement`, write-role gated); nothing
seeds them at case creation, and cases with zero requirement rows are the
production norm. `stepHoldsSubmission` deliberately lets that state through,
identically in the journey, on this screen and at `submit_for_review` — treating
it as a blocker would make every such case unsubmittable until the client
uploaded a document nobody asked for.

What was wrong was the *reading*. The all-clear now says so in a sentence when
documents are untouched: "We haven't asked you for any documents on this case…".
No rule changed; the contradiction was in the copy, not the gate.
