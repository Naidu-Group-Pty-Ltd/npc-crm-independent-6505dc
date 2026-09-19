# The Command Centre on a phone

Read this before changing a layout class on an AML surface, `AmlPageHeader`,
`AmlWorkspaceHeader`, `AmlJourneyRail`, the AUSTRAC register, or the
touch-target rules in `src/styles/utilities.css`.

Every defect below was found by rendering the real page into a real Chromium
at 390×844 and measuring the DOM — not by reading the classes. Several of
them are invisible at 390 and only appear between 430 and 768, which is why
"it looked fine on my phone" was not evidence either way.

## The module had no door on a phone

Reported from a phone as "the AML/CTF Compliance page is not populating". The
page was fine. There was no way to reach it.

`MobileSidebar` — the drawer behind the bottom bar's "More" — renders the
shared navigation registry and nothing else. The AML entry is **not in the
registry**, and correctly so: every other entry is gated by its `moduleKey`
through the capability resolver, while this one is gated by the `aml_ctf`
feature flag AND an assigned AML role, which is a different question answered
by a different endpoint (`aml-access`).

So the entry was bolted on at each surface that knew about it. The desktop
sidebar built it inline. The command palette built a **second copy**, under a
different title (`AML / CTF Compliance` against `AML/CTF Compliance`) and a
different group (`Compliance`, which no other surface used). The two mobile
surfaces were never told, so the whole module — the case register, screening,
the AUSTRAC hub, the Compliance Passport — had no entry point on a phone at
all. Typing `/admin/aml` worked; there was nothing to tap.

`sidebarNavigation.spec.ts` already existed to prevent exactly this ("no
surface may reintroduce a private navigation list") and could not see it,
because the private list was not the registry's.

**The rule: the AML entry is defined once, in `lib/navigation/amlEntry.ts`,
and every navigation surface asks for it.** The suite now fails if a surface
that renders navigation does not — and if any of them writes `/admin/aml`
into a navigation item of its own. `MobileNav` is the one exception, and an
explicit one: its bottom bar is a deliberate five-item shortlist, and
everything else on it opens `MobileSidebar`, which does ask.

It fails closed, including while the answer is loading: a navigation entry is
a claim that a page will open, and drawing one the guard then refuses is
worse than drawing none.

## "We could not check" is not "you do not have it"

The second half of the same report, and the reason a phone meets it first.

`useAmlAccess` collapsed a **failed read** into the same values the server
sends when the answer is genuinely no: `flagEnabled: false`, no roles. A
dropped connection, a fifteen-second timeout or a 5xx therefore made
`AmlGuard` announce "AML/CTF is not enabled — contact your administrator"
about a module that is enabled, for a user who holds the `mlro` role. Nothing
retried, and nothing distinguished the two.

This is the rule the partner surface already carries — *a failure is never
cached and never reported as "off"; `unknown` is a distinct answer* — applied
here. `unavailable` is now its own value:

- the guard says it is a connection problem, says nothing about permissions
  having changed, and offers **Try again**, which is the only thing that
  helps;
- the transport failure gets **one** automatic retry, and only when the
  transport marks it retryable — a 401 or a 403 is an answer and is never
  retried, and one attempt rather than a loop, because a loop against an auth
  endpoint hides an outage;
- navigation still fails closed, because a door that cannot be verified
  should not be drawn. `amlNavEntry` has no `unavailable` branch at all, and a
  test asserts it never grows one.

## One bug, three times: `flex-1` does not make a row wrap

A flex line wraps when the items' **hypothetical** main sizes overflow it.
`flex-1` is `flex: 1 1 0%`, so its hypothetical size is **zero** — it
contributes nothing to that sum. Put a `flex-1 min-w-0` title beside an
action cluster whose content is 330px wide, and the line never overflows,
never wraps, and the title is handed whatever is left. On a 430px screen that
was **eighteen pixels**, and the heading rendered 532px tall at one character
per line.

Measured on the AUSTRAC hub before the fix:

| viewport | title column | heading box |
|---|---|---|
| 390 | 324px | 28px tall — correct, by luck |
| 430 | **18px** | **532px tall** |
| 480 | 68px | 476px tall |
| 560 | 148px | 84px tall |
| 640 | 220px | 56px tall |
| 768 | 348px | 28px tall |

390 escapes because the action cluster **alone** overflows there and forces
the wrap by itself. Every width between 430 and about 740 was broken, on all
twenty pages that draw `AmlPageHeader`.

The fix is a real basis — `basis-72` — which states what the title needs
before the row is allowed to squeeze it. The same figure was already on the
case workspace header, where somebody had hit this once before. The AUSTRAC
draft page's fixed action bar had it a third time and now carries `basis-64`.

**The rule: a flex item that must not be crushed declares a basis. `flex-1`
alone is a promise about leftovers, not a claim on space.**

## `shrink-0` on a cluster is not the same as `nowrap` on its contents

The case workspace's badge cluster was `flex shrink-0 flex-wrap`. A flex item
that cannot shrink keeps its **max-content** width — here the three controls
in a single row, 418px — so on a 390px screen it hung 44px past the right
edge, "Service gate: Under review" was cut in half, and the whole workspace
scrolled sideways to reach it. Its own `flex-wrap` never engaged, because the
cluster was never made narrow enough to need it.

The badges carry `whitespace-nowrap` themselves, so letting the cluster shrink
compresses nothing. It wraps, which is what it was there to do.

Compliance Home's case rows had the same shape: a `shrink-0` badge group took
230px of a 358px row and left `Bartholome…`.

**The rule: `shrink-0` protects a cluster's WIDTH. If the things inside it
already refuse to wrap, the cluster does not need it — and with it, the row
cannot wrap at all.**

## A register with six columns is not a register on a phone

The AUSTRAC hub's table was 775px wide inside a horizontal scroller at 390px.
Status, Updated and every action sat off the right-hand edge; the Kind chip
was squeezed to 40px and set `COMPLIANCE_REPORT` one letter per line, which
made each row 150px tall. An operator could see that reports existed and do
nothing with them.

It is a list of cards under 768px now — the treatment the case register
already used, so the two surfaces read alike.

Three rules carry it.

**One layout at a time.** It switches on `useIsMobile`, the hook
`ResponsiveTable` already uses, rather than drawing both and hiding one with
`md:hidden`. A CSS-hidden copy still carries every accessible name in the
document, so assistive technology meets each report's title, its checkbox and
each of its actions **twice** — on whichever layout it is not looking at.

**One definition of what can be done to a row.** `rowActions(report, align)`
is rendered by the table cell and by the card. Two copies is how a phone comes
to offer an Approve the desktop has already taken away.

**And the reserved slot is the size of the real control.** Under 768px every
control gets a 44px minimum tap target, so the checkbox IS 44px wide there; a
slot sized for the desktop control left the one archivable row indented
differently from the three beside it.

## Database vocabulary reaches a chip faster than anywhere else

`kind.toUpperCase()` printed `COMPLIANCE_REPORT`; `status.replace(/_/g, " ")`
printed `awaiting mlro`, which spells an office's name in lower case.
`austracKindChip` and `austracStatusLabel` live beside `AUSTRAC_KIND_LABEL`
in the pure module, because a second place that decides what a report kind is
called is how two screens come to call it different things. An unmapped value
falls back to the de-underscored form rather than to nothing: a status nobody
named is still a status.

## The rail has to show you where you are standing

Ten journey stages need about 880px; a phone shows four. Clicking a step
focuses it and the browser scrolls focus into view — but **arriving** is most
of the cases and none of them focus anything: a `?stage=` deep link, the
Previous/Next stage buttons under the content, the next-action card, every
link from Compliance Home. The rail stayed parked on Activation while the
reader was on Screening, with the stage they were actually on clipped at the
right-hand edge.

`scrollLeft` is set directly rather than calling `scrollIntoView`: that method
can scroll ancestors on both axes, and moving the **page** because a strip
inside it moved is a worse defect than the one being fixed. It does nothing at
all when the rail already fits.

## A link in a sentence is not a control

`src/styles/utilities.css` gave **every `<a>`** a 44×44 box under 768px. An
inline link with a 44px minimum height stops sharing a line box with the words
around it: its text rides at the top of the box, and the line grows to 44px.
Compliance Home's one-sentence "Also in this workspace" footer set its links
14px above the label beside them and occupied 96px of a line that should be
16px. The same rule reaches every inline link in every portal on a phone.

The floor is kept for every anchor that IS a control and dropped only where
the anchor is running text (`a:not(:where(p, td, dd, dt, figcaption,
blockquote, h1…h6) a)`). Nothing loses a real tap target: the
`@media (pointer: coarse)` block further down the same file is the considered
version of this accommodation — keyed on the pointer rather than on the width,
`min-height` only, and scoped to named controls — and it is what a phone and a
tablet actually match.

## Six single-digit numbers, on a phone

Compliance Home's metric strip was `grid-cols-1` below `sm`, which turned it
back into exactly what it replaced: six full-width cells, one per row, about
900px of an 844px screen before the case list began. The cells were made dense
precisely so six single-digit numbers would stop taking that much page.

It is two across on a phone and three from `sm`. Not three at 390px: that
gives each cell about 110px, and the labels are letter-spaced capitals —
"UNPROCESSED" is wider than that and broke mid-word. Two gives about 167px,
every label wraps at a space, and the strip is still less than half the height
it was. `break-words` stays as a last resort so a longer label added later
cannot print across the cell beside it.

## `useIsMobile` answers on the first render

The state started `undefined` — false — and corrected itself in an effect, so
every one of the twenty-three surfaces that switches layout on this hook drew
its desktop form for one frame on a phone and then swapped. Reading the
breakpoint during initialisation cannot change what the hook reports after
mount; the listener still owns every later answer. It only makes the first
answer the true one, and it is guarded so an environment without `matchMedia`
behaves exactly as before.
