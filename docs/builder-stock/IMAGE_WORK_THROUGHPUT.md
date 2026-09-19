# How long a stock list takes to find its pictures

Read this before touching `sourceVerdictOutstanding` / `sweepWillJudge` in
`marketplaceEligibility.pure.ts`, `nextImageStage`, the serial loop in
`builder-stock-image-settler`, `settleFallbackImages`' outcome, or
`settle_builder_stock_marketplace_eligibility_tick`. Read
[`SUPPLIED_EVIDENCE.md`](./SUPPLIED_EVIDENCE.md) first if a single card is
blank — that is usually a question about one document, not about this.

Everything below is measured against production on 11 September 2026 and the
numbers are quoted rather than estimated.

## The two faults, and they are different kinds of thing

One property said **"Finding a picture…" for ever**, and every list was
**three times slower than it needed to be**. They were reported as one
complaint and they have nothing to do with each other.

## 1. The answer with no exit

`Lot 1037, Fuchsia Street` was uploaded at 07:13:52 and was still being
worked eighteen minutes later. One settler invocation:

```
item tick { settled: 126, last_stock_item_id: "aa3357ef…",
            stage: "fallback", next_stage: "fallback",
            progressed: true, primary_set: false, ms: 80565 }
```

One property, one stage, **126 times in eighty seconds**, and 102 more on the
next tick. It could never have ended.

**The cause is two modules disagreeing about what is owed.** Both verdict
sweeps — `settleMarketplaceEligibility` and `settleImageSanitization` — open
their loop with the same line, because only the image a source DESIGNATED as
the property's hero is worth a full decode:

```ts
if (!isPrimaryRole(readStoredRole(detail))) continue;
```

So a row of any other role is owed **nothing** by either sweep. Its
eligibility version stays `0` and its sanitization stays unsettled for ever,
*by design*. `nextImageStage` asked only the second half of that — "is the
version current?" — read `0` as **evidence that has not arrived**, and
answered `wait`. That is the one answer in that function with no exit. The
fallback ladder was never entered, `enrichment_status` stayed `pending`, the
row never left `readFallbackQueue`, and the settler re-claimed it in the same
millisecond because a tick that *attempted* something reported progress.

`nextImageStage`'s own comment had already warned about this, about a
different branch of the same function: *"It is the only answer here with no
exit, which is what made it the dangerous one to get wrong."* And
`primaryImage.ts`'s `awaitingVerdict` had the rule **right**, thirty lines
away, with the reason written out: *"Anything else has no verdict by design,
and treating its absence as 'unassessed' would freeze every item that happens
to hold a floorplan."*

**The shape is ordinary and will recur for every builder.** It is what a
package document leaves behind when the election REFUSES it — no page states
this property's identity, so nothing is designated and every stored image
carries `role: "unknown"`. Lot 1037's brochure is a duplicate of the
neighbouring row's, whose cover reads `NEX 20 — Lot 1307 Fuchsia Street`. The
refusal was correct. The consequence was not.

### The rules

- **`sweepWillJudge` is the one statement of what a sweep will look at**, and
  all four readers import it: both sweeps, `sourceVerdictOutstanding`, and
  `awaitingVerdict`. Two modules deciding separately what is owed is the whole
  defect, so a test asserts neither sweep spells the filter inline any more.
- **"Not yet judged" and "will never be judged" are opposite answers** that
  look identical in the column. `sourceVerdictOutstanding` is the only thing
  that may tell them apart, and it is `false` for every role but one, at every
  version, including a version from the future.
- **Progress is a rung climbed, not a property offered.** `attempted` rises for
  a property the ladder looked at and could not move; `laddered` is the honest
  unit and is what `settleClaimedItem` reports. Reported as progress, a
  motionless stage clears the claim's backoff and sets `retryAfterSeconds: 0`,
  which is what turned a stuck row into a spin rather than a slow retry.
- **One invocation never works the same property at the same stage twice.**
  `workedThisInvocation` makes the *shape* impossible whatever a future stage
  returns: the second offer is handed back with a real delay and **without**
  clearing the attempt counter, so the claim's own exponential backoff carries
  a genuinely stuck property out of the queue's way. It is logged as
  `item_work_stalled`, because it means a stage is reporting progress it did
  not make.

## 2. Where the wall clock went

A real import — `30ccabf920108099b502d7ac23995def.csv`, 18 properties:

| | |
|---|---|
| 02:05:48 | upload created |
| 02:06:12 | parsing done — **25 s** |
| 02:06:22 | first picture work |
| 02:18:18 | last property settled |

**12 min 30 s**, of which about **two minutes is work**: a document costs
6–8 s to fetch, elect and write back. The rest is queueing, and it has three
sources.

**The cron dispatches exactly two invocations a minute**
(`v_dispatch := 2`, `* * * * *`) and each may open at most three documents
(`HEAVY_DOCUMENTS_PER_INVOCATION = 3`). That is a deployment-wide ceiling of
**six documents a minute**, and it is deliberate: resident memory measured
50 → 173 → 236 → 247 MB across three package reads in one isolate, and the
fifth crosses the ~256 MB ceiling. **Neither number may be raised on an
argument.**

**Each property is claimed four times.** The ladder is
`source → eligibility → sanitization → fallback → settled`, one stage per
claim, and a completed stage sets `next_attempt = now`, which puts the row at
the *back* of the claim's `ORDER BY image_work_next_attempt_at`. So an import
is walked breadth-first: 18 properties × 4 stages = 72 claims. Actual claims
spent: **124**, 52 of them re-claims that moved nothing.

**And the invocation used to END when it reached its document allowance.**
That is the largest single waste in the engine:

```
item tick { settled: 3, claimable: 17, ms: 19360 }
```

Three documents opened, seventeen properties ready to go, **eighty seconds of
budget in hand**, and the worker exits. Across the import, 21 invocations used
524 s of the 2,100 s they were given — **25% utilisation**.

### The rules

- **The allowance refuses the DOCUMENT; it does not end the walk.** Three of
  every four claims are light, and ending the invocation made every one of them
  wait for a fresh minute of its own.
- **The light stages are not free**, and the comment that said they were
  ("eligibility, sanitization and fallback decode nothing") was wrong and was
  load-bearing. Eligibility downloads a stored photograph and decodes it;
  sanitization runs a full-resolution decode, a reconstruction and a re-decode.
  They are cheap *relative to a package*, which is why they are not counted
  against the allowance — and why what rides along behind a spent allowance is
  **bounded** (`LIGHT_ITEMS_AFTER_DOCUMENTS = 8`) rather than unlimited.
- **The bound is the envelope production has already demonstrated**, not an
  argument. Mixed invocations of eleven items are ordinary in the live log and
  light-only invocations reach thirty-six; three documents plus eight keeps the
  combination at eleven. Widening it needs a new memory measurement, not a
  better reason.
- **A refusal skips the property; it does not end the loop** — and the probe
  ends when the same property is offered twice, which means the whole claimable
  set has been round. `MAX_HANDBACKS_PER_INVOCATION` is the cheap outer bound
  for a very large, uniformly unworkable queue.
- **A handback still costs the property nothing.** It resets the attempt
  counter, because the invocation ran short and that is our scheduling rather
  than anything about its document. See
  `builderStockBudgetHandback.test.ts`.

## What this buys

A single-PDF upload now walks all four stages inside **one invocation** —
source, then eligibility, sanitization and fallback riding along behind it —
so it settles seconds after the first cron tick instead of on the fourth or
fifth minute. The eighteen-property import's light claims collapse into the
invocations that are already opening documents, leaving the six-documents-a-
minute ceiling as the floor: roughly **three to four minutes** rather than
twelve and a half.

Neither the ceiling nor the memory allowance moved. The throughput came from
the 75% of the budget that was being thrown away.
