# The Compliance Passport, inside a partner's own portal

**Read this before touching `_shared/aml/partnerSurface.pure.ts`,
`PartnerPassportPanel`, the `enrol_partner_portal_access` operation, or the
`passport` field on `get_partner_compliance_workspace`.**

An emailed link is a delivery. A portal is a place you go back to. A partner
who already holds a portal account should not have to keep an email to re-read
a record they are entitled to rely on — so the Passport is now on their own
AML/CTF Compliance page, in all three portals, signed in.

## Why it had never worked

The machinery for this existed: the routes, the shared workspace, a
session → membership → organisation resolver, and a flag-gated nav entry in
every portal. It had never served a single partner, for **four independent
reasons — each fatal on its own** — plus a fifth that would have failed the
standard even if the first four were fixed.

| # | The fact | What the partner met |
| --- | --- | --- |
| 1 | `aml_partner_compliance_workspace` and all three `aml_partner_workspace_*` were `false` | no nav entry; *"The compliance workspace is not available."* |
| 2 | `aml.partner_portal_memberships` held **zero rows** | 403 `membership_missing`. `upsert_partner_membership` existed as an MLRO op with **no caller anywhere in the UI** |
| 3 | `builder_organisation_id` / `solicitor_firm_id` / `finance_agent_contact_id` were **null on every row** | 403 `partner_org_unmapped`. Declared by the Phase 1 migration and written by **nothing, ever** |
| 4 | `aml_partner_identity` was `false` | nothing ever forced those joins to be correct, so nobody found out |
| 5 | The workspace drew `PartnerPassportStrip` — a one-line identity strip | not the booklet, and the standing rule is that the partner's copy is *identical* |
| 6 | `create_agreement` never accepted a `partner_org_id`, so every wizard-written arrangement had **NULL** there — and `grant_access` stamps a grant only `if (agreement.partner_org_id)` | the portal looks a grant up **by organisation**, so it reported a Passport the partner held as *never shared* |
| 7 | Nothing offered a route from the emailed link to the portal, and two of the three logins **discarded the destination** | *"I cannot see anywhere the AML/CTF Compliance page is located"* |

Fault 2 and fault 3 are the interesting pair. They are the two ends of one
walk, and fixing either alone changes one refusal into a different refusal.
That is why they are now **one operation**.

## The four rules

**The in-portal document is the SAME document.** `get_partner_compliance_workspace`
returns `buildCasePassportView(admin, link.case_id, "partner")` — the same
assembler, the same composer, the same `assertPartnerSafe` boundary that
`redeem_attestation` serves to the emailed link. One record is a property of
having one implementation, not of two implementations agreeing. A
portal-specific projection must never be added: it is how "identical" quietly
stops being true.

**Turning the Passport on NARROWS the page.** The shared workspace carries
eight panels chosen by a static per-portal adapter rather than by a flag, and
several would render and then refuse because their own write flags are off. So
`aml_partner_passport_view` resolves the surface to `passport_only` unless
`aml_partner_workspace_full` is also on:

| passport | full | the page is |
| --- | --- | --- |
| off | off | **full** — today, byte for byte |
| ON | off | the Passport, and only that |
| ON | ON | full, Passport included |
| off | ON | full — today |

The `off/off` row is the safety property: `passport_only` is not reachable by
omission, so a deployment already running the workspace cannot lose panels by
installing this. And the mode is a **mask over the adapter, never a
replacement for it** — every panel resolves as `full && adapter`, so a portal
that never permitted a panel can never acquire one.

**Enrolment maps a REAL portal identity and never re-points a binding.**
`enrol_partner_portal_access` reads the portal organisation from the portal's
own records — the builder membership table the session resolver itself walks,
`solicitor_portal_users.firm_id`, `finance_portal_users.finance_contact_id` —
rather than taking it from the request body, because a body that could name
the organisation could bind a partner to one they do not belong to. If the
canonical organisation already names a *different* portal organisation it
refuses with `portal_org_conflict`: re-pointing would change which partner
every existing portal account speaks for, retroactively, across every matter
they hold. The membership is written `active` immediately — the MLRO has
already decided this partner may rely, and an `invited` state that nothing
promotes is one more silent lock-out.

**Whether the document may be shown is never the page's decision.**
`passportDisclosure` answers it from the grant and the attestation — revoked,
lapsed, superseded, flagged for refresh — in the one module both paths use.
And a withheld Passport **renders its reason**: a partner can be correctly
enrolled, correctly linked and still have nothing to read, and an unexplained
blank area reads as a broken page.

## The access token is gone from the Command Centre

The raw bearer token and the `/passport/<token>` link are the **same
credential** — the link is that token with a URL around it — and the only
consumer in this platform is the public page, which reads it back out of the
URL. Showing it a second time doubled the places a live credential was copied
and invited an operator to send "the code" instead of the link, which is a
defect this product has already had.

If machine access is ever wanted, minting an API credential belongs on the
partner organisation record as a deliberate act with its own audit trail, not
as a by-product of every human hand-over.

## Repairing a partner enrolled before this existed

Nothing back-fills the binding, and nothing should: deriving which builder
organisation a canonical partner means, from a name, is exactly the guess the
session resolver refuses to make. The path is to **re-run the onboarding** for
that partner with the existing organisation and the existing portal contact
selected. Every step is idempotent — the organisation is reused, the
arrangement is reused, an existing case link is accepted — and
`enrol_partner_portal_access` binds whatever is missing and reports it on the
final screen.

## Tests

- `src/lib/aml/partnerSurface.test.ts` — the narrowing, the adapter ceiling,
  the disclosure vocabulary, and that the flags migration is additive.
- `src/components/partner-compliance/__tests__/partnerPassportInPortal.test.tsx`
  — **rendered**, under all three portal adapters: the booklet draws, every
  unreviewed panel is suppressed, full mode is unchanged, and a withheld
  Passport states its reason.
- `src/components/aml/__tests__/partnerOnboardingDelivery.test.tsx` — the
  wizard maps a real portal id, `active`, and a failed enrolment never blocks
  the grant.

## From the emailed link to the portal

A link is a delivery; a portal is a place you go back to. `redeem_attestation`
now returns a `portal_handoff` and the page renders **View in your portal**,
and the grant email carries the same offer — which is where a recipient
decides whether to keep the message at all.

Three rules carry that half.

**A door that refuses is worse than no door.** The offer appears only when the
surface is enabled *and* the organisation has an active membership somebody
could sign in with. Sending a partner to a page that answers *"your account is
not enrolled"* is worse than the link they already have: it reads as a broken
product rather than an unconfigured one. All three "unavailable" reasons —
`no_portal`, `surface_disabled`, `not_enrolled` — render nothing at all,
because each of them describes *our* configuration, not the partner's business.

**A deep link is a destination, never a credential.** The path carries
`?matter=<partner_case_link_id>`, which identifies a matter and grants
nothing: the portal session re-derives the organisation and a matter belonging
to somebody else is simply absent from the directory. The Passport token must
never appear in a portal URL — a bearer token in an address bar survives in
history, referrers and screenshots. A matter the partner no longer holds falls
through to their compliance page rather than to an error.

**A destination survives the login, and only an internal one.** The Builder
guard recorded `location.pathname` and dropped the query string, then its
login ignored the record entirely and always landed on the dashboard; the
Solicitor guard recorded nothing at all. Finance was already correct and is
the reference implementation. `returnToPath` and `safeReturnTo` are now one
rule for all three — and `safeReturnTo` refuses anything absolute,
protocol-relative or carrying a control character, because an open redirect on
a login page is a phishing primitive and the person who has just typed their
password is exactly the one you can send anywhere.

## The pointer that made every grant unreachable

`grant_access` stamps `partner_org_id` on a grant only when the **arrangement**
carries one, and `create_agreement` only ever recorded a free-text
`partner_org_name`. So the written arrangement and the canonical organisation
were two records that never pointed at each other, every grant the onboarding
wizard produced carried NULL, and `loadOrgGrantAndAttestation` — which looks a
grant up **by organisation** — answered "no grant" for a partner who plainly
held one.

Three parts fix it, and none of them guesses:

- `create_agreement` accepts a `partner_org_id`, validated for existence,
  status and a **matching organisation type** — an arrangement that names one
  kind of partner and points at another is a mapping error that would surface
  as a disclosure.
- `bind_agreement_organisation` repairs an existing arrangement. It is an
  explicit MLRO act on two named ids, never a name match (two organisations
  may lawfully share a name — that is what the mapping review is for), and it
  **binds once and refuses to re-point**: re-pointing silently moves every
  grant that arrangement has ever issued.
- The **read** path accepts either explicit route — the grant's own column, or
  its arrangement's. Two queries rather than one interpolated `.or()`, which
  is the defect class this codebase has a contract test for.

## Turning it on

`20260828140000_aml_enable_partner_passport_surface.sql` enables the master
switch, all three surface flags and `aml_partner_passport_view`, and
**deliberately leaves `aml_partner_workspace_full` off** — asserted with a
`RAISE EXCEPTION` rather than assumed, because enabling it there would be a
silent rollout of seven unreviewed panels. It touches no write flag: a partner
reads, and records nothing. Reversible by setting the five keys back to false.

The nav entry is now called **AML/CTF Compliance** in all three portals — the
same words the email and the Command Centre use, so a partner following an
instruction finds what they were told to look for.

## The eighth fault: the page asked a question a partner cannot ask

Everything above shipped, the flags went on, the email carried "Open it in
your Finance Portal", the partner was **fully enrolled** — membership active,
`finance_agent_contact_id` cross-referenced, arrangement bound, matter linked,
the session cross-check passing — and the page still said:

> The compliance workspace is not available.

`usePartnerWorkspaceFlags` gated the page and the nav entry on
`supabase.from("feature_flags").select(...)` **from the browser**. That read
can never work for a partner:

- `public.feature_flags` grants SELECT `TO authenticated`.
- A Finance, Builder or Solicitor portal user is **not a Supabase-auth user**.
  Their identity is that portal's own cookie or token session; the browser's
  Supabase client is anon.
- RLS does not error on a role that matches no policy. It **filters**. The
  query returned `[]` with HTTP 200, `error` was null, and every flag coerced
  from `undefined` to `false`.

So every partner in every portal was told the page did not exist, however the
database was set — and the nav entry never rendered, which is what *"I cannot
see anywhere the AML/CTF Compliance page is located"* actually was.

**This is the third surface in this repository to hit that exact trap.**
`useAmlV3Flags` and `useBuilderStockMarketplaceFlag` both carry a header
comment describing it, and both were fixed the same way. The rule they state
is the rule here: **read through the server, not the table.**

Three rules now carry it.

**One authority decides whether a partner may see the page.** The portal
pages no longer gate at all — they mount the workspace, and the server
refuses the operations on its own terms and says so in its own words. A
second authority in front of the first is what produced a page announcing
itself unavailable while the server was ready to serve it.

**A failure is never cached, and never reported as "off".** `unknown` is a
distinct answer from `false`. It hides a nav entry — an entry that leads
nowhere is worse than none — but the Command Centre says *nothing* rather
than claiming the surface is switched off, and the next mount asks again.

**A closed page explains itself and leaves the emailed link standing.** A
partner who followed a link from an email and landed on one grey sentence
cannot tell whether the product is broken, whether they are in the wrong
place, or what to do. The closed state now names the situation and says the
emailed link still works and their own obligations are unaffected.

`get_partner_surface_availability` answers it server-side with no session. It
discloses nothing — whether a page exists is what the navigation shows anyway
— and it reports the page and the document **separately**, because a page
with a withheld Passport is a real state and must not read as no page at all.

## The filing cabinet

A partner accumulates Passports. A broker acts on many purchases, a builder
sells many lots, a conveyancer runs many matters, and every one of them can
carry a Compliance Passport. The page showed them as a row of chips labelled
**"Matter …6a5a49"** — the last six characters of a `partner_case_links` row
id, rendered as a lone blue tag that reads as a stray label rather than a
control. It names nothing a partner recognises and it does not survive ten
matters, let alone fifty.

It is a searchable list now: one row per matter, ordered by usefulness —
readable Passports first, then the ones waiting on the issuing organisation,
then the ones that have ended. The search box appears only once there is
enough to search.

**The rule underneath it is a disclosure rule.** A partner is told whose
record a matter is ONLY where they may read that record. The customer's name
and the case reference are printed on page one of the Passport, so naming
them on a disclosable matter tells the partner nothing they cannot already
read; naming them on a withheld one — never shared, withdrawn, lapsed — would
be a **new disclosure made by a list rather than by a decision**.

That is enforced server-side: `subject_label` and `case_reference` are simply
not sent for a matter whose Passport is not disclosable, decided by the same
`passportDisclosure` the document itself goes through. The browser cannot leak
it by rendering the wrong field, and — the part worth stating — **the search
box cannot be used to probe for a name that is not on screen**, because the
haystack is built from what was rendered.

Three smaller rules travel with it. The **partner's own reference leads**:
their purchase file or legal matter number is what they filed the matter
under, and the issuing organisation's case reference is a foreign key to
them. A **status chip appears only when the state is not the ordinary one** —
"Passport available" on every row is the same noise the operator-facing lists
were criticised for. And the directory is enriched in **three batched
queries**, not one per matter: fifty matters must not cost a hundred and fifty
reads.

## The page is centred — and width is readability, not decoration

It was a `max-w-3xl` column pinned to the left of a 1900px viewport with a
two-up booklet inside it. The document is the subject of the page, so the
container is centred and sized for that spread, and on a wide screen the
matter list sits beside it — sticky — rather than above it. Below `lg` the two
stack, list first.

`max-w-6xl` fixed the pinning and left the second half of the complaint
standing: a third of a wide screen unused, and the booklet still drawn small.
The container is `max-w-[92rem]` now and the board `h-[min(84vh,1180px)]`, and
those two numbers are not styling. `bookletGeometry` **fits the spread to the
box it is given** — two leaves side by side once the board is about 605px
wide, and larger with every pixel after that up to its 1.15 cap — so container
width and board height convert directly into legible document. The same
booklet had twice been reported as too small to read.

All three portals get this from the one shared workspace; the only per-portal
difference is what each calls a matter (`ownReferenceLabel`: File, Contract,
Matter).

## The magnified document has to be movable, and had nothing to move it with

The reader can enlarge the booklet past the space it is fitted into — that is
what the magnification is for. Doing so severed the right-hand leaf at the
dialog's edge, pushed the turn bar off the bottom, and offered a scrollbar on
neither axis. Reported from the Command Centre at 125%; it was worse than
reported, because the same fault crops the document at **100%** on a short
window or a phone.

**The cause is a percentage height that could not resolve.** The scroll
container asked for `h-full`. A percentage height resolves against the
containing block's height, and the box holding it is a flex ITEM whose height
comes from the flex algorithm rather than from a declared length — so
`height: 100%` computed to `auto`, the scroller grew to its own content
(measured in Chromium: **1,553px inside a 667px box**), and `overflow: auto`
had nothing left to clip. The board spilled past the dialog, which clips it.
The horizontal scrollbar was not missing; it was 1,553px down, off the bottom
of the screen. Making the holder a flex column and giving the scroller
`min-h-0 flex-1` takes percentage resolution out of the path entirely, and it
keeps working where the holder has no bounded height at all — the Client
Portal mounts the viewer on an ordinary page, and there the box still grows
with its content and the page scrolls.

Four rules carry the rest.

**Centring is done by auto margins, never by `justify-content`.** Centring a
box wider than its container pins it at a negative offset no scrollbar can
reach, so the start of the document becomes unreachable; an auto margin takes
the free space when there is some and collapses to zero when there is not.
That is one layout for the fitted document and the magnified one, which is
also what makes the overflow measurement below trustworthy — `scrollWidth` on
a centred box reports half the overflow.

**Whether there is anywhere to pan is asked of the DOM.** It used to be
`zoom > 1`, which is neither necessary nor sufficient: the fit has a
`MIN_SCALE` floor, so a short window draws a leaf larger than its space at
100%, while one leaf at 125% in a wide dialog still fits and was being shunted
into the corner for a pan nobody needed. Carrying the measured box on
`BookletGeometry` instead looks like the obvious repair and is not: where the
container is content-sized, the box the board is measured against is the box
the board itself produces, the two settle a frame apart, and the flag flaps
while nothing on screen moves. `scrollWidth`/`scrollHeight` against
`clientWidth`/`clientHeight` is the same question with no second definition of
it, so `BookletZoom.overflows` is **gone** rather than left to be believed.

**A hidden affordance is no affordance.** The board is dragged, like every
other document viewer a person has used, with a grab cursor while there is
somewhere to go; the scrollbars are drawn in the document's own gold on its
own navy, because the platform default is either browser chrome bolted onto a
navy dialog or — where the browser uses overlay scrollbars — nothing visible
at all until something has already been scrolled.

**And the arrow keys mean what they mean where the reader is standing.**
Inside a magnified board they pan, because a scroll container a keyboard
cannot reach is a scroll container half these readers do not have; everywhere
else they still turn the page, and Previous / Next and the page chips turn it
from anywhere.

One viewer serves the Command Centre dialog, the emailed public link, the
Client Portal and all three partner portals, so this reaches every surface at
once — which is the point of there being one.

## The nav entry sits under the Dashboard

In all four portals — Finance, Builder/Developer, Solicitor and the Client
Portal — the compliance entry is the **second** item, directly under the
Dashboard. It was last in every one of them, below Earnings and Reports & KPIs
in Finance and below Settings in Solicitor.

Position is the point: a partner arrives here from an email about a live
purchase and has to find the page again a week later without that email. At
the foot of a twelve-entry sidebar it reads as an appendix; it is the record a
settlement now depends on.

`portalNavPlacement.test.ts` pins the **position and nothing else** — Dashboard
first, compliance second, exactly once. Asserting the whole array would make
that test about navigation in general, and it would be rewritten rather than
consulted the next time an entry is added.

The Client Portal's entry is deliberately still called **"Identity &
Compliance"**, not "AML/CTF Compliance": that portal's reader is the customer
proving who they are, not a partner relying on somebody else's diligence, and
putting a reporting entity's vocabulary in front of the person being verified
is a different defect. Moving a tab is not the moment to introduce it.

## The standing responsibility banner is gone

Every partner portal used to open with a shield-iconed alert titled **"Your
organisation remains responsible"**, carrying `RESPONSIBILITY_NOTICE` on every
state of the page including the denial. It has been removed, and the reason it
is safe to remove is the reason it was redundant: **a partner reaches this
page only through a signed written CDD arrangement carrying exactly those
acknowledgements.** The banner restated something already agreed, to the same
organisation, on every visit.

Three things make this a chrome change rather than the removal of a notice.

**The statement survives on the document.** `PartnerPassportPanel` says it
directly above the booklet (`data-testid="partner-reliance-notice"`), the
Passport's own reliance page carries it, and it is asserted there — including
in `passport_only` mode, so narrowing the page can never take it off the
screen. Attached to the record it qualifies it is read; repeated as page
furniture it was not.

**The control it is not is untouched.** `IndependentAssessmentForm` still
requires the acknowledgement to be ticked before a partner's own CDD
determination is written down. Removing a notice must never remove a control.

**`ResponsibilityNotice.tsx` is deleted, not unmounted.** A dormant component
is one import away from putting the banner back. `RESPONSIBILITY_NOTICE`
itself stays exactly where it was — in `_shared/aml/partnerWorkspace.ts`, sent
on every workspace DTO — because the wording is the server's and nothing about
what the server asserts has changed.

What an adapter may still contribute is its **portal's own context**
(`responsibilityIntro`: what this workspace does and does not claim about that
portal's organisations). It moved into an "About this page" disclosure in the
header — closed it costs no vertical space, and the old rule holds more
strictly than before: an adapter *adds* context and can never supply the
statutory wording, which now belongs to a component no adapter can reach.

## The viewer's chrome — one CSS declaration, nineteen buttons

Two things were reported on the booklet: the turn bar's page title truncated
to **"Identity Ver…"** with its page count wrapped onto three lines and running
under the Next button, and a zoom control nobody could find.

The first has a single cause, and it is not in `PassportBook`.
`.passport-action` declared `width: 100%`. `.w-auto` — the Tailwind utility
**every one of the nineteen call sites pairs it with** — is also a single-class
selector, so specificity ties, source order decides, and `passport-tokens.css`
is imported last. The utility lost, everywhere, silently. There is not one
`passport-action` in the product that omits `w-auto`, which is what makes the
declaration wrong by unanimity rather than by judgement.

Measured in Chromium against the built stylesheet, at a 1200px board:

| | before | after |
|---|---|---|
| ← Previous / Next → | 535px each | 116px each |
| page-title column | 74px, 165px of text clipped | 173px, complete |
| turn bar's centre block | 50px tall (wrapped) | 35px |
| a Command Centre action row | 3 stacked lines, 124px | 1 line, 36px |

That last row is the part worth noticing: **every** `flex flex-wrap` action row
in the Passport surface — the Command Centre's "Open digital passport / Open
case", the share dialog's buttons, the request-information chooser — was one
full-width button per line. Removing the declaration is the whole fix, in every
portal and the Command Centre at once.

Dropping it does not unstretch anything that wanted to stretch:
`.passport-action` is a flex container, so a button inside a `flex-col` still
fills the column under the default `align-items: stretch`. What changed is
exactly the case that was broken — a button in a ROW.

The turn bar is now a **grid** rather than three flex items. `justify-between`
centres nothing, it only pushes; three columns with equal outer fractions put
the title on the true centre line whatever the two labels measure. The title is
sized to its content and **never truncated** — naming the pages a reader is
looking at is worth nothing if the name does not fit.

The magnification cluster was four chips in the page-number row, in the
page-number style, at the same weight, so it read as four more pages. It now
has a hairline, a `ZOOM` label and a gold well of its own. Same four buttons,
same accessible names, same behaviour: this is emphasis, not a new control —
and the reset chip keeps full opacity when disabled, because at the fit `100%`
is a **reading**, and the shared 0.45 dimming made the one number in the
cluster the hardest thing in it to see.

One more thing that fix exposed: the one-page/two-page toggle drew a **tofu
box** in both states. U+2750 and U+25AF are outside every font this product
ships. It is a lucide icon now, and a test forbids either literal returning —
a control nobody can identify is a control nobody uses, which is half of why
the magnification was never found.

