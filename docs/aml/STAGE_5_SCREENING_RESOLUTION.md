# Stage 5 — the screening resolution centre

Read this before changing `ScreeningStageCard.tsx`,
`screeningResolution.pure.ts`, `screeningNextAction.ts`,
`AmlContextActionPanel.tsx`, or `deriveScreeningNextAction`.

Stage 5 already had every fact it needed, decided server-side and correct.
What it did not have was an arrangement of them. An operator opened the stage
and read a stage card, a screening scope, a parties list, a sanctions
requirement, a party-screening panel, a screening-checks panel and a right
rail, then reconciled all seven to learn one thing: what to do next. This
programme is orchestration over that architecture. It adds no screening
system, no determination store, no policy engine and no journey status.

## The reported screen, and what it actually was

A case showing **Case stage: Closed**, **Service gate: Terminated**,
**Passport: Revoked** — and beside them an **Advance status** card offering
*Cleared*, over a Stage 5 that looked like live onboarding.

Traced to the production row. `AML-2026-00005` held
`case_stage = 'closed'` and `status = 'kyc_complete'` at the same time. Both
surfaces were reading their own dimension correctly and **the data disagreed
with itself**.

The write that produced it is in the case events: *"Case reopened — resumed
at kyc_complete"*. `reopen_case` moved the legacy `status`, and left the
canonical `case_stage` and `closed_at` exactly where they were.
`transition` — the other write that changes `status` — has always kept
`case_stage`, `client_portal_status` and `service_gate_status` coherent
through `STATUS_TO_STAGE`. Reopening did not, and nothing noticed because each
reader was individually right.

**`reopen_case` now syncs `case_stage` and clears `closed_at`.** It still
deliberately does **not** touch `service_gate_status`:
`STATUS_TO_SERVICE_GATE[resumeStatus]` would revive a terminated gate, which
is the one thing reopening must never do.

Two dimensions, one lifecycle: a disagreement between them is a defect rather
than a third state, so every reader takes the **safer** of the two. The
transition panel is terminal when *either* says closed, and the sync operation
reports `case_closed` on the same rule.

## The second dead end

**Provider unavailable, with nothing to press.** The blockage was real, the
owner was right, and the MLRO looking at it could lawfully have completed the
screening by hand — the capability shipped in #2202 — but the stage named
neither route.

`ScreeningNextAction` now carries an optional `alternative`: a second lawful
route to the same blockage, owned by a different role. **Both are decided
server-side**; the browser only chooses which to show first. When a required
sanctions screening is blocked, the MLRO's primary is *Complete sanctions
screening manually* and the administrator's route stays named and owned as the
alternative — so the broken automation is never papered over by the existence
of a manual route, and neither role is left holding a status with no step.

An alternative is a different **method** of discharging an obligation. Nothing
in it can make an obligation unnecessary.

## Working the case to completion found four more

The stage said the right things and then could not act on any of them.

**1 — the reopen that could not run.** *"Reopen case to resume AML/CTF"*
returned **"AML-2026-00005 is not closed, so there is nothing to reopen."**
The UI read the canonical dimension and `planCaseReopen` checked the legacy
one, so the single action offered was the single action that could not
execute — and a case already stuck in the divergence could never leave it,
because reopening is the thing that reconciles the two. `planCaseReopen` now
takes `caseStage` and treats the case as closed if **either** dimension says
so. Every other refusal — role, reason, nothing-restored — is unchanged.

**2 — a determination nobody made.** The PEP row read **"Not a PEP · Recorded
for every party in scope"** on a case with zero `pep_determinations` rows.
`buildDeterminationRows` computed it over `subjects.filter(s => s.required)`
— the **sanctions** obligation — which on a perimeter-excluded case is empty,
and `.some()` over an empty array is `false`. A vacuous truth is the worst
failure mode this product has: it is a determination nobody made, rendered as
one that was. PEP now counts **enrolled** parties, and nobody enrolled is
outstanding rather than satisfied. The screened scopes get the same treatment
— `settled` requires a party to be settled about.

**3 — not owed reported as not done.** The journey said *"Screening has not
been run"* on a case whose every party's screening obligation had been stood
down, directly above a card correctly saying sanctions was not required. Both
statements were true and they read as a contradiction. `screeningStage` and
the compliance summary now separate *enrolled with nothing to screen*
(settled) from *nobody enrolled* (outstanding); the second branch is
unchanged.

**4 — the real work was nameless.** The one thing outstanding on that case was
a **PEP determination**, and the journey stage never read PEP at all. It does
now — per party, absent means outstanding — and the primary action says
*Record PEP determination* instead of *Open screening & ownership*. An unread
scope decision reads as `unknown`: fail-closed for completion, without
inventing outstanding work or claiming an owner, and never outranking a match
awaiting adjudication.

## Reopening only means something if the journey resumes

The reopen worked — the lifecycle dimensions came back into agreement — and
every surface carried on as though the case were finished. Three causes.

**A terminated service gate was being read as a closed case.** `isFinished`
and `deriveAmlNextAction` both keyed off
`case_stage === "closed" || service_gate_status === "terminated"`. Reopening
*deliberately* leaves the gate terminated, so the reopened case still rested
on "10 of 10 · Partners & ongoing CDD", still announced "Case closed", and
still silenced Stage 5's outstanding determination. That made reopening a
no-op everywhere an operator looks.

They are different facts. A terminated gate says the customer may not be
**served**; it says nothing about whether the case is being **worked**. The
lifecycle alone decides finished, and the gate keeps its own row — where it
was always the honest place for it.

**The stage counted the wrong parties.** `subjectCount` came from the
subjects whose SCREENING is owed, which on a perimeter-excluded case is none,
so Stage 5 answered *"Nobody is enrolled for screening yet · Prepare
screening"* about a case with an enrolled party — directly above its own
determination row saying the PEP determination was outstanding. Three
surfaces, three answers. Enrolment is about the PARTIES; screening is about
the obligation, and `anyMissingPep` now reads the enrolled parties and only
when the scope owes a determination.

**The CTAs named an act and performed a navigation.** A stage's primary
action points at the section the stage OPENS ON, so from the place it is most
often pressed — "Ask the client for something" on Stage 2, "Record PEP
determination" on Stage 5 — it navigated to where the operator already was
and nothing happened. The header now takes an `onPerform` handler and the
workspace routes it: `record_pep` opens the determination dialog on the first
party that needs one, `client_request` focuses the request form. Both fall
back to the old navigation for anything unrouted, and neither mutates
anything — each opens an existing surface whose own server operation carries
the authorisation and the audit record.

## One case, one position, one next action

The screenshots showed a single case answering the same question three ways:
Stage 5 said the PEP determination was outstanding, Live Position said
"6 of 10 · Funding & transaction", Next Action said "Review the client
submission — Go to stage 7", and Attention said "nothing on this case is
unresolved". Each was individually derived and internally consistent.

Two causes, and both were about the same missing fact.

**A required determination with no record was only an OUTSTANDING item.** It
was pushed to `outstandingItems` with a `waiting` tone — which reads as
"somebody else is working on it" — so Stage 5 never set `blocking`, and the
Attention panel, which derives from blockers, had nothing to report. It is now
a **blocker**: nobody is working on it, it is owed, and it holds the stage.

**And `currentStage` scanned every stage for a blocker BEFORE considering
order.** So a later stage's blocker (a submission awaiting review at 7)
outranked an earlier stage's work (a determination owed at 5), and the journey
stepped straight over the requirement. The stages are sequential — a case
cannot be *at* 7 while 5 is unfinished, whatever the relative urgency — so the
first applicable stage with real outstanding work now wins.

`unknown` is deliberately not "work". It means the fact could not be read, and
parking the whole journey on a failed read would be noise; `unavailableFacts`
already reports it honestly.

**`nextActionCandidates` had no PEP candidate at all**, so the rail could not
name the determination even in principle. It now has one, reading the same
facts the journey reads — so the two agree by construction rather than by being
kept in step — placed at journey position 5 and ranked below a finding, because
a candidate or a confirmed match is a fact about a customer and still leads.

## A person is not in or out of scope — each check is

The parties list carried a single `not in scope` badge whenever a party's
*sanctions* obligation had been stood down. On the reported case that put
**"not in scope"** beside the primary customer of an active AML file who still
owed a PEP determination: the most alarming thing that panel could say, and the
opposite of the truth.

Each person now carries a status **per check**, taken from the server's own
scope decision, and the section is called *People to assess*.

## The Australian sanctions source

Stage 5 could say a screening was unavailable and never say which Australian
source it would have used or why it could not run. `readSanctionsSource`
derives five honest states — `current`, `stale`, `not_loaded`, `sync_failed`,
`unknown` — from `sanctions_list_syncs` and the live entry count, and the card
shows the entry count, the load date and whether automated screening is ready.

Every value is live. A test asserts no count, date or freshness is hard-coded,
and an unread source reports as **unknown** and never as ready. A `succeeded`
sync that loaded zero entries is not a loaded list.

## A reopened enquiry asks the question

A case stood down as an enquiry and then reopened is a contradiction worth
raising: the lifecycle says it is being worked, the recorded perimeter says the
relationship never began. Stage 5 now prompts **Case classification requires
review** at the top, for a reviewer or the MLRO.

It changes nothing and infers nothing from the reopen. The perimeter is a
compliance determination and stays exactly as recorded until somebody records
another one; what changed is that the question is asked where it can be seen,
instead of leaving an operator to find *Reclassify perimeter* at the foot of
the page and know to look for it.

## The way on

When every required determination is genuinely recorded, Stage 5 offers
**Continue to Funding** — a navigation that completes nothing, advances no
case stage and confers no authorisation, which the control says on itself.
Completing Stage 5 is **evidence completion**; the designated service still
proceeds only through the separate service-gate decision. The words *AML
clear*, *AML approved* and *client compliant* do not appear at this stage, and
a test asserts they cannot.

## Obligation ≠ method ≠ outcome

The rule the whole screen turns on. Three different questions were being
rendered in one vocabulary:

| | question | values |
| --- | --- | --- |
| **Obligation** | is this owed at all? | required · not required · not established |
| **Method** | how would it be carried out? | automated · automated unavailable · manual MLRO · recorded determination · none |
| **Outcome** | what has been established? | not started · running · no match · possible match · confirmed match · unable to complete · not a PEP · PEP · review due |

`not required` is an **obligation**. `no match` is an **outcome**. `provider
unavailable` is a **method** being unavailable and says nothing about either.
Collapsing them into one badge is how "not required" came to read as "clear",
and how an unavailable provider came to read as a case that needed nothing. A
test asserts the two vocabularies share no value at all.

`screeningResolution.pure.ts` builds one row per determination and is pure: it
reads what the server decided and arranges it. It decides no obligation,
performs no screening and reaches no determination.

## The four layers

```
A  lifecycle · ONE status · ONE action (+ the other lawful route)
B  required determinations — one row each, three answers each
C  checks that are not required — collapsed
D  parties, and the evidence panels below the card
```

Layer C is collapsed on purpose: a scope nobody owes is not a task, and
putting it beside the ones that are is most of why the screen took a minute to
read. The reasoning stays one click away, because a reduced scope has to
remain reviewable.

## Closed cases

A closed case is a **retained record**. Its evidence stays readable and, where
the compliance architecture allows, recordable — no screening, adjudication or
PEP operation checks case status, which is the product's existing and
deliberate rule. What a closed case does not do is progress.

So the stage leads with that, states it in full, and offers the one authorised
action: `reopen_case`, through the existing operation and its recorded reason.
The rule is held on **both** sides — the engine and `resolveClosedCaseAction`
in the browser — because the two deploy separately and a Stage 5 that says
"Run screening" on a retained record asserts the journey is moving when it is
not.

**A finding is exempt.** A possible or confirmed match is a fact about a
customer and does not stop being one because the file was closed, so
adjudication and escalation still outrank the lifecycle.

Reopening restores the ability to **work** the case. It does not approve the
service, revive a terminated gate, restore a revoked passport, create partner
reliance, or mark any screening complete — asserted individually against the
operation's source.

## Nothing is reclassified automatically

A case previously classified `enquiry_only` that resumes is **prompted** to
review its perimeter; it is never silently flipped. Perimeter classification
is a compliance determination recorded by a reviewer or the MLRO, unknown
fails closed, and `reopen_case` writes nothing to
`case_screening_perimeter`.

## Two numbers, two questions

The rail said "10 of 10" beside "Closed" beside an open Stage 5, and called
two of the three "stage". They now say which question each answers:
**Viewing · Stage 5** for what the operator has open, **Journey position** for
where the record has got to, **Case lifecycle** for its status.

## Roles

| action | who |
| --- | --- |
| `run_screening`, `screening_stalled`, `enrol_subjects` | any Stage 5 writer |
| `classify_perimeter`, `adjudicate_match`, `reopen_case` | reviewer or MLRO |
| `complete_manually` | **MLRO only** |

Hiding a control is never authorisation. Every one of these is enforced
independently by the edge function.

## Deployment prerequisites

Measured against the live project on 2026-08-19. None of this is code to work
around; the manual route is a lawful alternative and the automated defects stay
observable to administrators.

- **`aml.sanctions_entries` = 0**, and `aml.sanctions_list_syncs` holds **no
  rows at all**. The DFAT Consolidated List has never been imported, so an
  automated check would screen against nothing. The MLRO uploads it at
  `/aml/verification`.
- **`provider_configs.pep_sanctions` is `local_lists`, `active`, `mode =
  simulator`.** Production refuses a simulator provider rather than degrading
  to it. It must be finished as live — and promotion is earned by entries
  actually being written, never asserted.
- **`20260921000000_aml_manual_screening.sql` IS applied.** `screening_method`
  exists on `aml.screening_checks`. No new migration is needed for this work.
- **The edge functions in this branch are undeployed.** Until `aml-cases`
  ships, `case_closed`, `manualAvailable` and the `alternative` route are
  absent from the response; the browser-side overrides in
  `screeningNextAction.ts` and `AmlContextActionPanel.tsx` carry the closed-case
  reading in the meantime, which is why they exist.

## UAT

1. Open a closed case. Expect **Case closed — journey paused**, a retained-record
   explanation, **Reopen case to resume AML/CTF**, and no Advance status card.
2. Reopen it. Expect the lifecycle to read as resumed on every surface at once,
   the service gate to stay terminated, and no passport to appear.
3. On a case with sanctions required and the provider down, as MLRO: expect
   **Complete sanctions screening manually** as the primary and the provider
   fault named as the alternative. As an administrator: the reverse.
4. Record a manual no-match. Expect the sanctions row to settle and PEP to stay
   outstanding on its own.
5. On an enquiry-only case: sanctions reads *Not required / No screening
   required / Nobody screened* and never *No match*.
