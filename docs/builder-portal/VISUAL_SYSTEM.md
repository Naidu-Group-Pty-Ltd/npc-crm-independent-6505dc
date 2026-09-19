# The Builder / Developer Portal's drawing set

The portal's visual language is taken from the artefact a builder already
lives in: a drawing sheet. Setout grid, three line weights, annotation type,
a dimension line, a title block, a ruled schedule.

Read this before touching `src/styles/builder-drafting.css`,
`src/components/builder-portal/ui/*`, `src/lib/builderConstructionRail.pure.ts`
or the `aside` on `BuilderPortalShell`.

---

## 1. The defect this exists to prevent: a system nobody mounted

The first pass shipped the whole language and **three of its components had
zero call sites**. `DimensionRail`, `TitleBlock` and `bd-chip` were written,
documented, reviewed, merged and deployed without ever being rendered. 19
builder pages mounted `BuilderPortalShell`; **none** passed an `aside`.

What reached production was the half that re-skins existing markup — the
field, the annotation type, the schedule, the ledger, the nav — so every page
changed just enough to look finished. The half that makes the portal read as
*construction* rather than as a competent dark admin panel was dead code, and
nothing in the gate could see it: it typechecks, it lints, it has tests, the
build succeeds, and an unused export is not an error.

**A component is not shipped until something renders it.** The cheap check is
one grep per exported component; the honest check is a render.

## 2. The rail draws construction, and construction is already in the schema

`BuilderConstructionStageKey` has always been
`site_preparation | base | frame | lockup | fixing | practical_completion |
handover`, and `BuilderConstructionStage` carries `sequence_number`, `status`
and `actual_start_date`. The extent the rail needed was in the database from
the first migration. The page drew it as *"4 of 7 stages complete"* under a
progress bar — a percentage, which answers **how much** and never **which**.

`builderConstructionRail.pure.ts` is the one module that projects a build onto
the line, so the detail page, the list and anything added later cannot come to
different answers about the same case.

### Three rules

**Off-sequence is not a position.** `on_hold` and `cancelled` are real
statuses and they are *not* points on the line: a paused build is somewhere on
the extent and the status does not say where. They resolve to `null`, and the
rail draws the whole extent in the pending weight with the absence stated.
Placing them at an index invents a fact; placing them at the end would say a
cancelled build had completed.

**The case's own stages outrank the catalogue.** Where a build carries stage
rows the extent is built from those, in their own `sequence_number` order — a
builder may not run every stage, and a rail showing stations this build does
not have is measuring somebody else's job. The fixed key order is only the
tie-break.

**A short label is a prefix of the full one.** The rail *draws* `short` and
*speaks* `label`. Keeping one a prefix of the other is what makes shortening
safe: the two cannot come to name different things. Asserted by a test, not
trusted.

Two more, inherited from the component and still load-bearing: nothing has
started is **no position**, not station one; and an index outside the stations
is treated as absent rather than clamped, because a clamp invents a position
too.

## 3. What only a render could find

Every item here passed typecheck, lint and tests, and was wrong on screen.

**`@layer components` does not lose to utilities here.** Tailwind v3's
`@layer` is build-time bucketing, not native CSS cascade layers, so
**specificity decides**: `.builder-portal-theme .luxury-badge` (0,2,0) beats
`.rounded-full` (0,1,0). That is what lets one rule re-skin ~40 shadcn badges
without touching a page — and it was confirmed by measuring a rendered badge
with `rounded-full` present, not by reading the spec.

**A dimension line has a natural length.** Run across a 1,550px sheet its
stations read as unrelated points rather than one measured extent, so
`bd-rail` bounds it. The class also replaces the root's `w-full`.

**Extension lines at `0.7` alpha did not survive the dark ground**, and the
setout grid at `0.05` was a rumour rather than a sheet.

**A dense rail must draw three stations, not all of them.** Seven names across
a ~500px table cell is ~70px each and *"Practical completion"* alone is twice
that, so every row overlapped its own labels. The ends carry the extent and
the current station carries the answer; the ticks still mark every station, so
nothing leaves the drawing — only the annotation.

**Buttons were omitted from the first re-skin**, which left the loudest
control on every page as a rounded pill on a sheet of square ones.
`.rounded-full` is re-exempted so avatars and icon toggles stay round.

## 4. The schedule, and what a figure owes the reader

Eight figures are **one** ruled schedule, not two four-across slabs stacked:
at 1,920px that was a 400px cell holding a single digit, and a second border
where a drawing would rule another row.

`ScheduleFigure.baseline` is **required** by the type. A bare `0` reads as a
broken page; `0` above *"Nothing waiting on you"* reads as finished. The
dashboard used to paper over this with a footnote under the whole grid, which
is an apology for a number that does not explain itself.

## 5. The title block is a revision panel

`TitleBlock` carries what a drawing sheet carries in its corner: who it is
for, under what authority, and when it was last revised. On the dashboard that
is Organisation / Access / Membership / Figures as at — all facts the page
already held and drew nowhere, on a page whose entire content is counts behind
a Refresh button.

**An absent fact is named, not dashed.** A title block's cells are fixed
positions, so a dropped cell would make the grid lie about which key a value
belongs to; `null` renders *"Not recorded"* in annotation type, because a dash
reads as a value somebody entered.

## 6. Rules the language inherits and must keep

- **Every selector is scoped under `.builder-portal-theme`**, applied by
  exactly two roots (`BuilderPortalLayout`, `BuilderAuthShell`). Nothing here
  can reach the Client, Finance or Solicitor portals, the command centre, or a
  generated report.
- **Never write a colour.** Every value resolves from the semantic tokens, so
  a tenant who retunes `--primary` retunes the whole language. A raw hex trips
  `npm run audit:style`.
- **Category B stays fixed.** The badge re-skin sets shape and type only;
  each variant's colour comes from utilities, so `success` / `warning` /
  `destructive` keep their semantic tones. A caution chip must never read as a
  brand one.
- **No `backdrop-filter` on anything that repeats.** The setout grid is one
  background-image on one container; cards take a translucent fill and a lit
  edge.
- **No component declares a font-family.** Annotation type is `--font-mono`.
- **A dialog is deliberately not caught** — Radix portals to `body`, outside
  the theme root, and a modal is the platform's surface rather than the
  portal's sheet.
- **Every hook goes above the early returns.** `BuilderConstructionDetail`
  returns early while loading and again on error; the clock the rail's extent
  annotation needs is read once, at the top, by a lazy `useState` initialiser
  — a `Date.now()` during render is impure and two renders can disagree.

## 7. The plate sheet — the builder's own houses, on the Stock List

The workhorse page of the portal rendered **zero `<img>` elements**. Every
builder's own house imagery was already discovered, de-duplicated, classified,
ranked, stored and signed, and the page showed a status word instead:
`builderStockImageUrl` was written and had no caller anywhere. So the Stock
List is a **plate sheet** now — each property is its elevation, framed like a
plate, with a ruled schedule beside it.

It is a plate beside a schedule in the portal's existing ledger rhythm, not a
photo-card grid, which is the templated answer for anything involving
property. The line work becomes the **frame** rather than the subject.

### The measurements that decided the layout

Everything below was taken by rendering the real component's DOM against the
real built stylesheet in Chromium. Four arrangements were built and measured:

| Arrangement | Outcome |
| --- | --- |
| Three columns (plate / facts / controls) | plate stack 338px, both other columns ~160px — **~180px of dead space** under the schedule on every row |
| Two columns, controls moved into the body | same void, now with a stack floating at the top of it |
| Four-cell strip beside the plate | left ~450px of the row empty horizontally **and** ~150px vertically |
| Full-width title block across the body | fixed the width, made the height worse |

The arithmetic is the constraint: 306px of picture beside a 91px address
cannot balance in a 910px column, and a **narrower** plate reduces the
mismatch, which is the opposite of what the page needs. Six stacked schedule
rows come to 216px, and `91 + 216 + 52` of controls plus the column's gaps is
**397px against the plate stack's 397** — measured, not estimated. The two
columns read as one sheet because they are the same height.

Four rules follow.

**The schedule runs DOWN the column, and its label and figure are
adjacent.** Set as a justified pair the label landed at x=634 and its figure
at x=1535 — 850px apart, with nothing between them to carry the eye. A ruled
sheet whose entries occupy the left of each rule is a ledger; a label and a
number at opposite ends of a 900px row is a table that has come apart.

**The foot STRETCHES rather than being sized.** A property whose address
wraps to two lines would otherwise open a hole of exactly that size, and a
hole is the one thing this row cannot afford. `flex: 1` on the foot and on
each schedule row means the columns match for every property, not for the
fixture.

**A row with nothing in it prints a dash and keeps its place**, which is the
convention the device comes from — a drawing with no revision prints `—` in
the REV field rather than dropping the field. A collapsing schedule would put
LAND where HOME was on the row above it. Price is the exception: "on
application" is a real state for a builder's sheet, so the leading row says
so in words rather than printing `splitPriceLine(null)`'s em dash at 1.5rem.

**Availability is a schedule field, not a loose control.** A drawing's title
block carries its STATUS. Left outside, the select sat at the foot of the row
700px from anything it related to, `w-full` drew it 908px wide, and it shared
a line with the one destructive control — the quietest thing on the plate
beside the loudest. `Remove` is now alone in the head's top-right corner,
which saved 52px of every row.

Two facts the record held and no presentation on this page ever drew:
`building_size_sqm` (the marketplace card has always shown it) and
`development_name`, which `stockItemTitle` deliberately leaves out of the
title and which is now the eyebrow — suppressed where the title falls back to
it. An empty frame is **hatched**, because 544×306 of empty box reads as a
picture that failed to load, which is a different thing from a property whose
photograph has not been found yet.

`StockPicture` was **extracted, not copied**: the Command Centre marketplace
card's fit-and-ground logic with the transport as a parameter, the same shape
as `buildCasePassportView(…, audience)`. One implementation, so the two
portals cannot come to draw the same photograph differently.

### §1 happened again, in the stylesheet

The plate sheet's first pass landed with **seventeen `.bd-*` rules nothing
rendered** — a recessive board, a four-cell masthead, and a whole second
implementation of the picture treatment (`.bd-plate-img`, `-ground`,
`-scrim`, `-empty*`) that `StockPicture` draws with utilities. Checking for
that found **eleven more already on `main`**, from the work §1 describes:
`.bd-sheet`, `.bd-sheet-cut`, `.bd-rule`, `.bd-chip`, `.bd-chip-dot`,
`.bd-card`, `.bd-ledger`, `.bd-num`, `.bd-lot`, `.bd-nav-group` and
`.bd-mark`. `bd-chip` is named in §1 as one of the three things that shipped
unmounted; `builderPortalUiMounted.spec.ts` fixed the two **components** and
could never see the class.

All twenty-eight are deleted. The primitives were redundant by construction
rather than merely unused: this stylesheet's strategy is the **re-skin**, so
`.luxury-badge` already does what `.bd-chip` was for, `.bg-card` does
`.bd-card` and `.bd-sheet`, and `thead th` / `tbody td` do `.bd-ledger` — on
the pages that exist, rather than on pages that would have had to adopt a new
class list. Two implementations of one design decision is how one of them
becomes wrong, and the unreachable one is the one nobody notices going stale.

The masthead is the one that was **designed and could not be mounted
honestly**: every count this page holds except `pagination.total` is scoped to
the PAGE (`records`, `uploads`, the availability tallies), and "48 with a
photograph" over a list of 148 is a number that means something other than
what it says.

`builderDraftingMounted.spec.ts` now fails on any `.bd-*` class the sheet
declares that nothing in `src/` applies. It asserts reachability, not quality.
Dead CSS compiles, lints, passes `audit:style` and ships — bytes in every
builder's bundle describing a page that does not exist, indistinguishable in
the source from the half that is live.

One latent bug fell out of adding the spec: two builder contract tests
`readdirSync`'d `src/pages/builder` and `read()` every **entry**, so the
`__tests__/` directory the repo's own convention asks for
(`src/pages/{admin,aml,calculators}` all have one) threw EISDIR. The sibling
readdir in the same expression had filtered to `.tsx` from the start.

## 8. The figures a builder states themselves

Reported: `Lot 324, Dapple Avenue` showed an em dash for bedrooms, bathrooms,
car spaces and home size.

**The page was right.** The record genuinely holds NULL for all four, and
drawing four dashes is what a schedule does with a fact nobody has. So the
question moved to the record, and then to the document.

**The extraction had not failed — it had refused.** Measured on the prime:

| Source | Items | With bed/bath/car |
|---|---|---|
| `pdf_text+model` | 57 | 54 |
| `delimited_table` | 957 | 299 |

All three PDF-sourced misses are the same shape: `Lot 323 "NEX 20, Dual Key
layout (Urban Nest Duo)"`, `Lot 324 "Dual key layout."`, and `Lot 1037`. A
**dual-key home is two self-contained dwellings under one roof**, so the
brochure states two sets of figures, and the model obeyed the first rule its
prompt gives it — *never invent a value* — rather than collapsing them into
one number. An earlier spreadsheet of the same lot said `4 bed / 3 bath`, a
single reading of a two-dwelling property, which is the answer that is
actually questionable.

No parser reads a fact a document does not carry. The builder can.

### Where the override lives, and why it is not the `bedrooms` column

`writablePatch` in `importStock.ts` names `bedrooms`, `bathrooms`,
`car_spaces`, `building_size_sqm` and `land_size_sqm`, and its `set()` writes
each **whenever the incoming file states anything at all**. A figure typed
into those columns would therefore survive a silent stock list and be
destroyed by the next one that speaks — the builder's deliberate correction
losing to the document it was correcting. That is exactly what a repaired
image used to suffer against a re-upload (#2347).

So the stated figures live in `manual_stats`, a column the patch does not
name, and the overlay happens on **read**. The override survives every
re-import *by construction* rather than by anybody remembering.

### Five rules

**THE OVERLAY IS APPLIED ONCE, WHERE BOTH AUDIENCES PASS.**
`applyManualStats` runs in the decorator of the builder portal read and of the
Command Centre marketplace read, both of which select the same
`STOCK_ITEM_SELECT`. Every consumer merging for itself is how two screens come
to disagree about one house, and a spec fails either read path that stops.

**THE EXTRACTION IS NEVER DESTROYED.** The document's own reading stays in its
column and is returned beside the effective value as `stated_*`, so the
override is reversible and the dialog can show a builder the reading they are
replacing. On a field the document never filled, the dialog says *"Not in your
stock list"* — which separates a silent file from a product that lost the
number, the confusion that produced the original report.

**ZERO IS A VALUE AND AN EMPTY BOX IS NOT ONE.** A studio has no bedroom and a
townhouse may have no car space, so `0` round-trips through the form, the
parser, the JSONB and the column's own CHECK. Clearing a box withdraws the
correction instead. Anything reading these with truthiness breaks both.

**A FIGURE IS REFUSED, NEVER CLAMPED.** Turning a mistyped 3000 into 99
records a bedroom count nobody stated, on a card a client reads. The form
carries `noValidate` for the same reason the server is strict: the browser
silently blocking submission with a native bubble made the server's own
message unreachable, and two validators is how one of them comes to say
something the other does not.

**THE NOTE NAMES THE FIGURES, AND SITS UNDER THE SCHEDULE** — where a drawing
puts a note, and where a builder already is when they notice something wrong.
A per-row chip would say one thing up to five times; the note names the
condition FIRST and the fields after it — *"Not specified in your stock list:
bathrooms, car spaces and home size. Supplied by you: bedrooms."* — so the
state can be read without reading the list, and two conditions are two
sentences rather than one run-on. The control beside it reads "Complete the
schedule" or "Update the schedule" depending on what is outstanding.

The first wording was reported as unprofessional and it was: *"Bedrooms,
bathrooms, car spaces and home are not in your stock list · bedrooms stated by
you"* explains and apologises where the brand's voice is **"precise, unhurried,
quietly authoritative — it states the position, names the next action, and
stops"**. "Add these figures" leant on a demonstrative and "Edit figures" named
a form rather than the record; *schedule* is the artefact a builder already
works in and the noun this portal already uses. Field names get a `prose` form
on their spec for the sentence case a bare column heading cannot carry — a row
is headed `Home`, but "home is not specified" is not English.

Price is deliberately **not** stateable here: it is the offer rather than a
description of the product, every document this pipeline reads states one, and
a builder changes it by re-issuing the stock list.

**A CONTROL'S LEGIBILITY MUST NOT DEPEND ON THE TENANT'S HUE.** This one was
reported unreadable twice. The first time it was a 144x15px caption with no
border, ground or padding — "quiet, and never a button" was the wrong call for
the only act that fills the em dashes above it, so weight now tracks what is
owed: filled where a figure is missing, outlined where nothing is. The second
time only the outlined state was wrong, and the cause is the one worth keeping:
its `.55` border over a `.12` ground with the label in `--primary` itself was
tuned by eye against the PRIME, where `--primary` is a goldenrod that carries
easily on near-black. The White-Label admin retunes it per tenant, and on the
deployment that reported it that token is a blue several stops darker — the
same alphas collapsed. Rendered side by side under that blue, a brighter border
did not fix it either: 11px of blue on obsidian is the weak part. So **the
border carries the brand and the label is `--foreground` ink**, which holds at
any hue a tenant can choose, and it reads better on the prime too. Anything
tuned against one `--primary` is tuned against one tenant.

### Three things found by looking

`price_display` arrives as `"$863,850 *"` — builders footnote their own
sheets — so `splitPriceLine` handed the card a terms line of `*`, a footnote
marker whose footnote is on a page the card does not have. A qualifier with no
letter and no digit is dropped; `"* conditions apply"` survives, and the
builder's line is still on `title` in full.

And CI ran none of this portal's frontend specs. `src/lib/__tests__/builderStock*`
was covered; `src/components/builder-portal/`, `src/pages/builder/` and
`src/styles/__tests__/` were not — so **both mount guards in §1 and §7, written
precisely because unreachable code shipped twice, were themselves never run by
CI.** `ci.yml` now names them.

And **the column's own CHECK constraint could be satisfied by a NULL.** This
one was found by probing the live constraint rather than by reading it, which
is the only reason it was found at all. A CHECK constraint **passes on NULL and
fails only on FALSE**, and the constraint opened with
`jsonb_typeof(manual_stats -> 'values') = 'object'` — where `->` on an *absent*
key is SQL NULL, so the comparison was NULL rather than false, the whole `and`
chain evaluated to NULL, and Postgres accepted the row. Every test below it was
skipped for the same reason, so none of `{"recorded_at":"x"}`, a bare `{}`,
`{"values": null}` or `{"values": [3]}` was refused.

No reader was fooled — `readManualStats` already answered null for that shape,
and the write path is one validated operation — but a constraint that does not
enforce what its own comment claims is asserted by **configuration** rather
than by **effect**, which is the failure this repository keeps paying for
(`retention_effective`, the pg_cron jobs that were never scheduled, the green
readiness readings on three tenants that had never completed a verification).

The fix is to assert the key's PRESENCE first, with `?`, which is strictly true
or false; once it holds, every dereference below it is non-NULL and each test
means what it says. Re-probed after the change: **4 accepted** (an ordinary
override, a stated zero, a half bathroom, all five fields with metadata) plus
SQL NULL, and **11 refused**. Nothing persisted — the probe ran in a block that
aborted.

Two rules follow. **A JSONB shape constraint states key presence before it
states key type**, pinned by a test that also checks the ORDER, because `and`
short-circuits left to right and a dereference above the presence test puts the
NULL straight back. And **a test that reads SQL strips the comments first** —
the migration's header quotes the broken expression in order to explain it, so
the ordering check failed on correct SQL the first time it ran.
