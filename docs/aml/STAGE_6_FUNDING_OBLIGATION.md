# Stage 6 — Funding & transaction, and the stage that vanished

Read this before touching `fundingObligation.pure.ts`, `fundingStage` in
`journeyModel.ts`, the funding candidates in `workspaceViewModel.ts`, or the
interposed-stage note on `AmlNextActionCard`.

## What was on the screen

Stage 5 completed and the case jumped to **Stage 7 · Submission review**, under
a line reading:

> Stages 2–6 have nothing outstanding on this reading.

Stage 6's own journey reading disagreed: `not_started`, owner **analyst**, with
the blocker *"Source of funds not recorded"*.

Two derivations of one case, disagreeing, and the reassuring one on screen.

Measured on `AML-2026-00005`: **0 `source_of_funds` rows, 0 transactions**,
`case_stage = client_submitted`, `risk_rating` null, next action pointing at
stage 7.

## Why it was skipped

The next-action ranking orders candidates by journey position. It had exactly
one funding candidate, and it was gated on:

```js
facts.funding.sources.length > 0 && unverified.length > 0
```

**It spoke only once somebody had already started.** A case with nothing
recorded — which is every case at the moment stage 5 finishes — produced no
candidate at all. With stage 6 silent, the winner became stage 7.

The card's claim was the second half. It was printed from
`action.stageOrder > currentStageOrder + 1` and **never consulted a single one
of the stages it named.**

## The rule now

Whether stage 6 is owed is **decided**, never inferred from whether anybody has
got round to it. `deriveFundingObligation` returns a reading, a reason and the
facts it was decided from.

Source-of-funds evidence is customer due diligence, and this platform already
takes that position in its own data: `seed_default_requirements` writes
`source_of_funds` with `required: true`. So **the default is owed**.

### Only the perimeter can stand it down

The single lever is whether a designated service is being provided at all —
the same lever, and the only lever, that reaches sanctions. A case recorded as
an enquiry that never became a deal has no customer to conduct due diligence
on.

Two rules follow, both borrowed from the screening scope because the same
reasoning applies:

- **An unclassified case is not an exempt one.** With no perimeter recorded the
  default is INSIDE, so funding evidence is required. Silence is not an
  exemption.
- **A risk rating cannot reach it, in either direction.** `SCREENING_SCOPE.md`
  records why risk may never be a lever on an obligation that arises from
  providing the service at all.

### Enhanced due diligence is checked first

A case rated high or prohibited, flagged `edd_required`, or carrying a **PEP
finding** owes source of funds under the enhanced measures. That is evaluated
*before* the perimeter and returns `nonWaivable`, so a mis-recorded
classification cannot stand down the strictest funding obligation there is.

A PEP *finding* only — a candidate is not one, and an absent determination is
not a negative. It is a reason to escalate, never a reason to relax.

## Not required is never silent

When the obligation is `not_required`, the stage returns `applicable: false`
**with a `notApplicableReason`**. `applicable` is what takes it out of the
journey's count; the reason is what stops that being a disappearance.

The reason names what was *not* done — *"nobody was assessed and nothing was
cleared"* — rather than implying it was. Not required is not clear, which is
the rule this codebase keeps re-learning in new places.

The interposed-stage note on the next-action card now renders three readings,
derived from the journey rather than from the stage numbers:

| reading | what the card says |
| --- | --- |
| `not_required` | *Stage 6 · Funding — not required.* + the reason |
| `clear` | *Nothing is outstanding on the other stages in between.* |
| `outstanding` | *Stage 6 · Funding still has work outstanding.* |

The third exists because two derivations of one case disagreeing is a defect,
and printing the reassuring half of it is how it stays invisible. If it ever
fires, the ranking and the journey have drifted and the screen says so instead
of covering for it.

Told nothing, it says nothing. The claim used to be made from the stage numbers
alone; with no reading to support it, the honest output is silence.

## Unknown is not not-required

An unreadable funding fact leaves the stage `unknown` and **applicable**, with
`source of funds` named in `unavailableFacts`. A read that failed must never
produce a stage that quietly stands itself down — stage 6 is where that would
be least visible, because nobody is expecting it to speak.

## The audit trail

`sourceFacts` carries what the decision rested on — the perimeter
classification, the risk rating, whether EDD applies, whether a PEP finding
exists — and the card already renders them (*"Based on case_stage = …"*). Each
underlying fact is audited where it was recorded: the perimeter by
`classify_perimeter`, the determination in `pep_determinations`, the risk
rating on the case. The obligation is derived from them and reproducible, which
is the same position `deriveScreeningScope` takes for the client reading.

## Where the tests are

- `src/lib/aml/stage6FundingObligation.test.ts` — the obligation, the skip with
  a reason, the levers that cannot reach it, and the whole 5 → 6 → 7 walk
- `src/components/aml/workspace/__tests__/amlNextActionInterposed.test.tsx` —
  what the card may claim about the stages it steps over
- `src/lib/aml/nextActionStageOrder.test.ts` — the walk order, including the
  case with nothing recorded
