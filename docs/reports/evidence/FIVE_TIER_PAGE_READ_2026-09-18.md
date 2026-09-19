# All five tiers, read as documents — 18 September 2026

S5/S6 §9 asks for the report deliverables finished across all five reports, and
§10 asks that every page be read. This is the page-level read of **all five
tiers**, taken from real renders rather than from the code that produces them.

**This is a retained-data replay, not a real end-to-end generation.** Every
document below was drawn from a stored `investment_reports` row through the
journey harness: the real application in a real Chromium, the real template
path, and WeasyPrint 69.0 — the version `weasyprint-service/requirements.txt`
pins — but the Supabase project is answered from fixtures, no credential is
spent and no vendor is called. §10's ten PDFs for Annabelle and Pallas still
need the authorised environment. Nothing here is offered as those.

## The five tiers

One fixture per tier, all non-client rows (`client_property_id` null):

| tier | fixture | property | stored chars | rendered |
| --- | --- | --- | --- | --- |
| compass | `09f8569e` | 48 Redfern Street, Cowra NSW | 57,544 | 35 pp |
| strategic (Due Diligence) | `2f1f7f6f` | 1/27D Mitchell Street | 39,608 | 25 pp |
| financial | `c21ed1fa` | 1/27D Mitchell Street | 28,636 | 19 pp |
| briefing | `89b451f6` | 1/27D Mitchell Street | 14,435 | 11 pp |
| snapshot | `8c6edc56` | 1/27D Mitchell Street | 12,325 | 11 pp |

Front-end journey: **31/31 on every tier**, after the harness gap below.

## The harness gap that came in with `main`

The three Compass journeys on record were run 14 September and passed with
nothing unanswered. Re-run today the strategic journey failed one check —
`every request the page made was answered — fn:mission-control-announcements`.

That is not a product defect. `AnnouncementHost` is mounted by
`DashboardLayout` on every dashboard page, so it is on every report page;
`fetchAnnouncements` already answers a failure with an empty list and a warning
rather than an error. It is new chrome that arrived when `main` was brought into
the branch, and the double had never been taught it — its three siblings
(`mission-control-plan-change`, `mission-control-feedback-prompt`,
`notifications-feed-v2`) were already there. The double now answers
`{ announcements: [] }`, which is the shape `parseAnnouncementsPayload` reads
and what a deployment with nothing published returns.

Worth recording because the old artefacts *looked* like a clean baseline: a
four-day-old `journey.json` cannot see a request the page only started making
yesterday.

## The two fixes from the previous commits hold on every tier

**Cover (`htmlRenderer.ts`).** The visually-hidden `<h1>` carried for PDF/UA
7.4.2 was still being painted. Measured on the strategic cover's text layer,
the three occurrences of the document name are now all designed furniture at
real sizes — the brand lockup at `x=68 y=123.9` (13.6 pt) and `y=137.4`
(13.6 pt), and the running head at `x=466.9 y=124.1` (8.1 pt). Nothing sits at
the origin, on any tier.

**Contents (`listedSectionLevel`).** The generalised rule — *a level is a
section tier only if its sections open more than one page* — was verified on
the Compass shape before this. It holds on the other two shapes too:

| tier | contents rows | leads with |
| --- | --- | --- |
| strategic | 12 (9 real sections) | Executive dashboard · Client Property & Location Snapshot · Core Property Facts … |
| financial | 11 (7 real sections) | Executive dashboard · Client Investment Decision Summary · Financial Input Snapshot … |
| briefing | 22 | Location Overview · Current Market Performance · Market Activity … |
| snapshot | — | no contents page; page 2 is the Verdict (correct for the format) |

Before the fix the strategic listed its whole body as one row (`# Property &
Location Due Diligence Report`) and the financial as one (`# Client Investment
Feasibility & Financial Performance Report`).

## Mechanical measurement — `report-pdf/measure.mjs`

| tier | fonts | result | issues |
| --- | --- | --- | --- |
| strategic | 12/12 embedded | FAIL | SPARSE p2 48.4%, p3 55.3%, p24 52.6%; **TOKEN p7** |
| financial | 13/13 embedded | FAIL | SPARSE p2 51.2% |
| briefing | 6/6 embedded | FAIL | SPARSE p3 55.3%; **TOKEN p4** |
| snapshot | 5/5 embedded | **PASS** | none |

No ILLEGIBLE, no OFF-PAGE, no OVERLAP, no MOJIBAKE, no BLANK on any tier.
Page numbering correct on every page that draws it.

### The SPARSE pages, diagnosed

p2 on the strategic and the financial is the **contents page**: 12 and 11 rows
on a page sized for about 30, so the band under the last row is half the body.
Filling it would mean listing subsections, which `listedSectionLevel` exists to
refuse — a complete list of sections beats a truncated list of sections and
subsections. p24 is the strategic's disclaimer.

The Compass's two are worth naming exactly, because **both empty bands sit at
the FOOT of their page, not in the middle** — measured from the text layer, so
neither is a `closeDroppedBlocks` hole. Each is a short page, and each has a
different, identified cause.

**p3 (68.3%) is Decision E working.** It is the Verdict master's second sheet,
which draws a KPI band and a property/detail table: `PURCHASE PRICE` and
`WEEKLY RENT`, then three rows (`house`, `1 car`, `988 m²`), last ink at
y=291 of 842. The Snapshot's equivalent page draws the *same* master band with
`GROSS YIELD`, `WEEKLY POSITION`, loan amount and annual repayment as well, and
fills. The Compass is shorter because it **correctly withholds the purchase
modelling** (`TIER_FRAMEWORK.md` Decision E) — the bindings are absent and the
blocks below them suppressed. Re-laying the Verdict spread for the content the
Compass actually carries is a template-master question, which is the already
recorded deferred item on master geometry, not a defect in this release.

**p33 (77.9%) is the packer at its calibration boundary, not a bug.** The
source is a seven-item list under `Report Limitations`; the packer cut it 4/3
and the last three items print 105pt of a ~700pt body. Both repair mechanisms
decline, and both decline *as designed*:

- `stubRoom` makes a cut shorter only while the stub is under
  `tailMinLines(contBudget)` = `max(4, round(contBudget × 0.2))`. Three list
  items clear that in the packer's own charge unit, so the cut stands.
- `balanceTail`'s pull-down loop breaks on `cut.has(foot)` — p32's last block
  is a piece of this same list, and the rule is explicit that a cut piece is
  never moved away from its siblings, because it would print as a gap inside
  one list.

So the guard is stated in **charged lines** and the defect is in **printed
height**, and for a short-item list those diverge: each item is charged a wrap
allowance these items do not use. Closing it means either moving
`TAIL_MIN_FRACTION` or making the guard measure printed height — on a
subsystem whose charge model was calibrated against the pinned engine across
the whole corpus, where either change shifts page counts on every report.
That is a measurement exercise, not a patch, and it is **deliberately not made
here**: `NARRATIVE_PACKING.md` records what it cost to calibrate once.

Recorded as measured rather than closed. The threshold is deliberately generous
and these are the pages it is generous *about*.

### The two TOKEN findings are real, and both are fixed at the producer

Both are model-authored prose in **stored** content, so neither is repaired by
this release for the rows that carry them — a prompt change is forward-only,
and **prose is never regex-scrubbed** on read or on write. What changes is that
the next document cannot be written this way.

**1 — an absence drawn as a finding.** Strategic p7:

> `⚠ Exact bed/bath/car details not provided`

Measured across all seven retained reports: **4 of 194 at-a-glance cells** put
a gap in our own file into the strip's `⚠` *watch* cell, which means something
a buyer should watch. Three of the four are on `8ef4bfc3`, the sparse Compass
with no financials — the shape holding least evidence is where the model
reaches for this.

`COMPASS_DOCUMENT_CONTRACT` already said the right thing about prose ("omit the
sentence … do not say it is unavailable"). The model obeyed that and put the
absence in a chip instead. This is the third time this repository has recorded
the same shape: a prohibition that names a form without demonstrating the
permitted one is one a model routes around. The contract now extends the rule
past prose into the strip, the cell and the chart, and demonstrates the
permitted form — **fewer cells**: three that each carry a finding is a complete
strip.

**2 — the document naming its own source.** Briefing p4:

> *"Specific market activity metrics like active listings, sales volume, and
> vacancy rate were not provided numerically in the original report."*

Row `89b451f6` carries four of these, each shaped
`N/A (… not provided in the original report.)`.

The cause is exact and was in the prompt: `condense-investment-report` handed
the parent to the model under the literal label **`ORIGINAL COMPREHENSIVE
REPORT:`**, and the model gave that phrase to the client — who was handed one
document and cannot open the other one. It is the same routing-around twice
over: `IMPORTANT` banned the *token* ("NEVER write N/A") without naming the
permitted form, so the model wrote a sentence narrating the gap and
parenthesised the token inside it. A prose bullet is exactly where the
read-path placeholder scrub correctly cannot reach.

Changed: the block is labelled `SOURCE MATERIAL (pipeline input — the reader
has never seen this document)`; the two structure guides stop saying "the
original report's own section headings"; and `IMPORTANT` states the reader
holds one document, names the three phrases, and gives the permitted form —
omit the line, the bullet or the row, and do not leave the heading behind.

Both rules are pinned by
`src/lib/reports/__tests__/documentNeverDescribesItsOwnProduction.spec.ts`
(9 tests), including the assertion that no prompt text anywhere between
`TIER_CONFIG` and the end of the user prompt hands the model the phrase.

`condense.system_template` in `engine-prompts.ts` still says "as they appear in
the original". It is left alone deliberately: it is a DB-overridable default, it
says "the original" rather than "the original report", and the load-bearing ban
is in the code-built user prompt, which no deployment can override.

## The ten-year infrastructure outlook — §9's four requirements, measured

`infrastructureEvidence.pure.ts` was checked against §9's wording line by line.
Three of the four requirements were already met and are named in the module's
own rules: attributable evidence (rule 1 — a project is named only where a
register named it), the proposal/approval/funding/commencement/completion
distinction (rule 2 — a status is the publisher's own word, and an unrecognised
word is printed rather than forced into a category), and unknown dates and
funding staying unknown (rule 3 — a gazettal or determination date is labelled
as a date something HAPPENED; `statedDelivery` is null per entry rather than
once at the foot).

**"Confirm project identity before deduplication" was met on one of two paths
and missing on the other.** The council development-application half already
does it properly — `summariseDaRows` resolves an amendment to the parent
application it amends by the register's own reference, which is why
`1382/2025/JP/A`, `/B` and `/C` stopped being three $93m data centres.

The state-instrument half had no identity handling at all, and the overlap it
needed one for is exact rather than incidental: `QLD_INSTRUMENT_LAYERS` queries
layers **25, 30, 35 and 40** of `PlanningCadastre/StatePlanning/MapServer` one
at a time, while `buildQldStatePlanningIdentify` calls `identify` on **the same
MapServer** with `layers: all`. Those four layers answer both.

Executed 18 Sep 2026 — no retained fixture carries `planningData`, so this
class cannot be found by replaying them:

| name | kind | status | reference |
| --- | --- | --- | --- |
| Maryborough Priority Living Area | Priority development area | Declared | PLA-MBH |
| Maryborough Priority Living Area | Growth / priority area | Statutory | Wide Bay Burnett Regional Plan |

One designation, two rows, disagreeing on every cell but the name — the legacy
report's own failure, which `compassDocumentContract` was written against
(*three copies of one zoning section on one lot, disagreeing on every control*).

**Rule 10** closes it, and closes it narrowly because §9's wording is a warning
rather than an instruction to merge.

Its first version merged on **publisher + name**, and the platform owner was
right that this is a *candidate* match rather than proof — two designations can
share a name across registers, and the context source was read as
`?? 'state planning layers'`, so two readings naming **no** source both wore the
fallback and looked identical to each other. A missing source must never
establish identity.

Identity now requires three things, and any one missing means no merge:

1. the context reading **names its own publisher** — no fallback;
2. it carries the publisher's own **`sourceLayer`**, and that layer is one of
   the four in `INSTRUMENT_LAYER_KIND`, mapped to the kind the instruments
   probe would have returned for it. This is the stable identifier: a label is
   what a feature is called, a layer id is which register it came out of. The
   id was already in the ArcGIS `identify` response and was being discarded at
   the parse boundary; it is now carried on `PlanningConstraintReading`;
3. the two publishers' own **names match exactly** after trim, case-fold and
   whitespace collapse.

No token overlap, no edit distance, no shared word: *Maryborough Priority
Living Area* and *Hervey Bay Priority Living Area* stay two designations, and
nothing merges across sources at all. **Where identity cannot be proven the row
stands** — a visible duplicate is a presentation fault, and merging two
different designations deletes a real one; only one of those is recoverable.
The mapping is asserted against `QLD_INSTRUMENT_LAYERS` itself, so a layer
added there and not here stops merging rather than starting to merge the wrong
thing. The layer-specific
reading wins, because it parses that layer's own fields (`pda_name`,
`pda_status`, `gazetted_date`) where the identify-all row parses whatever the
server volunteered. The suppression is silent — a duplicate that was never
printed is not something a reader lost, and narrating it would be the same
mistake as the two findings above. Thirteen tests, eight of which assert what must NOT merge — including a
missing layer id, a layer outside the four, a layer mapping to a different
kind, and two readings that both name no source at all.

One thing checked and found not to be a defect: the first probe printed the raw
register key `priorityDevelopmentArea` in the client-facing Kind cell, which
looked like database vocabulary reaching a client. It was the probe's own
artefact — `planningSources.pure.ts` emits `priority_development_area`, which
`INSTRUMENT_LABEL` maps. Recorded because the wrong conclusion was one step
away.

## What this does not cover

- §10's ten PDFs through real generation for Annabelle and Pallas.
- The **coverage** half of the infrastructure outlook, which is unchanged and
  is a sourcing question rather than a correctness one: council capital works
  programmes, state and federal budget programmes, and transport, water,
  energy and health agency announcements are not read by either register.
  `INFRASTRUCTURE_COVERAGE_LIMITS` already states all four on the page, on a
  full reading as well as an empty one, so a short list reads as a short search
  rather than a quiet area. Closing it means acquiring registers, not changing
  this module.
- The navigation and educational treatment from the Lot 20427 reference (§9).
