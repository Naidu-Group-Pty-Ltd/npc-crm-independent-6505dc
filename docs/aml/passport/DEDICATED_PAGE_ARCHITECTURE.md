# Compliance Passport — the dedicated page

Rebuild of the Passport onto the approved Claude Design
(`AML Compliance Passport.dc.html`, project `a663070e-…`), as a page of its own
under AML/CTF Compliance rather than as sections grafted onto the surfaces
where compliance work is done.

## The architectural correction

The Passport had been embedded in three places on the existing AML pages: a tab
in `CaseWorkspaceTabs`, a section in the V3 `AmlCaseWorkspace`, and queue cards
on both Compliance Home surfaces. That made it read as one more tab in the
casework interface.

It is not casework. **The case workspace is where compliance work is done; the
Passport is the record that work produces.** Those are different artefacts with
different audiences, and merging their surfaces is what made the Passport feel
like a feature bolted onto a page rather than a document the platform issues.

All three embeds are removed. What stays is the destination:
`/admin/aml/passport`, in the AML nav under Customer Compliance, in **both**
shells.

### What the revert deliberately did NOT take with it

`ReliancePassportSection` and `ComplianceJourneyMap` predate this programme
(#2018) and stay exactly where they were in the case workspace. A test asserts
this, because the risk in any revert is removing the thing beside the thing you
meant to remove.

## Layers

```
supabase/functions/_shared/aml/passport/*.pure.ts   derivation (shared, Deno)
  passportState / passportStamps / passportJourney / passportCredential
  passportView          the audience assembler + fail-closed tripwire
  passportIdv           ← the IDV seam (below)
        │  re-exported by relative path
src/lib/aml/passport/index.ts
        │
src/components/aml/passport/design/
  primitives.tsx        tone pills, wax seals, field grids, record rows
  pagesJourney.tsx      00–05
  pagesRecord.tsx       06–11
  pageRegister.tsx      order, numbering, audience
  PassportBooklet.tsx   the cream-paper document view
  PassportWorkspace.tsx the shell: identity strip, rail, controls, page
        │
src/pages/aml/AmlPassports.tsx    customer picker + workspace
```

Every page is a **pure function of the projection**. No page fetches, and no
page decides what may be disclosed — the projection has already removed what
this audience may not see, so a page cannot leak by forgetting a check. Adding
a page is a component plus one line in `pageRegister.tsx`.

## The design layer

`src/styles/passport-tokens.css` **is** the visual system. Components carry no
colour. Three reasons, recorded in that file's header: the Passport is a
deliberate exception to the app's surface language and must not drift when app
tokens move; `audit:style` counts hex literals in components; and nothing in
that file escapes `.passport-scope`.

Values are HSL, matching the repo convention — the design specifies hex, and
transcribing it as hex would have moved `cssHexOutsideTokens` from 2 to 56.

The legacy `.passport-seal--circle|rect|seal` and `.passport-page*` classes are
kept verbatim at the foot of the file. They are the contract for `StampSeal`
and the **client** booklet, which is a separate, already-shipped audience
projection: restyling it as a side effect of rebuilding the Command page is
exactly the unrelated regression this rebuild was asked not to introduce.

## The IDV seam

`passportIdv.pure.ts` exists before the integration does, and it is the reason
the later wiring is an addition rather than a rewrite.

**The page never names a check type.** It asks the module what components exist
and what each means. When the live IDV workflow starts emitting richer signals
it declares them there, beside the existing ones, and the Verification page
renders them untouched.

Two rules the module carries:

- **An unknown check type returns `null`, never a default bucket.** Showing a
  check under the wrong component tells an operator that a control was
  performed which was not. Unmapped checks are counted and surfaced.
- **`disclosable: false` means presence and pass/fail only** — never a score, a
  measurement or the underlying media. `face_match` and `liveness` are marked
  false. `summariseIdv` cannot return a score because the module never carries
  one, and a test asserts its output matches no score-like key.

A component with no record is reported as `not_performed` rather than omitted:
the design shows the full control set so a reader can see what was *not* done,
which is the question an auditor asks first.

## The flag-off contract, and where it is asserted

With `aml_passport_command_view` off the server answers `passport_disabled` and
the workspace renders **nothing** — the AML module behaves exactly as it did
before the Passport existed.

That branch lives in `passportSurfaceState` (`loadState.ts`) rather than inline
in the component, and is asserted exhaustively in `loadState.test.ts`. The
reason is recorded there: a mocked rejection inside a full Passport component
graph is mis-attributed as an unhandled error by the test runner even when
demonstrably caught. Rather than leave the contract that matters most as the one
branch no test could reach, the branch was extracted into a pure function.

`disabled` beats `loading`, so no skeleton flashes on a deployment with the flag
off. A stale view alongside a fresh failure is still a failure — showing the
previous customer's record after a failed load is worse than an error.

## The booklet

The booklet is the artefact the Passport stands for, and it is composed rather
than hand-laid. `passportBooklet.pure.ts` turns one `PassportView` into an
ordered page list built from the design's block vocabulary (statement, fields,
summary, chips, matrix, rows, partners, seals, hero, timeline, verify, note,
signature, banner). `BookletBlocks.tsx` draws each block; `PassportBooklet.tsx`
draws the bound document around them.

Three properties are structural, not decorative:

- **It is bound.** Wide viewports show two facing leaves with a spine; narrow
  ones show one. A booklet that always showed a single page reads as a
  slideshow, not a document.
- **The page count comes from the data.** The design's own screenshots show 12,
  14 and 16 pages of the same document. A leaf whose records do not exist is
  not printed — an empty "Screening" leaf in a bound document reads as
  *screening found nothing*, which is a different and much worse claim than
  *screening is not part of this record*.
- **Every leaf is directly reachable**, via the numbered chips.

Composition is pure and tested (`passportBooklet.test.ts`) because page
arithmetic is the half a render test cannot see: which leaves exist, that
numerals never gap, that an odd page count does not produce an empty facing
page, and that no restricted material reaches paper.

**The QR is deliberately not reproduced.** The design mocks a scannable code
from a hash. A code that looks scannable but resolves to nothing is worse than
no code on a document a partner may rely on, so the Verify block carries the
credential ID and evidence fingerprint — what a verifier can actually check by
hand — until public verification exists.

### The cover, and why the leaf is scaled

**The passport opens on its cover.** Page 1 is the navy Aurixa board — the delta
(`/brand/aurixa-mark.svg`, the repo's existing brand asset), the wordmark, the
title, the bearer, the credential, the state and the evidence fingerprint. A
booklet whose first page is a data table reads as a report, which is the
opposite of what this artefact is. The cover is **not numbered**: numbering
starts on the first leaf, so adding or removing it can never shift a printed
numeral.

**A leaf is scaled, never squeezed.** Every type size, rule, seal and grid
inside a leaf is authored against a 470×648 box. Letting flexbox shrink that box
keeps 11px body copy and 30px seals inside a 200px-wide page — text reflows,
wraps one character per line and overflows, which is exactly what the reported
screenshot showed. The leaf now renders at its design size under a uniform
`transform: scale()`, so every internal proportion is preserved at any viewport,
and the aspect ratio is exact by construction rather than by CSS approximation.

`bookletGeometry` owns that arithmetic so it is testable without a DOM: it fits
by width *and* height (a short laptop never clips a page), caps enlargement,
falls back from a facing pair to a single leaf when two would no longer be
legible, and degrades to a usable minimum rather than collapsing on a phone.
The leaf body scrolls internally, so a long journey record can never stretch the
page out of proportion.

**The dialog must override the primitive at the same breakpoint.** This cost a
round. `DialogContent` sets `sm:max-w-lg`, `sm:max-h-[85dvh]` and
`sm:overflow-visible`; tailwind-merge treats an unprefixed `max-w-*` as a
different utility group from `sm:max-w-*`, so a plain `max-w-[1180px]` silently
lost on every screen ≥640px. The booklet rendered inside a 512px dialog, could
never show a facing pair, and — because the primitive also un-hides overflow at
`sm:` — spilled off the bottom of the viewport. There is no runtime error, no
type error and no failing render for this: jsdom has no layout, so only a
source assertion catches it (`bookletDialog.test.ts`).

The board also measures **its own box** rather than deriving a height from
`window.innerHeight`. The book is nested in a dialog whose height is itself
capped, so a window-derived guess is wrong by however much chrome sits above and
below it.

**The scaled layer is absolutely positioned, never a flex item.** This cost a
round on its own. A flex item wider than its line is centred to a *negative*
left offset, and `transform-origin: top left` then preserves that offset — so
the spread rendered to the left of the board and the left-hand leaf was cropped
against its `overflow: hidden`, while the right-hand side had room to spare.
The asymmetry is the tell: a spread that is simply too large crops on both
sides. Taking the layer out of flow removes the only thing that could displace
it, so its position is decided by one inset and nothing else.

Two supporting rules: the measured element is **padding-free**, because
measuring a padded box and subtracting a guessed padding is how the board came
to be sized larger than its container; and `BOARD_FRAME`/`SPINE` are shared by
the component and `bookletGeometry`, because a few pixels of disagreement
between the arithmetic that *fits* the spread and the arithmetic that *draws*
it is exactly what crops a leaf.

`bookletGeometry`'s contract is now explicit and property-tested: **the
returned size never exceeds the space it was given**, asserted across a sweep
of real desktop, laptop, tablet and phone dimensions. The scale is *floored*
rather than rounded, so that holds exactly rather than within an epsilon — an
exact ratio multiplied in floating point overshoots by ~1e-13, which is enough
to trip the guard and, against a pixel-rounded board, enough to shave a
hairline off a leaf.

### The cover as a record miniature

The Command record used to show a 52×70 navy rectangle with `AUX·AML` set in
it — a stand-in for the document rather than the document. `PassportCoverThumb`
replaces it with the **real** `BookletCover`, drawn at design size under the
same uniform transform the book uses for a leaf.

That is the whole design. There is no "thumbnail version" of the cover to keep
in step, because a simplified copy looks right on the day it is written and
drifts afterwards — and a customer whose miniature says one thing and whose
booklet says another has been shown two documents. `bookletCover(view)` is the
single statement of what a cover holds; `buildBooklet` calls it for page 1 and
the miniature calls it for the record. Being a pure function of the projection
also makes it per-customer by construction: nothing in the path can be
specialised to one case, so every client record shows that client's own bearer,
credential, state and fingerprint.

**The size is one number, and both the box and the scale are derived from it.**
`--passport-thumb-w` is unitless, so the stylesheet computes the slot
(`calc(var(--passport-thumb-w) * 1px)`) and the scale
(`calc(var(--passport-thumb-w) / 470)`) from the same declaration. The first
draft did not: the slot came from CSS (112px on a phone) and the scale from a
JS default of 132, and the two disagreed wherever a layout effect had not run —
a server render, the first paint, a hidden tab. A board drawn 18% larger than
its box loses its clasp to `overflow: hidden`, which is exactly what a phone
render showed. Derived together they cannot disagree, there is no JS in the
path at all, and a surface resizes the cover by setting one property.

**`.passport-cover` is a material, not a layout.** The navy leather is shared —
the partner compliance strip paints itself with it — so the front board's own
page margins live on `.passport-cover--board`. They were on the shared class
for one release, which put 58px/44px/46px of cover padding on a partner-facing
strip that had asked for `px-5 py-4`; nothing in the AML suite renders that
strip with a cascade, so no test could see it. `coverMaterial.test.ts` reads
the rules.

**One viewer, both portals.** `PassportBook` is shared by the Command dialog and
the Client Portal page. The Client Portal previously carried a second booklet
implementation — its own cover, its own page list and eight page components —
which is how the two could drift. The audience difference is already handled by
the projection, so the viewer does not need to know who is reading: the client's
booklet simply has fewer leaves, because the client's projection has fewer
sections.

## Stamps & Certifications — the page shows the whole set

The page drew earned stamps and stopped. That cannot distinguish *"this case
has one certification"* from *"this case is one of fourteen certifications
through"* — both render as a single seal on an otherwise empty page.

Production makes it concrete. Across the five live AML cases there are **0
attestations, 0 screening subjects, 0 owners, 0 source-of-funds rows, 0 EDD
cases, 0 grants, 0 assessments, 0 refresh obligations and 0 transactions**. The
best-covered case earns **two** stamps (consent + identity), three earn one,
and one earns none and shows the empty state. The page was not dropping
anything; the records behind ten of the design's thirteen stamp kinds do not
exist in this deployment. Which is precisely why the design specifies the
dashed placeholder, and why the reconciliation approved it
(`PASSPORT_DESIGN_RECONCILIATION.md`, page 10: *"Pending/dashed placeholder
stamps … render in pending style"*). It was never built.

`derivePendingStamps` closes it. Four rules carry it:

- **A pending stamp carries no record.** No `at`, no `version`, no `actor`, no
  `source` — the type has no room for them. An outstanding impression that
  looked like an earned one would assert a control that was never performed,
  which is the worst defect this page could have. It lives in its own
  `pending_stamps` field for the same reason: everything downstream that
  counts, seals or filters on `stamps` still means *earned*.
- **An event is never drawn as outstanding.** `ACCESS REVOKED` as an empty
  impression reads as a revocation the system is waiting for; `PASSPORT VERSION
  SUPERSEDED` as an outcome somebody owes. `PROGRAMME` lists the milestones a
  case works toward and excludes the rest. Sharing is excluded in the other
  direction — a Passport is complete whether or not it is ever shared, so a
  pending `FINANCE PASSPORT SHARED` would invent an obligation on the officer.
- **Nothing is shown for a dimension the engagement does not have.** An
  individual is never offered a pending ownership seal, a case with no
  transaction never a pending settlement. A closed case — or one whose service
  gate is terminated — owes nothing at all; listing what a finished file will
  never now earn reads as an open action list on a case nobody is working.
- **Applicability reads the CASE, not only its child rows.** This cost a round.
  The first version asked "does a row exist?", and in production the answer is
  no for almost everything: both live cases in enhanced CDD carry
  `status = edd_required` / `case_stage = enhanced_cdd` and **zero**
  `aml.edd_cases` rows, because the obligation is declared on the case before
  any EDD record is opened. The register was therefore silent about the one
  certification those cases most obviously owe. The declaration is now a
  first-class input — and it raises **`edd_completed` alone**. Source of wealth
  stays record-driven on purpose: it is client-visible where EDD is not, so
  letting the declaration raise it would turn the client's own Passport into an
  inference channel for a Command-only fact.
- **The audience rule is identical to the earned one.** An unearned seal
  discloses as loudly as an earned one: *"ENHANCED DUE DILIGENCE COMPLETED —
  outstanding"* tells a client they are under EDD, which is exactly what
  `client_safe` exists to prevent. `clientSafePending` uses the same flag.

Two defects surfaced while building it.

**`PASSPORT REFRESHED` did not exist.** The vocabulary had
`passport_refresh_requested` and nothing for the refresh being *done*, and both
edge functions selected only `id, created_at, status` from
`aml.partner_refresh_obligations` — so `completed_at` never reached the engine
and a finished refresh read as an outstanding request for ever. The ask and the
answer are separate facts and now have separate stamps.

**The portal caption was missing.** The design captions every impression with
the portal its record came from, which is the first thing an auditor asks about
a stamp. `StampSeal` carried `org` and not `portal`.

The booklet's Certification Seals leaf gets the same treatment. Its `seals`
block has modelled `earned: false` since it was written and had never been
passed one.

### The struck impression

`StampFace` is a transcription of `stampFace()` in the approved design file
(`AML Compliance Passport.dc.html`, project `a663070e-…`), read through
DesignSync rather than eyeballed from a screenshot.

A stamp there is **five layers**, and the face this replaced had one — which is
why it read as a coloured box rather than as something pressed into the page:

| layer | what it is |
|---|---|
| `face` | shape, rule, inset shadows, gradient wash, rotation, glow |
| `grain` | two ±38° hatchings under `mix-blend-mode: overlay` |
| `tick` | conic ticks around a circle, hairline rules on a rect |
| `inner` | a dashed inner ring |
| `watermark` | the Aurixa emblem, screened at 26% through the face |

**The watermark is the layer the design is built around and the one that was
absent altogether.** Every impression carries the mark of the system that
struck it; `mix-blend-mode: screen` is what makes it read as part of the ink
rather than a picture sitting on top. An unstruck die has no watermark —
nothing pressed it.

Two rules the design carries that are easy to get wrong:

- **Ink is decided by what the stamp SPEAKS FOR, not by a per-code palette.**
  Three inks: gold is the issuing entity's own certification, blue is somebody
  else's decision recorded in our register, green is a terminal certification
  (issued, completed). `stampFaceTone` reproduces the design's one-line rule
  against the **code** rather than the title, so a wording change cannot
  repaint a stamp, and against the issuer passed in rather than a literal, so
  it holds for any tenant.
- **The angle is fixed by position** (`[-6, 3, -2.5, 4.5, -4][i % 5]`). Struck
  impressions are never square to the page, and a random angle would move on
  every render.

The design's own shapes — rect, circle, octagonal seal — already matched
`STAMP_VOCABULARY` for all twelve stamps, so nothing about which die a
certification uses had to change.

`StampSeal` is deliberately NOT replaced. It still draws the partner
compliance strip, which is a different, already-shipped surface with no entry
in this design; restyling it as a side effect is the unrelated regression this
programme keeps being asked to avoid.

One thing the design assumes and we cannot: its `org` data is already capitals
(`AURIXA SYSTEMS`), so its CSS carries no `text-transform`. Ours is a tenant
name in whatever case the operator typed — production reads
`AML/CTF Command Centre` — so the class sets it.

### Two halves, two deploy routes

The Passport ships by **two independent paths**: the projection lives in
`aml-reliance` / `aml-client-portal` and reaches production through
`deploy-supabase-functions.yml`; the page that draws it ships with the site
build. Both are keyed to `main`.

That is worth stating because it produced a confusing hour. The functions were
deployed from a branch while the page was still `main`'s, so the API returned
`pending_stamps` and nothing rendered it — the live page still read
`{n} earned` and the pre-change note copy, which is exactly what the reported
screenshot showed. Neither half is wrong on its own; a feature that spans them
is only live when **both** are on `main`.

The page is defensive about the order (`view.pending_stamps ?? []`), so either
half may lead without breaking the other. What it cannot do is render a field
the bundle it is built from has no code for.

### What is deliberately NOT persisted

Stamps are **derived on every read** and stored nowhere — there is no stamps
table, and V1's objective is zero new Passport record tables. So "are the stamps
persisted against the passport?" has a deliberate answer: no, and persisting
them would be the defect. A stored stamp can outlive the record that justified
it; a derived one cannot. The provenance a reader needs travels on the stamp
(`source`: table + id), and the record behind it is the only thing that can be
stale.

The same choice is why refresh, re-login and redeploy are consistent by
construction: there is no cache to invalidate and no write to miss.
`PassportWorkspace` fetches on mount keyed to `caseId`, and both flags
(`aml_passport_command_view`, `aml_passport_client_view`) have been on in
production since 2026-08-13.

## Connected portals, not a portal switcher

The design's top chrome switches the view between Command, Client, Finance,
Solicitor and Builder. That is a prototype affordance: each portal is a separate
authentication domain with its own cookie and its own server-side projection.
There is no session in which one operator is all five, and a Command-side "view
as client" rendering the client projection from Command data would show a
*simulation* of the boundary rather than the boundary.

The strip keeps what the design was communicating — which portals hold this
Passport and what each has done with it — and drops the impersonation. Rows are
derived from real grants (`portalRows.ts`), so a portal never appears for a case
it was not shared with.

## Still deferred

Unchanged from `DESIGN_CONFORMANCE_AUDIT.md`: QR/public verification, client
biometric portrait, per-document partner ACLs, four-eyes authorisation,
printable booklet PDF, identifier unmask-with-reason, Command preview-as-client,
and notification-drawer passport events. The booklet is a single-leaf reader
rather than the design's two-page bound spread.
