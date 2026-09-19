# Commercial & Industrial Capacity Report — the format's contract

The document a commercial or industrial borrower is handed when they ask *"how
much can I borrow against this asset?"*. It is the ninth format on the report
design system, and the first whose analysis is written by a model.

Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the programme and
[`BORROWING_CAPACITY.md`](./BORROWING_CAPACITY.md) for the residential Snapshot
this format is modelled on. Most of what is *not* explained here is explained
there, because most of it was decided there.

---

## 1. Why it is a separate format

The Snapshot and this document answer different questions, and the difference is
structural rather than cosmetic.

A household is bound by its **surplus**: income, less expenses, less
commitments, and the remainder services a loan. The Snapshot is that arithmetic,
told in order, and a reader goes through it.

A commercial facility is bound by whichever of **eight independent tests** bites
first — loan to value, loan to cost, debt service cover, interest cover, debt
yield, the available borrower contribution, global servicing surplus and the
lender's policy ceiling. The whole point of the document is *which one*, and by
how much. There is no borrowing-capacity section that could carry a
binding-constraint table without becoming this.

That difference shows up in three places:

| | Snapshot | This |
|---|---|---|
| Archetype | `borrowing-capacity`, 4–12pp, no contents | `commercial-capacity`, 6–30pp, **contents** |
| Headline | A capacity and a band | A capacity, **and the test that set it** |
| Analysis | None | Model-authored, one section of nine |

The contents page is the visible half of it. This is a credit pack a reader
arrives at wanting the constraints table, or the tenancy schedule — not one
argument told in order.

---

## 2. Where the numbers come from

**From the stored calculation run. Never from a recomputation.**

The C&I engine is `src/lib/ciAssessment/` — browser-side TypeScript behind the
`@/` alias, which an Edge Function cannot load. Porting it so the report could
recompute at render time was the alternative, and it is worse for the reason
`BORROWING_CAPACITY.md` §9 records about that format's audit trail: a
recomputation runs against **today's** policy, so a report re-issued after a
policy change would silently disagree with the figures the client was given last
month. A report must explain the numbers it is showing, not different ones.

`commercial_industrial_calculation_runs` stores the complete `AssessmentResult`
of every run, immutably, with the engine and policy versions it was produced
under. `normalise.pure.ts` reads it and computes nothing except cents-to-dollars
and prose.

### The cents trap

The engine works in **integer cents** and publishes `summary` in **whole
dollars**. The same quantity is in the row twice, scaled by a hundred. The two
readers are named differently — `dollars(x.someCents)` and a bare
`summary.someField` — and nothing in the payload is a bare number, so a
hundred-fold error is visible in a test rather than on a client's page.
`normalise.spec.ts` asserts both readers against the same figure (net operating
income, which the engine publishes in both places) precisely so that if either
were wrong they would differ by 100×.

---

## 3. The document

Nine sections; five conditional. A conditional section is **absent**, not empty:
a lease-doc refinance has no business income, an owner-occupier has no tenancy
schedule, and a first commercial purchase has no portfolio, and a heading over an
empty table tells the reader something false about the deal.

| # | Section | Pages | On when |
|---|---|---|---|
| 01 | Capacity at a glance | 2 | always |
| 02 | The transaction | 1 | always |
| 03 | Income and serviceability | 2 | always |
| 04 | What sets the capacity | 2 | always |
| 05 | Portfolio impact | 1 | the borrower holds assets |
| 06 | Analysis | 2 | an analysis exists |
| 07 | Compliance and next steps | 1 | always |
| 08 | How this was calculated | 2 | the run carried an explain trail |

Cover and contents open it; the company/disclaimer page closes it. The full
fixture renders **17 pages**, and CI asserts that number inside the render
container — a section that stops building changes nothing a unit test sees and
changes this.

### Three charts

| | What it shows the table cannot |
|---|---|
| **Utilisation bullet** | The request against the limit. Over-limit reads as the bar crossing the line, not as a colour somebody has to interpret. |
| **Constraint bars** | Which test binds, and by how much. This is the chart the format exists for: the binding test is simply the shortest bar. |
| **Income donut** | What carries the serviceability, after shading. |

### Two things said three times

The binding constraint is named **in the narrative**, marked **"Binds"** in the
table, and drawn in the caution role **in the chart**. A reader printing in
monochrome, or one who cannot separate red from green, gets the answer either
way. Every direction in this document is likewise printed in words — "Improves"
/ "Reduces" — because colour alone gets it wrong and gets it wrong invisibly
(`BORROWING_CAPACITY.md` F6).

And a test that **did not bind** is distinguished from one that was **never
run**. Collapsing them tells a reader a test passed when nobody ran it.

---

## 4. The analysis

`commercial-bc-scenario-agent` already gives the C&I *calculator* an AI: a
snapshot of the deal in, and scenarios out, each with a name, a reasoning line,
an estimated impact, an execution risk and the evidence a broker must gather.
This gives the *report* the same capability, held to the same shape
field-for-field, so a scenario an adviser saw on the calculator reads
identically when it arrives in a client's document. Same gateway, same model
(`google/gemini-2.5-flash`), same voice.

One field of that agent's schema is deliberately not carried: `adjustments`, the
machine-readable overrides it returns so the calculator can cascade them. A
cascade is an action in an application; a PDF has nobody to hand them to.

### Four rules, and why each exists

**The model is never given a number to compute.** The prompt carries figures
already formatted by `Measure` — the same `$3,055,219` the client will read —
and **the tool schema has no numeric field anywhere in it**. That is a
structural guarantee rather than a request: a prompt instruction is something a
model can ignore, a schema with no `"number"` in it is not. `analysis.spec.ts`
asserts the absence.

**A malformed answer is no answer.** `parseAnalysis` returns `null` rather than a
partial analysis. A report with no analysis section is a complete report; one
with two of its four parts looks like something failed, because it did.

**Length is capped, not requested.** The section claims two pages and the spine
is validated against a page band, so every string is truncated in code.

**The page says what it is.** The provenance note is printed above the model's
prose, unconditionally, with the model's name and the date it wrote. A client is
entitled to know which parts of a finance document a machine composed and which
parts an engine computed — and everything outside that one section is computed.

### It is persisted, and why

`commercial_industrial_calculation_runs.analysis`, written on first render and
reused after.

* **A re-issued report must say what the first one said.** A client who receives
  the document twice and finds the reading of their deal has changed has no way
  to tell whether the figures changed too. They did not; the model is not
  deterministic.
* A model call is metered. Re-rendering an unchanged assessment should not spend
  one.
* The analysis is evidence of what was sent.

It hangs off the **run**, not the assessment. An analysis interprets a specific
set of figures, and a recalculation writes a new run — runs are immutable — so
an analysis can never outlive the numbers it was written about. On the
assessment it would have survived a recalculation and gone on describing a
facility that no longer existed.

`refreshAnalysis: true` is the explicit opt-out for an adviser who wants a second
reading; `includeAnalysis: false` renders the document without one at all.

---

## 5. The render path

`render-commercial-capacity-pdf`. The caller sends an assessment id; everything
the document says is read server-side. A test asserts the route ignores a
`clientName`, a `capacity` or an `html` a caller tries to send — for a document
that states what a borrower can borrow, the contents are not the browser's to
decide.

| | |
|---|---|
| **Auth** | `verifyAuth` establishes a human; the service-role identity is refused because it is not a person. Every read is scoped by `user_id`, the rule the rest of this feature uses. `requireWorkspaceCapability('commercial-industrial')` gates the module. |
| **Eligibility** | Only `completed` or `linked`. Enforced here, not only in the UI — a draft's figures change under the reader's feet. |
| **Brand** | `buildReportBrandSnapshot`, then `upsert_report_brand_snapshot`, which dedupes by content fingerprint. |
| **Analysis** | Reused from the run unless refreshed; rate-limited per caller; never fatal. |
| **Resources** | `assertSafeRenderResources` on HTML this function built itself — the assets came from a tenant's settings form, and the guard belongs on the boundary. |
| **Render** | `_shared/weasyprintClient.ts`. No fallback: a silent downgrade ships a client a document nobody approved. |
| **Storage** | `client-files/commercial-capacity/<assessmentId>/<day>/<uuid>-<file>.pdf`, `upsert: false`. |
| **Record** | Every attempt writes a `commercial_industrial_report_renders` row, failures included, with their reason. Plus a `report_generated` audit event, because a document leaving the building is a state change. |

### The filename

`Commercial_Capacity_Report_<Reference>_<yyyy-MM-dd>.pdf`, built from the
assessment's own reference rather than from a client name — this document's
subject may be a standalone assessment with no client attached, and a folder of
`..._Client_2026-08-05.pdf` files that are all different assessments is a folder
nobody can use. The `[^a-zA-Z0-9]` → `_` rule is the Snapshot's, kept so the two
sort together.

### Access

`commercial_industrial_report_renders` admits `service_role` only, deliberately
**not** the rule `borrowing_capacity_renders` uses. That table scopes through
`clients`, because a Snapshot always has one. A C&I assessment need not be
linked to a client at all, so scoping through `clients` here would make a
standalone assessment's renders readable by nobody, or by everybody, depending
on how the join was written.

---

## 6. What the first render found

Rendered through WeasyPrint and read page by page, which is the only way most of
this surfaces. Ten findings; two of them were bugs in shared code.

1. **`formatDelta` reported "no change" for every rate that changed.** The
   portfolio table read `57% → 64%, change —`. A `rate` is a 0–1 fraction that
   prints ×100, and the zero-check rounded the **stored** value at the unit's
   precision: `(0.0762).toFixed(0)` is `0`. Fixed in `measure.pure.ts` by
   rounding on the rendered scale. **This was live for the Borrowing Capacity
   Snapshot too** — every shading-rate delta in its audit table.
2. **A four-row funding table broke 2/2 and left an otherwise blank page.** The
   transaction section came to just over a page, and the next section opens on a
   fresh one, so there was nothing to fill it. The funding figures are a KPI
   strip now and the section fits.
3. **The method appendix repeated the constraints section.** Its last eight rows
   were the capacity caps — same labels, same formulas, same figures, five pages
   after the table whose whole purpose is those rows. It cost a page, and the
   page it cost carried two rows and nothing else.
4. **The constraint chart was unreadable.** Global servicing permitted $14.1m
   where every other test sat between $3.0m and $4.6m, so one bar took three
   quarters of the width and the difference between the binding test and the
   next — the only thing the chart is for — was invisible. Bars are sorted
   ascending now and a test permitting more than 3× the binding cap is left to
   the table, with the caption **saying how many**. A dropped bar is said, not
   hidden.
5. **The donut's centre figure overflowed its own ring.** `$2,060,191 pa` at
   display size in a 112px hole. The primitive's default — the largest segment's
   share — is short, is what a proportion chart is answering, and the total is
   printed immediately below.
6. **The bullet chart contradicted itself.** The bar was the requested facility
   and the label under it was the capacity. It now reads the bar's own share.
7. **"A WALE of 3.5 years years."** `formatMeasure` already appends the unit.
8. **The engine's own disclaimer was carried on the payload and printed
   nowhere.** It is on the disclaimer page now — it is a statement about the
   whole document, and that is the page that makes those. Putting it at the foot
   of the compliance section pushed a four-line callout onto a sheet of its own.
9. **Two captions stacked.** A chart's `figcaption` immediately above a table's
   `caption`, both uppercase mono, reads as a heading printed twice.
10. **The reference printed twice on the cover** — once in the meta row, once in
    the foot. The same defect `BORROWING_CAPACITY.md` §7 records for the company
    name.

Also fixed while reading: the loan-to-cost row had no policy ceiling beside it
though the policy has one; the amortisation period was absent from the terms
table, though every debt-service figure in the document is calculated on it (a
five-year facility amortised over twenty is routine, and a terms table showing
only the term invites the wrong arithmetic).

**Still open.** The contents page measures 3.2% ink and the critic flags it. It
is eight entries on an A4 sheet, and every format in the programme with a
contents page has the same shape; special-casing this one would make it the odd
document out. Left as a design-system question rather than a format one.

---

## 7. What holds it

| Guard | Asserts |
|---|---|
| `commercialCapacitySourceOfTruth.spec.ts` | One implementation, bridged; no import an Edge Function cannot resolve; no clock, randomness or I/O in a `.pure` module |
| `normalise.spec.ts` | Every figure against the **real engine's** output over the real worked example — cents vs dollars, units, the binding test, directions that describe the borrower rather than the arithmetic |
| `labels.spec.ts` | The copied label maps still match the engine's, in both directions |
| `analysis.spec.ts` | What the model is told, what is accepted, what is refused, and that the schema has no numeric field |
| `sections.spec.ts` | The spine validates at both extremes and stays inside the archetype's band; the Snapshot's archetype was not disturbed |
| `render.spec.ts` | The binding constraint in words; the provenance note; no approval claimed; nothing positioned; every colour traced to the palette; every string escaped, the model's included |
| `route.spec.ts` | Only an assessment id is accepted; the filename and the storage path |
| `reportAction.test.tsx` | The row action and the results button obey the same predicate the route does; a double-click cannot start two renders |
| CI `render-container` | The real document, rendered by the container it just built: zero engine warnings, four brand families embedded, **17 pages** |

The fixture is generated by running the engine, not written. Four hand-authored
drafts of the Snapshot's fixture each invented a shape and each produced a page
of plausible-looking wrong output; the cheapest fix is to not write one.

---

## 8. Deployment, and what the first production click taught

Steps 1 and 2 below were **done by hand on 2026-08-05** (migration applied via
the management API; the function deployed as an esbuild bundle of the repo
sources). They are recorded here because the *repo's* pipeline did not do them,
and the way that failed is worth knowing: PR #1947 merged, the
`deploy-supabase-functions` workflow fired — and stopped at its no-credential
gate, green, because the `SUPABASE_ACCESS_TOKEN` secret has never been set. The
first click on Generate report then hit a gateway 404 for a function that was
never uploaded, which a browser reports as a **CORS error**, because a 404 from
the gateway carries no CORS headers. Merging is not deploying; the workflow
even prints what it would have shipped.

1. Apply `20260817000000_commercial_capacity_render_path.sql`. **Done.**
2. Deploy `render-commercial-capacity-pdf`. **Done** — via the Lovable
   pipeline, from the repo's own sources on `main` (edit
   `Deployed commercial PDF func`, commit 110d6a6c). Verified live: OPTIONS
   preflight 200, unauthenticated POST 401 with the correct
   `access-control-allow-origin` — the exact request shape the browser makes.
   The next merge that touches it still needs the *repo's* pipeline: add
   `SUPABASE_ACCESS_TOKEN` in Settings → Secrets → Actions, and every merge to
   `main` deploys itself instead of stopping at the credential gate.
3. Set `LOVABLE_API_KEY` if it is not already set for the project. Without it
   the report renders **without its analysis section** and says so in the
   response — it does not fail.

There is deliberately no legacy fallback: what this replaces is
`window.print()` on a print-styled results screen, and falling back to that
would hand a client a screenshot of an application under the name of a finance
report.

`manage-ci-assessments` has since been deployed by hand three more times for
the same reason — **v12** (client creation, the client workspace, the platform
client scope), **v13** (the `rename` operation and the workspace's
uploaded-document summary) and **v14** (editing a completed assessment, and the
workspace's not-linked-yet candidates). Each time, the repo merged and the
pipeline shipped nothing. Until the
secret exists, treat "the function changed" as "the function needs deploying by
hand", and verify the same way: OPTIONS 200, then an unauthenticated POST that
must answer `401 {"error":"Authentication required"}` with the CORS headers on
it. A worker that failed to parse answers 503 `WORKER_BOOT_ERROR` instead, so
the 401 is the proof it booted.

---

## 9. On the Investment Compass families

Fifty masters, one per family and variant, plus the projection and adapter that
make them production-ready. Before this the format had **no adapter at all** —
not even a preview-only registry entry — so its library card read "unknown"
rather than "preview-only", despite this being the second-most-rendered route in
the programme.

### The corpus is a decline, so the document is built around one

Measured against production rather than assumed:

| | |
| --- | --- |
| assessments | 16 |
| **with no calculation run** | **13** (7 `draft`, 4 `archived`, 2 `data_entry`) |
| carrying figures | 3 |
| of those, `outside_current_assumptions` | **3 of 3** |
| of those, bound by the DSCR | **3 of 3** |

Thirteen have no figures for a document to carry, so `commercialCapacityAdapter`
returns `null` for them rather than producing a page of blanks — the Cash Flow
adapter's behaviour, for the same reason.

For the three that remain, a decline is not the edge case after the happy path;
it is the whole document. The answer page leads with the outcome, the reason and
the binding test.

**`difference` is signed and a template cannot branch on a sign.** So the
projection publishes `differenceLabel` (`Shortfall` / `Headroom`) and
`differenceAbsolute`. Without them a master prints a negative number under a
heading reading "headroom", on every assessment in the record.

### Nothing recomputes

§2's rule, kept by construction. `commercialCapacityProjection.pure.ts` unwraps
`Measure`s to the bare values a template filter can format, labels, and caps —
it derives no totals. A derived total would be a second engine, and a document
whose arithmetic disagrees with the calculator a broker was looking at is worse
than one with a gap in it. `commercialCapacityProjection.spec.ts` asserts the
transaction total is the engine's rather than the lines summed.

### The analysis cannot be drawn unlabelled

§4's fourth rule, enforced structurally rather than by review. `analysis` and
`analysisProvenance` are published **together or not at all**, so a master that
draws the model's prose cannot draw it without the sentence identifying it. A
spec walks all fifty masters and fails any page that binds
`capacity.analysis.interpretation` without `capacity.analysisProvenance`.

The analysis itself is reused from the run and never regenerated at render time:
a re-issued report must say what the first one said, and a template render is not
the place to spend a metered model call.

### Reportability follows the route

A stored run is necessary but not sufficient — the adapter defers to
`route.pure.ts`'s own `isReportable`, so a template cannot produce a document the
flowing route would refuse.

That costs one assessment today, and it is worth recording why: `REPORTABLE_STATUSES`
is `['completed', 'linked']`, **no row has ever been `completed`**, and the one
`calculated` row carries a complete run and outcome and is excluded by it. Two
parts of one product disagreeing about whether a deal may be sent to a client
would be worse than a row somebody has to link first — but the vocabulary looks
wrong and is worth a second opinion.
