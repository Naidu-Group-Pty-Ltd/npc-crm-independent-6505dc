# The five reports — implemented / tested / visually verified / released

Four separate states, kept separate on purpose. A change can be written and
under test while nobody has looked at a page it draws, and every one of these
reports has at some point been all three of those without being released.

Nothing here is released. **Production release remains subject to the owner's
approval gate.** The branch is `claude/adoring-hopper-g02tdt`.

**Picking the programme up in a new session?** Start at
[`S5_HANDOFF.md`](./S5_HANDOFF.md) — it carries the standing constraints, what
is decided, what is measured, what is next, and the one question waiting on the
owner.

| | implemented | tested | visually verified | released |
| --- | --- | --- | --- | --- |
| **Investment Compass** | S1–S3, S5 | 9,402 report-suite tests, PDF/UA-1 on both subjects | both documents drawn whole (36 + 22 pages), every page measured | no |
| **Financial Analysis** | S3, S5 | as above, PDF/UA-1 on both subjects | both documents drawn whole (21 + 20 pages), every page measured | no |
| **Strategic** | S3, S5 | as above, PDF/UA-1 on both subjects | both documents drawn whole (29 + 19 pages), every page measured | no |
| **Executive Briefing** | S3, S5 | as above, PDF/UA-1 on both subjects | both documents drawn whole (20 + 18 pages), every page measured | no |
| **Snapshot** | S3, S5 | as above, PDF/UA-1 on both subjects | both documents drawn whole (11 + 12 pages), every page measured | no |

S5 produced all four non-Compass reports for both subjects through the
supported fork and condense compositions and drew each on the production
print contract —
[`S5_FORK_DOCUMENTS.md`](./S5_FORK_DOCUMENTS.md),
[`S5_CONDENSED_DOCUMENTS.md`](./S5_CONDENSED_DOCUMENTS.md). "Every page
measured" means each page was rasterised and its body ink measured against
the master's own content box; the two defects that found are in §3 of the
second doc. **The Briefing and the Snapshot each carry one named stand-in for
the model call** (`scripts/reports/_condenseStandIn.mts`), which copies the
parent's own blocks and cannot invent a figure; the fork's two need no model
call at all. Neither report has yet been produced by a run that made the real
call, which is the gap S5 does not close.

## What each column means here

**Implemented** — the change is in the branch and reaches this report through
the shared path (`reportBindingProjection.pure.ts` and the block renderers),
not through a review script.

**Tested** — the report suite passes (10,246 tests, 0 failing), and the
document this report draws validates as PDF/UA-1 against veraPDF 1.30.2. That
is a machine check: it proves the structure tree exists, the heading levels
descend, every figure carries alternative text and the metadata claims what
the file is. **It cannot tell you whether the alternative text is any good.**

**Visually verified** — somebody has looked at every page of a rendered
document for this report. For the Compass that is the six review pages, its
tier page and all 36 pages of the Templates-workflow render. **For the other
four it is one page each**, composed from bindings to show the tier
separation. One page is not a document: the remaining four reports have not
been drawn end to end and read page by page, and that is S5's work.

**Released** — nothing is. No production deploy, no migration, no historical
report regenerated or rewritten.

## Remaining delivery, by responsible stage

**A binding that resolves is not a delivered report.** The five tier pages
prove the projection publishes the right content per report; they do not prove
a client receives it. Everything below is outstanding, and none of it is
counted anywhere in the table above.

| remaining work | stage | why it is not done |
| --- | --- | --- |
| **Template-content integration** — the approved structure, explanations and bindings moved into the masters the generation and export paths actually use | **S4, needs a decision** | The treatment lives in the projection and the review scripts. Part of it cannot live there: the Compass's KPI band draws the master's own literal `Weekly rent` with the note `{{financials.annualRent \| currency}} p.a.`, and the projection cannot reach a master's label or a literal suffix. Closing it edits `investmentCompass/blocks.ts` and re-runs `templates:library:seed`, which writes a migration covering **all 500 masters** — a production change under the release gate. See § What needs a decision. |
| **Restored legacy coverage** — SWOT, suitability, strategy, monitoring, named facilities, key findings, suburb comparisons | **S4, needs a decision** | `sectionRegistry.pure.ts` already defines `swot`, `suitability`, `exitStrategy`, `amenityAccess`, `marketPosition` and `suburbCharacter`; the Compass's v4.0 list draws none of the first three, and there is no `monitoring` section at all. Adding them widens an approved structure and its 34-page budget. See § What needs a decision. |
| ~~**Section navigation**~~ — a contents page and bookmarks naming SECTIONS, resolving correctly after pagination and conditional content | S4 | **Done on the template path.** Measured on the 36-page Chancery Compass: the contents prints 22 section rows whose 22 destinations resolve to the folios beside them, and the outline carries the same 22 with 26 subsections nested under them. The FLOWING renderer's documents still carry no internal links (S3 residual, below). |
| **Full-document verification** — every page of all five reports, for both properties, read and reconciled | S5 | Four of the five have been seen on one composed page only. |
| **Ten-year outlook sources** | S4, needs a decision | See `S4_INFRASTRUCTURE_SOURCE_COVERAGE.md`. No free, keyless, openly licensed register publishes infrastructure PROJECTS resolvable to either subject locality. Awaiting an owner decision between curated official publications and a commercial provider. |
| ~~**Planning and development evidence**~~ — the register read whole, one entry per development, the six per-project facts, and the evidence recorded on the row | S4 | **Done.** `S4_PLANNING_AND_DEVELOPMENT.md` carries the four defects and the measurements; `reports/pdf/s4-planning.pdf` is both subjects drawn through the supported template path, 13 pages, PDF/UA-1. |
| **Frontend journey** — selection, editing, saving, reopening, preview, export, history, permissions | S5 | Not exercised end to end. |

## What needs a decision

Two items above are not blocked on work, they are blocked on a choice. Neither
is started, and neither should be started on an assumption.

**1 · Re-seeding the 500 masters.** Some of the approved treatment is master
CONTENT rather than bound data — the Compass KPI band's `Weekly rent` label
and its ` p.a.` suffix are literals in `investmentCompass/blocks.ts`, and no
projection can reach them. The five tier pages already say *"Indicative weekly
rent"*; the master does not. Closing it is a one-line source edit plus
`npm run templates:library:seed`, which regenerates a migration covering all
500 masters and every one of the ten formats they serve. That migration
reaches production only through the release gate, and it is the same mechanism
the chip `radius` and any other master-level wording would travel on — so it
is worth doing once, deliberately, with the full list of wording changes
agreed first.

**2 · Widening the Compass's section list.** The brief asks for SWOT,
suitability, strategy and monitoring to be restored. `sectionRegistry.pure.ts`
already defines `swot`, `suitability` and `exitStrategy`; the Compass's v4.0
list draws none of them, and `monitoring` does not exist as a section
anywhere. Adding four sections to a document specified at **8,150 words across
15 sections against a 34-page budget** changes both the structure and the
budget, and the registry's own rule — *a section with nothing behind it should
be merged; a section with a register behind it should not* — needs applying to
each one before it is added. It also has to respect the Compass/Financial
split, because `suitability` and `exitStrategy` both edge towards the
modelling the Compass deliberately does not carry.

## The honest gaps

- Four of the five reports are visually verified on **one page**, not a
  document.
- The review pages are a review artefact. Their prose has not been moved into
  the masters, so a production render draws the masters' own copy.
- The frontend journey — selection, editing, saving, reopening, previewing,
  exporting, history and permissions — has not been exercised end to end. S5.
- The ten-year outlook's source work is S4 and is not started.
