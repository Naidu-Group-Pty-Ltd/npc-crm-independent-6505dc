# The PEP determination — what it rests on

Read this before touching `_shared/aml/pepEvidence.pure.ts`,
`src/lib/aml/pepSearchLinks.pure.ts`, `PepDeterminationDialog`, or the
`record_pep_determination` / `defer_pep_determination` operations in
`aml-cases`.

Stage 5 asks two different questions and they are answered in two different
places. Sanctions screening is a **match against a register**, run by a
provider or by an MLRO by hand
([`SCREENING_EXECUTION.md`](./SCREENING_EXECUTION.md)). A politically-exposed-
person determination is a **conclusion a person reaches**, and there is no
register that settles it. This document is about the second one.

## The standard

The statutory test is that the reporting entity establishes the position **on
reasonable grounds**. AUSTRAC reads that as an objective standard: somebody in
the same position, reviewing the same material with similar experience, should
be capable of reaching the same conclusion.

There is no prescribed form, no mandated database and no mandated sequence.
What there is, is a record that has to show **how** the conclusion was
reached — which sources were consulted, what was searched, and what came back.
That is exactly the part the old flow did not collect.

## What was wrong

A generic prompt dialog with two free-text boxes. Three faults, and none of
them was a line of code:

**1. It had already decided the answer before it opened.** The stage CTA
called `recordPep(subject, "not_pep")`, so pressing a button labelled "Record
PEP determination" opened a dialog headed "Record not-PEP determination". The
conclusion *is* the determination. An operator who had found a PEP had to
cancel and hunt for the other button, and a pre-selected "not a PEP" is the
one default this product cannot carry.

**2. Its own worked example of a source was a sanctions register.** The
placeholder read `DFAT consolidated list — screened via case screening`. The
DFAT Consolidated List is a **targeted financial sanctions** register. It is
the authoritative Australian source for sanctions and it is not a PEP register
of any kind, so absence from it is not evidence about political exposure — and
the product was teaching operators to write exactly that down.

The asymmetry matters, because the instinct is not silly. A sanctions **hit**
is genuine evidence *towards* exposure: designation lists are full of
ministers, officials and state-enterprise directors. A sanctions **miss** says
nothing at all. A source that can only ever support the negative conclusion is
a source that can only ever mislead. So a sanctions list is **refused** as a
PEP source, and a live sanctions match is surfaced **separately**, as a signal
the determination must consider — `sanctionsSignalForPep` speaks for
`confirmed` and `candidate` and is deliberately **silent** for "screened, no
match".

**3. There was nowhere to say "I could not tell".** The dialog offered two
outcomes, both of them determinations. An operator who had reached the end of
the available checking and was not satisfied had to pick one anyway, which is
how an unfounded conclusion gets written down.

## The shape now

Three numbered steps, all on screen at once. This is a checklist, not a
wizard: an operator writing down why a conclusion is reasonable has to be able
to see what they found while they write it.

| | |
| --- | --- |
| **1 · What the customer told us** | Read-only, seeded as a source, labelled as a declaration. |
| **2 · Check the sources** | One click opens a source and adds the row; the operator records what was searched and what came back. |
| **3 · The determination** | Not a PEP · PEP (with category, relationship, office, jurisdiction and *currently held*) · **Cannot determine yet**. |

The footer never scrolls and it **says what is missing** rather than leaving a
disabled button to be interpreted — `verdict.errors[0].message`, from the same
module the server enforces.

## The rules

**One rule, rendered and enforced.** `assessPepEvidence` lives in
`supabase/functions/_shared/aml/pepEvidence.pure.ts`. The dialog renders from
it and `record_pep_determination` enforces it at the write boundary, so what
an operator is asked for and what the server accepts cannot become two
standards. `src/lib/aml/pepEvidence.ts` is a re-export and nothing else.

Above the statutory floor it holds three Aurixa controls:

- **A sanctions register is not a PEP source.** Matched case-insensitively
  against the source *and* the reference. The term list is deliberately small
  and explicit rather than a clever pattern — a broad regex would reject
  "register of members' interests, checked for a sanctions-related
  directorship", which is a perfectly good source.
- **At least one source independent of the customer.** Their own declaration
  is evidence towards the determination and never the whole of it; it is the
  thing being tested. It is seeded so nobody retypes it, and it is counted
  separately so it can never stand alone.
- **A searched source must say what came back.** "Checked the Government
  Directory" is not a record of a check. "Checked the Government Directory for
  <name> — no entry" is. A declaration is not a search, so it is exempt.

**A deferral is not a third outcome.** `defer_pep_determination` writes **no**
determination row. It appends a case event carrying the reason, what is needed
and what was checked, stamped `determination_recorded: false` so no future
reader can mistake it for a conclusion. The scope stays outstanding and
Stage 5 stays open. `assessPepDeferral` requires a reason from the list and a
statement of what is missing, because "could not determine" reads, six months
later, exactly like nobody having tried.

**Leaving office is not an expiry date.** `holds_position_currently` is an
attribute of the determination, not a softer outcome. FATF and AUSTRAC treat a
former PEP on a **risk-sensitive** basis — there is no period after which the
status lapses — so the answer feeds the risk assessment rather than quietly
switching the controls off.

## The assisted search

`src/lib/aml/pepSearchLinks.pure.ts` builds **search URLs**. It performs no
request, reads no result and decides nothing. It removes the two minutes of
typing a name into four sites and the risk of searching a different spelling
in each; a person opens the source, looks, and records what they saw.

That is the compliance point rather than a disclaimer. **Nothing here can
return "no match", because nothing here matches anything** — a partial index
reporting "no match" is the confident-clear-against-nothing failure this
platform has already had once, with an empty `sanctions_entries`.

The sources are public and none requires a licence: the **Australian
Government Directory** (Commonwealth office holders, which AUSTRAC's own
guidance points at), the **Parliament of Australia** parliamentarian search
(the elected limb the Directory does not carry), **ABN Lookup**, and open-
source and media searches on the subject's own name. `pep_database` remains a
manual row precisely because this product has no such subscription, and
offering it in a dropdown would invite an operator to tick a source they never
used.

**What the searches do not reach is rendered beside them, every time.**
Foreign office holders are not comprehensively covered; family members and
close associates are not published anywhere and are reached by asking; and
somebody who has left a position may not appear in a current directory. An
operator who has run five searches and found nothing needs to know which parts
of the definition those searches never covered — otherwise "nothing found"
quietly becomes "nobody is exposed".

## One act is said once on a screen

The reported screen carried the same act three times — the stage header's CTA,
the numbered path's open step, and the rail's "Go to stage 5" — in three sets
of words, above **two** progress readings that counted different things ("2 of
3 items on this stage complete" beside "3 of 5 settled"). Both counts were
true, which is what made it worse than either alone.

`AmlJourneyStageHeader` takes `deferToSurfaceBelow` and
`AmlLivePositionRail` takes `currentSection`. The repeat is suppressed at the
header and the rail, **never at the path**, because the path is the surface
the work happens in and the header is the surface an operator orients by.
Every other stage, which has no such surface, behaves exactly as it did.

## The screen must not contradict the search it describes

Two defects that were not in the rules at all. Both were arrangements of
correct information.

### Prose that counts things goes stale

The manual-register section said, in fixed words:

> The two Commonwealth registers block automated requests, so the run above
> cannot read them.

By the time anybody read that, **one** did. Parliament of Australia had become
a register the server searches on every run — 225 entries — and the panel
directly above the sentence said so: *"1 source was not searched."* The same
scroll, two answers, and the operator sent to open by hand a register the
platform had just read for them.

Correcting "two" to "one" would have been true until the next source moved,
and moving sources from *somebody opens a tab* to *the server reads it* is the
whole direction of this programme. So `pepManualChecks.pure.ts` derives the
wording and the count from the run's own `sources`, and a register the run read
is offered as a place to **confirm a candidate** rather than as a hole to fill.

Three states, because not every manual link is a coverage failure:

| state | meaning |
| --- | --- |
| `searched_by_platform` | the run read it. Open it to confirm, not to check |
| `must_check_by_hand` | the run could not read it. Opening it is the only check |
| `not_held_by_platform` | never a register the index could hold — ParlInfo is an archive, ABN Lookup a company register |

Listing the third as "the run could not read them" would report a coverage
failure that does not exist, which is the same overstatement pointed the other
way. Two rules follow: with **no run**, every register the platform holds needs
a person — a search nobody has run has read nothing — and a run that **failed**
puts them all back rather than crediting this attempt with the last one's reach.

The link ids and the index source keys are mapped **explicitly**, including
where they happen to be identical. "The ids match" is not a rule, and relying
on it would classify a future non-matching pair as a register nobody holds.

### One closed door at a time is not a next step

The footer rendered `verdict.errors[0]?.message`. Before an outcome is chosen
the only error is *"Choose what was determined"*, so every other requirement
was invisible: pick an outcome, discover you need an independent source; supply
one, discover you need a rationale; write one, discover a source has no
recorded result. Every message correct, and the sequence a corridor of closed
doors.

`pepDeterminationSteps.pure.ts` lists everything outstanding at once, each item
naming the step it belongs to. It is **derived from the errors the assessment
actually produces**, never a second list of rules — what the operator is shown
outstanding and what the server refuses cannot become two standards.

**The invariant that makes an up-front list honest:** `assessPepEvidence` takes
a `result` and never reads it. The sources, the results and the rationale are
required identically for *a PEP* and *not a PEP* — the standard of evidence
cannot be lower for the conclusion that closes the file. That is what lets the
evidence requirements be shown before an outcome exists, and a test asserts the
two outcomes produce identical errors, so if the bar is ever made to depend on
the answer the test fails rather than the screen quietly misleading somebody.

Two smaller rules. A requirement that cannot be judged yet — the PEP-specific
questions before an outcome exists — renders as **pending**, not as failing: an
unmet requirement is work to do and a question nobody has asked is not, and a
red cross against the second misstates the operator's progress. And a sanctions
register named as PEP evidence appears only **once it has been recorded**,
because it is a mistake rather than an outstanding task, and listing it up front
would read as an instruction to go and check one.

### What the registers do not cover, said where the work is

The loader has measured coverage against the AML/CTF Rule categories since the
index gained a second register, and it rendered two clicks away inside the
search panel. Its whole value is the answer to one question asked at exactly
this moment: **the run came back with nothing — what had it never looked at?**

`PepCoverageGaps` renders it beside the manual checks, because the answer *is*
the manual checks. Gaps are computed **across** registers rather than per
register: per-register would list "judiciary" as a gap against a register of
parliamentary seats, which is true, useless, and buries the real one. An index
whose coverage was never measured says so rather than reading as a clean bill,
and a status that could not be read is unknown rather than empty.

### No PEP surface claims an office is held today

Every Parliament row carries `currently_held: true` by construction. A test
scans every `Pep*.tsx` for a badge reading the bare word **"Current"** — two
components rendered one and were fixed separately, which is exactly why the
guard scans the directory rather than the two that were known. Both now render
`describeTenure`, the single function that turns "held" plus an as-at into
words; the run panel feeds it through an adapter because a run stores less than
an index coverage row.

## A refetch behind the dialog must not throw away the work

### What the operator saw

The screening ran, its results cascaded into the register checklist, and then
the section came and went. Opening a register and coming back lost it. So did
waiting.

### Why

The workspace keeps an open case current with `useLiveCaseRefresh`, which
refetches on **`focus` and `visibilitychange`** — and on a timer. This screen's
own design asks the operator to open official registers in a new tab and come
back, so **returning from a register is a refetch, every time.**

The refetch parses fresh JSON. `pep_declaration` is a new object with identical
content. And the dialog's reset effect was keyed on that object:

```js
}, [open, declaration]);
```

so it fired. `runSources` was cleared, the cascade effect stripped every row the
run had written, and anything typed into the determination went with it. The
screening card above stayed — the run lives in the child component — so the
checklist below it simply emptied, and the only way back was to run the
screening again.

The timer made it worse than the click: a poll could land mid-sentence with
nothing the operator did to provoke it.

**Object identity of refetched data is not a signal that anything changed.**

### The rule

A session is one (open dialog, party). `sessionKey` is that, as a string, and
it is the only thing that may reset this state. A ref records what the state
was initialised for, so re-running the effect on any other render is a no-op.

Two halves, and the second is what stops the fix becoming a new defect:

- **Refetches change nothing.** The declaration is read through a ref at
  initialisation, so it is not a dependency of it.
- **A different party still starts clean.** Telling an operator a register was
  searched for a party it was never searched for is the same lie from the
  opposite direction, so the reset is narrowed rather than removed.

The customer's declaration is seeded **once per session and never rewritten**.
It can arrive after the dialog opens, so it cannot live in the initialiser; its
dependencies are the answer's **primitives**, so a refetch carrying the same
answer does nothing. If the customer later changes their answer that is a real
event, and it is not handled by silently editing a row the operator may already
have relied on — the screening run reads the declaration server-side at the
moment it runs, which is where a changed answer is picked up.

### One report upwards, derived from the run

The run panel told the checklist what it had read in **three** places — on
restoring the party's last screening, on a new run, and on failure. Three
chances for the checklist to describe a search the panel did not perform.

It is one effect on `run` now. Whatever sets it, the parent is told the same
thing by the same code, and the two cannot diverge because there is nothing to
keep in step. The callback is held in a ref so an unstable prop identity cannot
make it fire on renders where the run has not changed.

### A note on the guard tests

Three of the source rules in this area have now failed on their own
documentation — the comment explaining a removed line necessarily quotes it.
`pepDeterminationDialog.source.test.ts` strips comment lines through one
`codeOnly` helper rather than each rule remembering to.

## Where the tests are

| | |
| --- | --- |
| the contract itself | `src/lib/aml/pepEvidence.test.ts` |
| the searches | `src/lib/aml/pepSearchLinks.test.ts` |
| the dialog, end to end | `src/components/aml/__tests__/partyScreeningPanel.test.tsx` |
| the endpoints hold the same rule | `src/lib/aml/amlScreeningRepair.contract.test.ts` |
| one act, said once | `src/components/aml/workspace/__tests__/oneActOnce.test.tsx` |
