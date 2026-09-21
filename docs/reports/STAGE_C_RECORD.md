# Stage C — the release, and what is proven before it

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.
Stage A's record is [`STAGE_A_RECORD.md`](./STAGE_A_RECORD.md), Stage B's is
[`STAGE_B_RECORD.md`](./STAGE_B_RECORD.md).

Stage C is R1–R12 and the preservation checks, CI green on the final head, the
authorised merge / deploy / browser-publish gates, and fresh Annabelle and
Pallas journeys producing ten PDFs within the A$25 limit.

**Most of R1–R12 needs the deployed candidate.** `S5_ISOLATED_RUN_REQUEST.md`
defines them: R1 is generation end to end including resume, R2–R3 an edit read
back unchanged, R4–R5 template apply and change surviving a reload, R6–R7
preview against export, R8–R9 navigation and permissions. Every one of those
runs in the application against deployed edge functions. They are what the
merge and deploy unlock, and nothing here claims them.

**The preservation checks do not need it, and they are done.**

---

## 1. The read-path preservation check

The standard's rule is that a change to how a report is READ must preserve
*"verified facts, accepted financial inputs, material findings, user edits,
historical records"*, and that *"infrastructure evidence must not silently
change the financial model."*

Nothing on this branch writes to a report row, so the stored bytes are
trivially unchanged. The question that matters is what a **reader** now gets.
So the same read path was executed over the same **105 stored rows** at this
branch's head (`601bae591`) and at its merge base (`6d2a9c987`), in a worktree,
and the two captures diffed field by field.

`scripts/verify/read-path-preservation.mts` and its companion
`read-path-preservation-diff.mjs` are retained so this is re-runnable rather
than a claim. Every import in the capture is optional, because a module this
branch created does not exist at the base — which is what lets one file run at
both revisions.

```
rows compared: 105
prose byte-identical: 105 of 105
directives removed by the evidence contract: 831
loan structure sentences DERIVED (base had none): 104

unexpected differences: NONE
```

Compared on every row: the prose a client reads (hashed and line-counted), the
directives kept, and then **`capitalGrowth`, `cpiGrowth`, `occupancyWeeks`,
the whole `keyMetrics` object, the whole `initialCosts` object, the year-1 and
year-10 moderate projections, the template projection's entire `financials`
block, and every field of `loanDetails`** — `monthlyPayment`, `annualPayment`,
`totalInterest`, `interestRate`, `loanAmount`, `loanType` and `structure`.

Two differences are expected and are the work itself:

- **831 unsupported directives removed** across 105 documents, each returned on
  `findings` as the internal audit record rather than deleted silently.
- **104 loan structure sentences derived** where the base carried none — a
  disclosure added beside the figures, never a figure changed. The 105th row
  holds no loan block.

**Everything else is identical, including every figure named above.** The
accepted CGR is untouched on every row; so is every projection, every key
metric, every acquisition cost and every repayment.

### What the first run got wrong, and why it is worth recording

The first pass reported **99 of 105 documents with changed prose**, which would
have been a serious finding. It was my measurement, not the code: the prose
filter excluded `{{…}}` directive lines and not `::: stat …  :::` fences, so
the summary-strip removals (Stage B §3.1) counted as prose. A stat fence is a
label, a unit and a value — a card, not a sentence — and it is now excluded
with the directives, while every other fence kind (pull quote, sidenote,
divider, quote page) keeps its content in the comparison, so a change to one
would still show. Re-run: 105 of 105.

The rule that catches this class is the repository's own, and it is why the
check reports a hash rather than a verdict: **a preservation check that cannot
say what changed is not a preservation check.**

---

## 2. The seed regeneration — v15

Until the seeded catalogue is rebuilt, **no master change on this branch
reaches a deployment**: the masters are authored in `scripts/template-library/`
and the database reads a generated migration. The latest was **v14**
(`20261203000000`, written 18 Sep), which predates both of this branch's master
changes.

### The one-query check, answered

`buildSeedCatalogue.ts` carries its own rule in its header: *"if
`20261203000000` is already recorded, the next change needs a v15."* Editing an
already-applied seed in place is **inert** — the file changes, the database
does not, and the masters silently never ship. That is the exact silent-failure
shape this programme keeps finding, so it was checked rather than assumed.

The SQL tool is unavailable in this session and that restriction is not
bypassed. The applied-migration list is Management API metadata, not SQL
execution, and it is the same answer:

```
total applied migrations: 980
  20260918090000 (v11) applied: True
  20261112000000 (v12) applied: True
  20261202000000 (v13) applied: True
  20261203000000 (v14) applied: True
```

**v14 is recorded**, so this is **v15**
(`20261204000000_seed_template_library_v15_running_head_and_columns.sql`).
The asymmetry also favours it independently: the migration upserts on
`(slug, version)`, so a v15 is correct whether or not v14 had run, while
editing v14 is correct only if it had not.

### What it wrote

```
✓ 543 templates validated against the live schema
  43 voice, 50 Investment Compass, 50 Borrowing Capacity, 50 Portfolio
  Performance Review, 50 Property Comparison, 50 10 Year Cash Flow, 50 Client
  Details Form, 50 Cash Flow Comparison, 50 Report Q&A, 50 Commercial &
  Industrial Capacity, 50 Market Intelligence
  477 production-ready, 66 preview-only
  → 20261204020000_seed_template_library_v15_running_head_and_columns.sql (40,679 KB)
```

The master changes are in it, by count against v14:

| marker | v14 | v15 |
|---|---|---|
| `narrative.chapters` bindings (the running head names the chapter) | 0 | **880** |
| `As assessed` eyebrow (the `The report` heading block) | 44 | **0** |
| `"Permits"` column head (Commercial Capacity constraints table) | 50 | 50 |
| seeded rows | 544 | 544 |

The third change is the constraints table's column widths, which the QA gate
measured directly (`0 of 50 overlap, 0 of 400 rows wrap`) and which
`commercialCapacityCatalogue.spec.ts` fails on the old values — all three come
from one generation off one source tree, in one run.

### Two things the first attempt got wrong, both caught by a gate

**The version collided.** `20261204000000` is already carried by
`20261204000000_client_files_bucket_and_accrual_repair.sql`, and
`20261204010000` by `20261204010000_email_followup_reminders.sql`.
`check-migration-version-collisions.mjs` failed the `security` job and is right
about why: *one version records one ledger row, so the others can never be told
apart from applied.* The seed is **`20261204020000`**.

**And a seed alone is not the change.** The v14 refresh's own comment states
it: *"adopted masters are COPIES, and nothing else updates a copy after
adoption. A library seed alone changes what a NEW adoption gets and leaves
every document people already generate drawing the old page."* Seeding the
library without refreshing the active masters would have changed the running
head for a future adoption and left every existing report drawing
`Part 03 · Report` — the silent half-fix this programme keeps finding, in the
release step itself.

So **`20261204030000_refresh_active_masters_from_library_v15.sql`** follows it,
with the mechanics of the v13 and v14 refreshes unchanged: the entry's current
schema with **this row's own token colours carried forward** (the colourway
bake is exactly that merge, so no palette is invented), `entryVersion` advanced
so the picker keeps recognising the copy, and rows with no library lineage,
inactive drafts and rows the library no longer lists left untouched.
Idempotent.

Re-run: `check-migration-version-collisions.mjs` **passes** (997 files, 32
frozen collisions over 77 files, **0 new**), `check-migration-security.mjs`
passes (96 migrations at or after 20260909000000), gate wiring and gate-env
wiring pass.

`npm run templates:library:verify`: **30 files, 2,869 tests passed.**
`npx tsc --noEmit` clean.

**Nothing is deployed by this commit.** A seed migration reaches the database
through `apply-migration.yml` on a merged file, and the merge is itself a gate
that is not mine to open.

---

## 3. How the served build can be verified, and which half cannot

Stage C asks for the served build to be **verified rather than inferred from
Lovable's latest edit**. That is worth settling before the deploy rather than
after, because half of it cannot be done from here — and finding that out
afterwards is how a gate becomes a formality.

Measured 19 Sep 2026 from the production egress, read-only GETs, no
credentials:

| origin | answer |
|---|---|
| `https://npc-property-dashbord.lovable.app` | **302** → `https://command-centre.npcservices.com.au/` |
| `https://command-centre.npcservices.com.au` | **403**, Cloudflare managed challenge (`Just a moment…`, 5,402 bytes) |
| `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/render-template-pdf` | **405** — the function's own answer |
| `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/generate-investment-report` | **400** — the function's own answer |

This refines what Stage A recorded. That record said *"401 at both Lovable
origins"*; the Lovable origin now **redirects to the custom domain**, so there
are not two independent refusals — there is one WAF and one answer. The
conclusion is unchanged and now rests on a measurement of both paths.

So the verification splits:

| what this branch changed | where it runs | verifiable from here after the deploy |
|---|---|---|
| the read-path rules, the evidence contract, the loan structure sentence, the fork classifier — everything in `supabase/functions/_shared/` | edge functions | **Yes.** The origin answers this egress with the functions' own 405/400, so a deployed change can be proven by production effect, unauthenticated, as this programme has done before. |
| the seeded masters (v15) and the PDF outline in `src/lib/reportTemplate/` | the browser bundle | **No.** Behind the challenge above. Fetching the bundle and grepping for a marker only the new code carries is the usual method and it is unavailable. |

**One human action, named once and unchanged:** open
`command-centre.npcservices.com.au` signed in to the tenant, or the Lovable
editor, and confirm the last **publish** — not the last edit. Nothing here
substitutes for it, and no substitute would be sound.

---

## 4. What Stage C still owes

1. **CI green on the final head** — the PR is watched and each push has
   reported a clean check suite; the final head's suite is what the merge gate
   reads. The head is now `b61c454f7`, on `main` at `066ed9f98`. §5.6 records
   what was re-run there and what it answered.
2. **The authorised merge, deploy and browser-publish gates**, and the served
   build verified by fetching it rather than inferred from Lovable's latest
   edit.
3. **R1–R12 in the application**, which the deploy unlocks.
4. **The fresh Annabelle and Pallas journeys** — ten PDFs, real generations,
   within A$25 (**A$0.00 spent**). They are also what settle the two questions
   Stage B named and deliberately did not turn into rules: whether a retrieved
   growth reading can disagree with the accepted CGR unnoticed, and whether
   condensation can introduce a claim its parent did not make.

---

## 5. The closing pass — four evidence gaps, each measured first

Four gaps were named after Stage C's first record was written. Each was
measured before anything was written, and two of the four measurements changed
what got built.

### 5.1 Planning and infrastructure acquisition

The corpus said what Stage A's diagnosis had not:

```
rows in .verify/fixtures                            105
rows carrying a coordinate on location_intelligence   5
rows carrying a planning key in data_sources          0
```

Stage A found the first fault — no coordinate, so the guard was false. The
second is that **the five rows that DO carry a coordinate also have no planning
key**. `23 MACKAY Street, Moranbah QLD 4744` was generated 2026-09-08, two days
after `planning-data-service` went live; its `location_intelligence` column
holds `{lat: -22.006014, lng: 148.0590271}` and its `enhanced_data` is `{}`.

The guard reads the in-memory working object. Every Compass is finished by the
resume worker, which starts `enhancedData` empty and calls back with
`{reportId, propertyAddress, continueFrom}`; `assessEnrichmentReuse` correctly
refuses to reuse an enrichment that cannot prove it describes this subject; and
when the live enrichment then fails, four producers go quiet at once. That is
`rawPropertyType`'s defect on the coordinate, and recording the skip — which
Stage A added — is an honest account of a report that still has no planning
content in it.

`planningCoordinate.pure.ts` resolves a coordinate and then **qualifies** it.
Only a match at the address may select a planning control, because a control is
an attribute of the parcel: a street point may sit on the road reserve or the
neighbour's lot, and a suburb centroid is a different property. `locality` is
acceptable to `assessGeocodeGranularity` for a map pin and is refused here,
which is `crimePostcodeAuthority`'s rule in another register.

The published-project register had the same shape one level on, and worse: its
empty result rendered the empty STRING and told the model *"no major public
project near this property is recorded in this platform's register"* — a
sentence asserting a search happened, returned identically on all 105 rows
where no search was possible.

### 5.2 Evidence-bounded content

Two absolutes in `landUsePermissibility.pure.ts`, both corrections of
substance rather than tone, and both recorded in §3.11's companion in the
Stage B record. The sentence carries its instrument and its retrieval date
now, and `EXISTING_DWELLING_CAVEAT` keeps the use class apart from this
building's own approval.

**A blanket table rule was measured and refused**, which is the more useful
finding. Across the 12 distinct documents in the corpus, 316 of 620 table rows
carry a figure and **269 of those — 85.1% — name no basis within four lines**,
because they are the acquisition-cost and annual-cost tables whose every figure
comes from the record's own calculation. A rule firing on 85% of a document
teaches people to dismiss it, which is the hazard
`FIGURE_KINDS_NEEDING_A_BASIS` already names in its own comment. What was
actually missing was smaller: the claim rules' preamble enumerated prose,
captions, summary strips and tables, and omitted the two formats a removed
chart most naturally becomes — a `::: stat :::` card and a timeline stop.

### 5.3 Template migration — preservation, not recoverability

**This section was wrong on its first pass and is corrected here.** It reported
that the refresh replaces an adopted row's whole schema keeping only
`tokens.colors`, called that deliberate because v13 and v14 did the same, and
offered a snapshot as the remedy. Precedent is not authorisation, and a
snapshot makes destruction *undoable* — it does not *preserve* anything. A
tenant whose typeface, page, block, binding or branding is overwritten has lost
it until somebody notices and restores it.

§1 measures what a **reader** of a stored report gets at two revisions. It
touches no template and cannot answer what a migration does. The two are kept
apart deliberately.

**What v15 does now.** It changes a master only where it can PROVE the master
is an unedited copy of what the library last published.

The proof had to be built, because nothing retained the baseline. The seed is
`ON CONFLICT (slug, version)` with `version` = 1 on every entry, so there is one
row per slug, `schema` is overwritten in place, and no history table exists —
the previous release's bytes are gone the moment the seed runs. So the seed
captures a digest of every entry's schema immediately BEFORE it upserts,
emitted by `buildSeedCatalogue.ts` rather than hand-written into a generated
file.

`tokens.colors` is the only path excluded from that digest. That is not a
convenience: `applyColourwayToSchema` spreads `...tokens` and replaces `colors`
alone, so excluding exactly that path accounts for a supported colourway
difference precisely and leaves a tenant typeface under `tokens.fonts` fully
visible. **Library lineage is never taken as evidence of an unedited copy.**

| verdict | what it means | what happens |
|---|---|---|
| `already_current` | the row already matches the new entry | nothing; this is what a second application sees, and it is why re-running cannot mislabel a row it already refreshed |
| `refreshed` | proven unedited against the baseline | replaced, palette carried forward, `releaseApplied` stamped |
| `deferred_customised` | a baseline exists and the row does not match it | **untouched**, recorded for review |
| `deferred_no_baseline` | no baseline captured for this entry | **untouched**, recorded for review |

A deferred row keeps its schema, its config and its lineage, and **nothing marks
it as carrying this release.** `releaseApplied` is written only where the
release was actually applied — `entryVersion` is 1 on every entry and never
tracked a seed release at all, which the first pass of this record got wrong.

**What is deliberately not attempted.** No attempt is made to graft v15 into a
customised master. The release alters a running-head binding, a section
heading, a table's column widths and a Contents-page block; applying those
surgically to an arbitrary edited schema cannot be shown to preserve that
tenant's layout, so the smallest correct action on an unproven row is to leave
it and say so.

**What the rollout will actually reach, and the limit on saying so.** The v14
refresh itself normalised every active adopted row to the v14 entry's schema
with the row's palette — so any row not edited *since* that refresh hashes to
the baseline and is refreshed automatically. Only rows edited in the Template
Builder since then defer. That is the mechanism by which this is a real rollout
rather than a blanket skip.

The **counts**, however, cannot be stated from here: the production inventory
is not queryable in this session, so how many masters are eligible and how many
deferred is not known and is not guessed. The migration records it by effect —
`template_master_refresh_decisions` holds one row per active adopted master
with its verdict and what differed — and the queries to read it are in the
migration's own comment. That is the same rule the retention purge and the
verification self-test already answer to: **asserted by effect, never by
configuration.**

**The Annabelle and Pallas acceptance masters** are ordinary adopted library
copies. Unedited since v14 they are refreshed automatically with everything
else; edited, they defer and are named in the decisions table, and the safe
upgrade path is to re-adopt from the library — a deliberate act with the edit
in view — rather than to have it silently overwritten.

**Proved by execution** in a throwaway PostgreSQL, six rows covering every
branch, **33 assertions** in
`scripts/verify/template-refresh-preservation.sh`: a plain adoption takes the
release and keeps its palette; a master customised beyond colours keeps its
typeface, branding, extra page and own binding and is byte-identical to its
snapshot; a row whose baseline was never captured is untouched; a row already
at v15 is `already_current` rather than falsely deferred; rows with no lineage
and inactive drafts are neither touched nor classified; only the refreshed row
claims the release; a second application changes nothing and the first
snapshot survives; and restoring one row leaves every other alone. The seed's
own baseline capture is run verbatim out of the generated migration rather
than restated.

The snapshot stays, as additional protection rather than as the answer, now
one row per template per release so a re-application cannot overwrite the
original.

### 5.3a The superseded reading, kept because it was published

The first version of this section said the destructive refresh was
"deliberate — a master fix has to reach the copies people generate from" and
presented the snapshot as the safety. Both halves of that were reported on the
PR and are retained here rather than quietly rewritten: the first is a
description of v13 and v14 rather than a justification, and the second answers
a different question from the one that was asked.

### 5.4 The two questions that were open

Both were named in the Stage B record and deliberately not made rules, because
the corpus held no case to test either against. Waiting was the wrong call: a
**clearly labelled synthetic fixture** is how a rule gets a positive and a
negative case before the first real document needs it. A fixture is not a
property acceptance and is not offered as one.

`growthDivergenceRule` discloses a retrieved growth reading that disagrees with
the accepted CGR and reconciles neither, because they are different quantities
and replacing one with the other silently changes a client's financial model.
It is silent where they agree or either is absent.

`condense-investment-report` is handed `claimSupportRules` built from the
**parent's** `data_sources`. It had zero occurrences of it before, so a rule
tightened for the generator reached the parent and not the child.

### 5.5 The read path, re-measured at this head

```
rows compared:                                      107
prose byte-identical:                        107 of 107
directives removed by the evidence contract:        847
loan structure sentences DERIVED (base had none):   106
unexpected differences:                            NONE
```

The row count moved from 105 to 107 because the fixture set grew by two between
the first run and this one; the earlier figures were 105 / 831 / 104. **This is
a field-by-field comparison over a named set, not a universal byte-for-byte
claim** — the two differences are the work itself and are named rather than
filtered away.

### 5.6 The release candidate — which revisions the evidence covers

The release candidate is head **`b61c454f7`** on `main` at **`066ed9f98`**,
which is the merge base: the branch fully contains that main and
`git merge-tree --write-tree` exits 0 against it.

The gate table below is measured **at that head**. Any commit after it on this
branch is documentation only — this record and the PR body — so the final head
differs from the gate-measured head in Markdown alone, and CI runs the full
suite on the final head regardless. §5.5's 107-row read-path
comparison was run earlier, at `c43ced016`, and is not restated here: the
commits between the two change `supabase/migration-object-index.json`, one RLS
migration, `CLAUDE.md` and two builder-stock modules, and the comparison reads
none of them. That is a checkable statement about a diff, not an assumption
that nothing moved.

`main` moved three times while this pass ran (`6d2a9c987` → `19237d6f9` →
`421e1f7a3` → `066ed9f98`) and each was merged in rather than left to the merge
button. The second of those conflicted, in exactly one file —
`supabase/migration-object-index.json`, which is **generated**. It was resolved
by running `npm run migrations:index`, never by hand, and the regenerated file
passes its own `--check`.

**A clean merge is the absence of a conflict, not tested integration**, so the
gates were re-run in full on the merged head rather than carried forward:

| gate | at `b61c454f7` |
|---|---|
| `npx vitest run src/lib` | **1,078 files passed**, 4 skipped; **22,112 tests passed**, 25 skipped |
| Deno edge type-check | **413 entry points, 334 errors, baseline 334** — held |
| `npm run templates:compass:qa` | **510 renders in real Chromium** — no block overflows its page, none prints over another |
| `scripts/verify/template-refresh-preservation.sh` | 6 rows, **33 assertions, all passed** |
| migration object index | current — **998 migrations, 2,721 created, 524 dropped** |
| migration version collisions | passed (998 files; 32 frozen, **0 new**) |
| migration dependency order | passed (998 migrations; 33 frozen, **0 new**) |
| migration security | passed (97 at or after 20260909000000; 20 reviewed exemptions) |
| `check-edge-column-names` | passed |
| `check-verify-jwt-declared` | **413 of 413 declared, 0 missing** |
| `npx tsc --noEmit` | clean |
| `npm run audit:style` | under baseline |
| `npm run build` | succeeds |

**One earlier claim on the PR is corrected here.** It said "ESLint 0 errors".
ESLint is not a CI gate in `ci.yml` at all, and the repository carries **46
errors across 32 files** at this head. **None of them is in any of the files
this branch touches** — checked by intersecting the ESLint JSON report against
`git diff --name-only <merge-base>..HEAD`, which is empty. The accurate
statement is the narrow one, and it is the one that should have been made.

---

## 6. The clarified product scope, and the verified report inventory

Recorded 19 Sep 2026, from the owner's scope clarification. This section records
a boundary; it changes no code and authorises no new engineering.

### 6.1 The inventory is 13 formats, and the five are TIERS of one of them

Counted from `REPORT_TEMPLATE_ADAPTERS` in
`src/lib/reportTemplate/adapters/index.ts`, which is the authority —
`listReportFormats()` derives from it rather than listing formats again, so
"formats you can choose a template for" and "formats that have an adapter" are
the same set by construction.

**Thirteen entries: nine production adapters and four preview-only.**

| # | format key | label | production adapter |
|---|---|---|---|
| 1 | `investment` | Investment Report | yes |
| 2 | `borrowing_capacity` | Borrowing Capacity | yes |
| 3 | `portfolio` | Portfolio Analysis | yes |
| 4 | `comparison` | Comparison Report | yes |
| 5 | `cashflow` | Cash Flow Analysis | yes |
| 6 | `client_details` | Client Details | yes |
| 7 | `qa` | Report Q&A | yes |
| 8 | `commercial_capacity` | Commercial & Industrial Capacity | yes |
| 9 | `market_intelligence` | Market Intelligence | yes |
| 10 | `cash_flow_comparison` | Cash Flow Comparison | **preview only** |
| 11 | `suburb` | Suburb Analysis | **preview only** |
| 12 | `postcode` | Postcode Analysis | **preview only** |
| 13 | `statewide` | Statewide Analysis | **preview only** |

**The correction that matters for scoping.** Compass, Financial, Strategic,
Briefing and Snapshot are **not five formats**. They are the five `ReportTier`
values of the single `investment` format (`REPORT_TIERS` in
`sectionRegistry.pure.ts`; `tierContent.pure.ts` keys `compass`, `financial`,
`strategic`, `briefing`, `snapshot`). So the engine and content work in this PR
lands on **one of thirteen formats**, across its five purposes — and the
presentation-only work ahead covers **eight other production formats**, not
nine and not fourteen.

The four preview-only formats are outside the presentation phase too, and for a
reason that is not a backlog item: they have no production adapter, so nothing
generated routes through a template at all. `cash_flow_comparison` states its
own cause — no comparison is persisted anywhere a template can read.

### 6.2 What this PR's engine and content work applies to

**The `investment` format only, across its five tiers.** These are
property/opportunity assessments, not personalised client-suitability reports.
They are produced by the EXISTING generation workflow and its Property,
Financials, Income and Advanced inputs. No client-intake requirement is added
and the workflow is not redesigned.

Submitted and accepted assumptions, existing calculations and report ownership
stand as they are. What the engine work has to keep true is that a **user
assumption**, an **estimate**, a **calculation** and a **sourced fact** remain
distinguishable end to end — which is what the acquisition ledger's five
outcomes, the qualified subject coordinate, the instrument-and-date anchoring
and the claim rules each exist to hold.

**Removing unsupported content is necessary and is not sufficient.** Nothing in
this PR may be read as demonstrating substantive completeness: that is an
acceptance finding taken from real documents, and it is owed by the fresh
Annabelle and Pallas journeys, not by a gate.

### 6.3 What the other eight production formats get, and what they must not get

Presentation only: complete content mapping into the selected template,
professional formatting, pagination, readable tables and charts, preserved user
edits, and faithful preview/export parity. Their **engines, prompts,
calculations and accepted generated responses are preserved**. Content is not
rewritten or shortened to fit a template — a template that cannot carry the
report is composed or the body is paged, which is the rule
`templateComposition.pure.ts` and `packMarkdownPages` already hold.

This is a **bounded subsequent phase**, not an expansion of this PR. Its scope
is those eight formats and nothing else.

### 6.4 A deferred master is preserved, never upgraded

For acceptance: a master the v15 refresh classifies `deferred_customised` or
`deferred_no_baseline` is left exactly as it was and carries no
`releaseApplied` stamp. It must therefore **not be counted as having received
the new presentation.** `template_master_refresh_decisions` is what says which
a given master got, and the reading queries are in the migration's own comment.

---

## 7. The release, executed — and the one defect it found

### 7.1 The merge, and the compatibility question answered before it

PR #2700 merged at head `b221c8958` into `35c6468f7`, producing merge commit
**`1dd8e1ce7`** (parent 1 `35c6468f7`, so `git revert -m 1 1dd8e1ce7` is the
rollback). `b61c454f7..b221c8958` is documentation only — one file,
`STAGE_C_RECORD.md`, +139/−1 — so the full local gate table recorded in §5.6
covers the merged code unchanged. CI 7019, PDF Import Release Gate 3415 and PDF
Import Regression 1172 were green on `b221c8958`; `git merge-tree` exit 0
against main.

**The release window asked one real question:** merging deploys the edge
functions immediately, while the migrations wait for a dispatch, so for a period
production runs new code against a pre-migration template state. Two things were
checked rather than assumed.

1. **Do the deployed functions read the three tables the migrations create?**
   `template_library_release_baselines`, `template_master_refresh_decisions` and
   `report_template_refresh_snapshots` have **zero readers** anywhere in
   `supabase/functions/` or `src/`. They appear only in the two migrations, the
   generated object index, `buildSeedCatalogue.ts`, the verification harness and
   this documentation.
2. **Does the new code require a v15 master?** The only projection change is
   additive: `reportBindingProjection.pure.ts` is +24/−4, `narrative.pages` is
   still published and `narrative.chapters.*` is new. A v14 master binds a strict
   subset, so it renders exactly as before.

So there is no incompatibility in that direction. **The reverse direction is
real and decides the order**, which is why the two migrations are separate and
why this is worth writing down: v15 masters bind `{{narrative.chapters.N}}` in
their running-head furniture (`investmentCompass/templates.ts`), and only the
newly deployed projection publishes `chapters`. An unresolved binding renders as
the empty string, so a v15 master refreshed onto masters served by pre-merge code
would print a blank running head on every page.

That constrains only the **second** migration. The seed writes
`template_library_entries` and `template_library_release_baselines` and **never
`report_templates`** — it cannot change a rendered document — so it is safe at
any point. The refresh is what moves an active master, and it must follow a green
function deploy.

### 7.2 The v15 seed could not be applied, and why

`apply-migration.yml` run **#66** (19 Sep 2026, 11:11Z) **failed, having applied
nothing:**

```
… v15_running_head_and_columns.sql: 39.77 MB, 5540 lines
Large file, but not the recognised INSERT shape — sending whole.
public.template_library_release_baselines rows before: (relation absent)
##[error]HTTP 413 — {"message":"request entity too large"}
```

This deployment has no `SUPABASE_DB_URL`, so the workflow takes the Management
API route, where a 39.77 MB file has to be chunked. The chunker recognises the
seed shape by finding a line that is exactly `VALUES` and a line starting with
`ON CONFLICT ` **after** it. v15 is the first release to put a statement of its
own *above* the catalogue insert — the pre-upsert baseline capture, which exists
because the upsert overwrites `schema` in place and nothing else retains what it
held. Its terminator is `ON CONFLICT (entry_id, release) DO NOTHING;` on line
**66**; `VALUES` is on line **78**. `conflictAt > valuesAt` was therefore false,
the file was sent whole, and the API refused it.

The failure is clean in both senses that matter: the baselines relation was still
absent when the job died, so the `CREATE TABLE` never ran; and `record_version`
runs after the apply loop, so `schema_migrations` is untouched. Nothing is
half-applied.

**The correction is one expression** in `.github/scripts/apply-migration.mjs`:
find the `ON CONFLICT` that *terminates the seeded INSERT* — the first one at or
after its own `VALUES` — instead of the first one in the file. The migration
files are untouched.

Verified the way that script's own header says the chunker is meant to be
verified, by a dry run against the real file rather than a fixture that can
drift:

```
Parsed 543 tuples; reassembly byte-identical and every dollar-quote balanced.
56 statements; largest 1.16 MB
```

543 is the catalogue's own declared count. The chunk composition was then read
directly: every chunk carries lines 1–78 as its header, which is the baselines
`CREATE TABLE`/`COMMENT`/`ALTER`, **the baseline-capture INSERT**, and the
catalogue INSERT's column list. That is correct and not merely tolerable — the
first chunk captures the complete pre-upsert baseline for every entry before any
tuple in that same request is applied, and every later chunk's copy is a no-op
under `ON CONFLICT (entry_id, release) DO NOTHING`. The terminating clause is the
catalogue's own `ON CONFLICT (slug, version) DO UPDATE SET` (lines 5509–5530),
and the trailing `UPDATE … SET status = 'published'` is sent once, after all 55
row chunks.

### 7.3 The deployment, verified by effect rather than by a green tick

Run **638** succeeded on `1dd8e1ce7` — the Deploy step 11:00:37→11:15:46Z, then
`verified 342 function(s)` against the CORS contract. `_shared/` changed, so the
workflow deploys **every** function; the platform was then read back:

| function | version | updated | carries |
|---|---|---|---|
| `condense-investment-report` | 406 `ACTIVE` | **11:03:55Z** | `runningChapters`, `NARRATIVE_CHAPTER_SLOTS`, `drawsFinancialModelling` |
| `planning-data-service` | 317 `ACTIVE` | **11:12:52Z** | `landUsePermissibility`, `planningControlGuide` |
| `render-template-pdf` | 405 `ACTIVE` | 16 Sep | — |
| `custom-auth-login-v2` | 386 `ACTIVE` | 7 Sep | — |

The two stale stamps are correct and not a gap. Each function's import graph was
walked against the 24 `_shared` files this release changed: `render-template-pdf`
has **0 of 18** and `custom-auth-login-v2` **0 of 15**, so their bundles are
unchanged and the platform had no new version to make. The ones that did change
— `generate-investment-report` (14 of 113), `condense-investment-report` (14 of
49), `fork-investment-report` (12 of 56), `render-investment-report-pdf` (8 of
31), `planning-data-service` (3 of 22) — carry today's stamps. **A deployment is
asserted by the identifiers in the served bundle, never by the workflow's
conclusion.**

### 7.4 What the chunked path does, proven before it was pointed at production

The API route sends the seed as 56 separate statements in 56 separate
transactions, and the preservation harness has never applied the catalogue
INSERT at all — it extracts the baseline-capture statement with `sed` and builds
its own fixture entries. So the path that was about to run had never been
exercised. It was, twice over.

**Locally**, the real 39.77 MB file was applied to two throwaway databases, one
whole and one chunked. Entry count, published count and a digest over every
entry's schema are **identical**. The baseline tables differed — 2 against 540 —
because in the chunked run an entry that did **not exist beforehand** is captured
by a later chunk, after its own insert. Both databases agreed on what matters:
the pre-existing entries hold their **pre-upsert** digest, and it differs from
the post-upsert schema.

**Whether that difference can arise here** is answered by the v14 apply's own
log (run #64, 17 Sep): `template_library_entries: 543 → 543 rows`, 56 statements.
Production already holds all 543 slugs and v15 carries the same 543 tuples, so
every entry v15 upserts already exists, chunk 1 captures them all before any
upsert, and every later chunk's copy is a no-op. Two further things that log
settles: the chunked 56-statement path is the **established** production path, so
§7.2's fix restores it rather than inventing one; and the `finance` category —
which a bare schema rejects until `20260813054545` widens the CHECK — applied
cleanly under an identical vocabulary.

### 7.5 The two migrations, applied

| | run | result |
|---|---|---|
| `20261204020000` v15 seed | **#67**, 11:29–11:34Z | success — 56 statements; `template_library_release_baselines`: **absent → 543 rows**; recorded in `schema_migrations` |
| `20261204030000` active-master refresh | **#68**, 11:37Z | success — **1 statement, whole file**; `template_master_refresh_decisions`: **absent → 16 rows**; recorded in `schema_migrations` |

543 baselines is the whole catalogue, which is what the refresh's proof of
"unedited" needs. The refresh went as **one** statement because it is 10,658
bytes, under the applier's 1,000,000-byte split threshold — which is what keeps
its session-scoped `_v15_classified` alive across the classification and the
three statements that read it.

**Sixteen active adopted masters were classified.** Two things can be said about
the split from the logged numbers alone, and the rest cannot:

- **`deferred_no_baseline` is necessarily 0.** The classification joins only
  entries with `status = 'published'` and a non-null `schema`, and the seed
  captured a baseline for **every** entry with a non-null schema (543 of 543).
  No classified row can therefore lack one.
- **The `already_current` / `refreshed` / `deferred_customised` split is not in
  any log** — the applier reports before/after row counts, not a group-by. It is
  recorded here as **PENDING**, obtainable by the query in the refresh
  migration's own footer comment. It was deliberately **not** obtained through
  `query_database` or any other direct-SQL route.

A deferred master carries no `releaseApplied` stamp and must not be counted as
having received v15 (§6.4).
