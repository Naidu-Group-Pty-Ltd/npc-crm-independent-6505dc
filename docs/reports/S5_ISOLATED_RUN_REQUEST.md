# One bounded request: the isolated environment for R1–R12

Everything in this document is **prepared and not started**. It asks for one
decision, with measured numbers rather than estimates, and it is the only
thing standing between the branch and a closed S5.

**It does not ask to touch a single existing customer report.**

---

## 1 · Why a stand-in cannot close it

Four of the ten documents are already produced by real code with no model call
at all — the Financial and Due Diligence reports are deterministic. The
Briefing and the Snapshot each make **one** model call, and that call is
currently stood in for by `scripts/reports/_condenseStandIn.mts`, which
excerpts the parent's own blocks.

That stand-in was built to test the **composition**, which was the untested
half, and it does that honestly — it cannot invent a figure, so a defect found
downstream of it is the composition's. But it is not the model, and the
property-fact repair in particular is a change to what the model is TOLD.
Proving it needs a run that tells it.

The same applies to R1–R12: an edit that is saved, reopened and compared is a
behaviour, and no fixture demonstrates it.

---

## 2 · What is asked for

### a · One Supabase branch

Branching is enabled on this project and has been used here before
(`aml-staging-validation`, project ref `yncczbrmicjebjepfave`). A branch is a
**separate Supabase project** — its own database, its own edge functions, its
own storage. Production is not reachable from it.

**Measured cost: `$0.01344` per hour** (Supabase, org `mrfuwtroeeczontuqwsz`).
At 72 hours that is **$0.97**.

### b · Vendor credentials on that branch

Generation calls Perplexity for live search and the Lovable AI gateway for the
model. The branch needs those secrets set, or generation returns nothing and
the run proves nothing.

### c · A model-call allowance

Measured from `api_usage_log` over the last 30 days:

| service | model | calls | avg per call |
| --- | --- | ---: | ---: |
| perplexity | sonar-pro | 534 | **$0.06386** |
| perplexity | sonar | 63 | $0.00674 |
| lovable-ai-gateway | gemini-3-flash-preview | 1,133 | $0.00000 recorded |

534 sonar-pro calls fall in 34 distinct hours — about 16 an hour of activity,
which matches one report's ~17 sections. So:

| | calls | cost |
| --- | ---: | ---: |
| Compass × 3 (two subjects + the conflicting-case test) | ~51 sonar-pro | **$3.26** |
| Briefing × 2, Snapshot × 2 | 4 gateway | $0.00 recorded |
| Financial × 2, Due Diligence × 2 | 0 | $0.00 |
| resume and retry headroom (×2 on the above) | ~51 | $3.26 |

**Expected ≈ $6.52. Requested ceiling: $25**, which is four times the expected
spend and still less than one fifth of the $34.10 this account spent on
sonar-pro in the last thirty days.

### d · Disposable records, created by the run

On the branch only: one client, two properties (the same two addresses), and
the report rows the workflow itself writes. Every one is created by the run
and removed by it.

**No existing report is read for writing, edited, regenerated or overwritten** —
on the branch or anywhere else.

---

## 3 · Exactly what the run does

| check | what it exercises | report types |
| --- | --- | --- |
| R1 Generate | the supported workflow end to end, including resume | Compass ×2 |
| **§4 conflicting case** | structured bed/bath ABSENT while listing material supplies counts — the output must follow the evidence policy and must not promote a listing assertion into an accepted property fact | Compass ×1 |
| R2–R3 Edit, save, reopen | an intentional edit read back unchanged, no unintended regeneration | Compass, Briefing |
| R4–R5 Template apply and change | selection survives reload; the alternative renders; content and history intact | all five |
| R6–R7 Preview and export | export matches preview, every section, final sentence, no truncation | all ten |
| R8–R9 Navigate, permissions | routes and back navigation; role and workspace limits in UI and server | all |
| R10–R11 Historical compatibility, preserved edits | legacy formats still render; pre-change edits survive, compared by content | representative legacy rows on the branch |
| R12 Protected records | checksums of report content, scores and financial values before and after | seeded protected rows |
| Briefing and Snapshot | the real condensation path, no stand-in | Briefing ×2, Snapshot ×2 |

Then: ten final PDFs, every page read, identified by the S5 manifest.

---

## 4 · What proceeds without this approval

Not blocked, and continuing now:

* the remaining named inconsistencies — conflicting verdicts, unreconciled
  prices, superseded Norwest claims, unsupported low-risk conclusions;
* the approved SWOT, suitability, strategy, exit and monitoring content;
* the evidence-backed ten-year outlook;
* the targeted template changes, prepared in isolation with a dry-run diff,
  affected-master list and rollback;
* the S6 release package, rollback rehearsal and deployment order;
* every gate, spec and document.

**S5 stays open** either way until its content and behavioural gates pass.

---

## 5 · The one-line version

> One Supabase branch (~$1 for three days), the vendor keys it needs, and a
> **$25 ceiling** on model spend, to generate three Compasses, two Briefings
> and two Snapshots against records the run creates and deletes — so that the
> Briefing, the Snapshot and the property-fact repair are demonstrated by
> behaviour instead of asserted from a prompt.
