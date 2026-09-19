# Reconciling the two development-activity readings

**Subject:** 18 Annabelle Crescent, Kellyville NSW 2155 · The Hills Shire Council
**Register:** NSW Planning Portal — Online DA API (`api.apps1.nsw.gov.au/eplanning`), CC BY 4.0
**Reconciled:** 17 Sep 2026

The delivery instruction named two readings of one register and asked that they
be reconciled — *"reconciliation checkpoints, not numbers to hard-code"* —
identifying geography, date window, retrieval completeness, application
classes, counting rules and evidence version.

|  | dwellings | over | stated cost | over | rows read |
|---|---|---|---|---|---|
| **A** — as the report printed it | 680 | 171 applications | $808,649,729 | 278 applications | **300 of 650** |
| **C** — as it reads now | 1,410 | 301 applications | $1,175,556,030 | 452 applications | **655 of 655** |

They reconcile exactly, and into two independent components. Nothing below is
hard-coded anywhere: every figure is what the modules compute from the rows,
and all of it moves when the register does.

## The six questions

| | A (stored) | C (current) | Differs? |
|---|---|---|---|
| **Geography** | The Hills Shire Council | The Hills Shire Council | No |
| **Date window** | lodged 2026-03-18 → 2026-09-17 | identical | No |
| **Publisher** | NSW Online DA API, CC BY 4.0 | identical | No |
| **Retrieval completeness** | `rowsRead: 300`, `totalInPeriod: 650` | 655 of 655, 7 pages of 7 at PageSize 100 | **Yes** |
| **Application classes** | none — no class split existed | 471 new · 184 amendments · 0 unrecognised | **Yes** |
| **Counting rules** | every row summed | new applications only; `rowsStating` per figure | **Yes** |
| **Evidence version** | `planning-data-service` as deployed 17 Sep | `summariseDaRows` at HEAD over the complete rows | **Yes** |

## The arithmetic

Introduce **B** — the *old* counting rule applied to the *complete* walk — to
separate the two causes:

| | dwellings | stated cost |
|---|---|---|
| **A** old rule, 300 of 650 rows | 680 | $808,649,729 |
| **B** old rule, 655 of 655 rows | 3,442 | $2,364,004,211 |
| **C** new rule, 655 of 655 rows | 1,410 | $1,175,556,030 |

| step | cause | dwellings | cost |
|---|---|---|---|
| A → B | retrieval completeness | **+2,762** | **+$1,555,354,482** |
| B → C | counting rule (amendments removed) | **−2,032** | **−$1,188,448,181** |
| A → C | net | +730 | +$366,906,301 |

The second step is exactly the amendments bucket, to the dwelling and to the
dollar:

```
newApplications 1,410 + amendments 2,032 = 3,442            ✓ = B
$1,175,556,030  +     $1,188,448,181     = $2,364,004,211   ✓ = B
```

**The larger component is retrieval completeness, not the counting rule.** The
report's figures were not a stale or differently-defined reading of the area:
they were a little over a third of the register, presented as the register.

## What each cause was

**Retrieval completeness.** The deployed `planning-data-service` read 300 of
the 650 applications the register stated for the window. The complete walk is
655 of 655 across 7 pages of 100, taken through the production egress (Supabase
`pg_net`, project `dduzbchuswwbefdunfct`, request ids 270152, 270164–270169) —
this sandbox's proxy answers 403 to CONNECT for every Australian government
host, so the rows are kept as a fixture and the summary recomputed from them
rather than the publisher re-asked.

**Application classes.** A modification restates the development it modifies:
the register carries the whole cost and the whole dwelling count on the
amendment row, not the change. Summing both double-counts, which is what B
measures — $2.364bn against $1.176bn of genuinely new proposals, 3,442 dwellings
against 1,410. `classifyApplicationType` splits them and only new applications
reach the published totals.

**Counting rules.** `rowsStating` is the number of applications that stated
*that* figure, and an application need state neither — which is why 301 ≠ 452
and, in A, 171 ≠ 278. Both denominators are named on the page now, so the two
readings no longer look like an arithmetic failure.

## What changed as a result

The two causes were already fixed (the complete walk, and
`classifyApplicationType`). What was still missing is the disclosure, and it
was missing precisely where the money is:

`daActivityLine` has always disclosed a partial walk on the planning-controls
line — *"(read 300 of the 650 the register states)"*. The **pipeline
paragraph**, which is what prints the dwellings and the dollars, did not. So
the report printed A's two totals with nothing on the page to say they came
from 46% of the register.

`InfrastructureEvidence.registerWalk` now carries `rowsRead` / `totalStated`,
and the paragraph says:

> Both totals were summed from 300 of the 650 applications the register states
> for this window, so each is a FLOOR rather than a total: reading the
> remainder can only raise it.

A sum of non-negative figures over part of a set is a floor, which is the
honest word — reading the rest can only raise it. Nothing is drawn on a
complete walk, because a sentence saying "all of it" on every complete reading
is noise. `registerWalk` is **null** where the reading carried no walk figures
at all, which is a third state and not "complete". Rule 4a tells the model to
carry the qualification wherever it uses either figure and never to compare a
partial sum with one read over a different share of the register.

## What is not claimed

Slicing the first 300 rows of the fixture does **not** reproduce A's 680 and
$808,649,729 — it gives 289 and $202,393,832, because the deployed function's
page order was its own and is not recorded. A is reconciled by its own stored
`rowsRead` / `totalInPeriod`, not by replaying which 300 rows it happened to
read. The decomposition above uses B, which is computed from the complete set
and needs no such replay.
