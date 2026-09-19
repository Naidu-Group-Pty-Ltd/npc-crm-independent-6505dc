# What is actually in production, and what is only in the draft

Read-only. Nothing here changed anything.

The question this answers is not "what did we merge" but **"what are customers
running"**, and the two are different in three independent ways on this
repository: edge functions ship on a merge, the frontend ships on a Lovable
publish, and active templates change only when a migration is dispatched.
Each is established below by its own evidence.

---

## 1 · The earlier merge — PR #2691

**Merge commit `1d71a80`**, 17 Sep 2026 18:37:22 +1000 (08:37:22Z), merging
`claude/adoring-hopper-g02tdt` into `main`. It is the parent of everything in
the current draft: the draft's merge base IS that commit.

What it carried: 11 modules under `supabase/functions/_shared/`, four function
directories (`condense-investment-report`, `generate-investment-report`,
`planning-data-service`, `render-investment-report-pdf`), **5 non-test
frontend modules** and the S1–S4 documentation.

### It triggered a deploy, and the deploy ran

`Deploy Supabase functions` run **35200664157**, `push`, **success**. The
steps matter more than the conclusion, because this workflow's own header
records it reporting green while shipping nothing:

| step | outcome |
| --- | --- |
| 3 Work out which functions changed | success |
| 4 Check for a deploy credential | success |
| 6 Report that Mission Control deploys this project | **skipped** |
| 7 Fail when there is something to deploy and no credential | **skipped** |
| 9 **Deploy** | **success** |
| 10 Verify the deployed CORS contract | success |

Steps 6 and 7 are the stand-down branches. Both skipped, and step 9 ran. This
deploy sent something.

### And it reached production — measured, not inferred

`_shared/` changed, so the workflow's rule is *"shared code changed —
deploying every function"*: it asked for all **423**. What CHANGED is
smaller, and that is the number that matters:

| function | version | deployed |
| --- | ---: | --- |
| compare-investment-reports | 357 | 2026-09-17 08:40:24Z |
| condense-investment-report | 367 | 2026-09-17 08:40:27Z |
| fork-investment-report | 355 | 2026-09-17 08:43:01Z |
| generate-investment-report | 374 | 2026-09-17 08:43:17Z |
| planning-data-service | 278 | 2026-09-17 08:48:06Z |
| render-investment-report-pdf | 346 | 2026-09-17 08:48:44Z |
| render-template-pdf | 368 | 2026-09-**16** 05:41:49Z |

**24 of 423 functions carry a 17 Sep version**; the six report-pipeline
functions are all among them, stamped in the eleven minutes after the merge.
`render-template-pdf` is still on its 16 Sep version, which is the same
evidence read the other way: a function whose bundle did not change did not
get a new version even though the deploy asked for it.

So the practical blast radius of an "all functions" deploy is *every function
is re-uploaded; only changed code is re-versioned.* **This has already
happened once, successfully** — it is not a hazard the draft PR introduces.

### Two migrations were applied at the same time

Dispatched manually at 08:37 and 08:43, both **success**:

* `20261203000000_seed_template_library_v14_tier_separation`
* `20261203010000_refresh_active_masters_from_library_v14`

That is seed **v14** plus the active-master refresh — the tier-separation
work. It is why the template register moved that morning.

### The frontend was published

The Lovable project reports `is_published: true`, `publish_audience: public`,
`last_edited_at` **2026-09-17T08:37:52Z** — 27 seconds after the merge — and
`latest_commit_sha` **`1d71a8070ba4613aefcca242d6331a5e36926ac1`**, which is
the merge commit exactly.

**Read this precisely.** That is a source-sync record and a publish flag. It
establishes that the project's source is the merge commit and that the project
is published; it does not, on its own, prove the bytes a browser downloads
were rebuilt from it. Confirming the served bundle means fetching it, and
`*.lovable.app` is refused by this sandbox's egress proxy (`CONNECT` 403). See
§4.

---

## 2 · Active templates

17 rows are `is_active`. All `engine: weasyprint`, all `approval_status:
approved`, none `is_draft`, all `version: 1` — so the integer version
discriminates nothing and the **schema hash is the identity**.

**16 of 17 were updated 2026-09-17 08:43**, which is the active-master
refresh above. The exception is *First-Home Buyer Report* (15 Sep 10:24).

**Seven are user-owned** (`owner_user_id` set) and are the customisations the
release must preserve:

| template | report type | owner |
| --- | --- | --- |
| Architectural Property — Datum · Limewash | borrowing_capacity | user |
| Corporate Advisory — Board Pack Brief | cashflow | user |
| Institutional Research — Exhibit Dense · Rust Console | client_details | user |
| First-Home Buyer Report | investment | user |
| Luxury Editorial — Frontispiece · Midnight Editorial | investment_compass | user |
| Data / Analyst — Dictionary | investment_compass | user |
| Luxury Editorial — Atelier | qa | user |

The Chancery rows for `investment` and `investment_compass` share one schema
hash (`ebf3b04579200bc2`) — one design, two report types.

---

## 3 · What is exclusive to the draft PR #2692

**38 commits, none deployed, none published.** Against current `main`:

| | |
| --- | --- |
| non-test frontend modules | **22** — the whole template-rendering surface: 15 `blocks/*`, `htmlRenderer`, `narrativeIndex`, `markdownBlockContent`, the QA validator, `assessmentReadings` |
| shared edge modules | 17 under `_shared/` |
| function handlers | 5 |
| migrations | **0** |
| template masters changed | **0** |

Two consequences for S6. Merging alone ships the **server** half and nothing
else — the 22 frontend modules are what draw the documents, and they reach
customers only on a Lovable publish. And because `_shared/` moves again, the
merge will again ask for all 423 functions and re-version only what changed.

### The diff was reviewed semantically, not by path

A path inside `src/lib/reports/` does not make a hunk part of this programme.
Every file whose purpose was not self-evident was read:

| file | what the hunk actually does | on programme |
| --- | --- | --- |
| `transportReading.pure.ts` | `stopsWithinRadius` — a count whose name stops contradicting the radius beside it | yes (S1/S3 chip) |
| `scoringInputPolicy.pure.ts` | splits "no location readings reached this assessment" from "readings could not be matched to this property" | yes (S2) |
| `scoringV2Production.pure.ts` | uses that second sentence where the cause differs | yes (S2) |
| `planning-data-service/index.ts` | cache key carries the answer-shape version | yes (S4) |
| `compare-investment-reports/index.ts` | withholds the disowned walk score, and stops the prompt naming it | yes (S2) |

No hunk outside the report programme was found. No migration. No master.

---

## 4 · What this audit could NOT establish from here

Both are egress limits of this sandbox, not unknowns about production, and
both have a named remedy.

1. **The deploy job's own log.** GitHub serves it from
   `productionresultssa14.blob.core.windows.net`, which the proxy refuses
   (`connect_rejected`). So the *list* of functions the deploy sent is not
   read directly — it is inferred from the workflow's rule plus the measured
   24 re-versioned functions. Remedy: read run 35200664157's log from a
   machine with open egress.
2. **The served frontend bundle.** `*.lovable.app` is refused the same way,
   so the published JavaScript was not fetched and searched for a marker.
   What is established is the publish record and the source-sync commit.
   Remedy: fetch the bundle, or confirm through the product.

**Pre-existing and unrelated:** `pdf-extraction-v3-gates` is failing on
`main` on its schedule (run 35261475262, 17 Sep 18:52Z). It is not caused by
this branch and is not fixed by it.
