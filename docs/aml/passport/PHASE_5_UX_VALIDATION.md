# Passport Phase 5 — Journey UX Validation

A persona-by-persona walkthrough of the integrated experience as built
(code-level review; the interactive staging pass belongs to the UAT step in
`docs/aml/rollout/`, which this programme does not claim to have performed).

## Persona walkthroughs

**Client.** `/client/aml` is unchanged until the flag turns on; then the
promo card appears under the status card: state, earned stamps, one link.
The booklet opens at the cover (their name, credential, status), pages match
what they have actually done, empty states explain what comes next, and the
journey record shows their own history in their own vocabulary. Nothing on
any client surface names screening, risk, funding review or partner
internals. Progress figures on the AML page remain the canonical
`portalProgress` derivation; the promo card intentionally shows state +
stamp count rather than a second percentage, so no divergent numbers exist
on Passport surfaces. (The pre-existing `AmlComplianceCallout` divergence on
the dashboard is unchanged — out of Passport scope, recorded in the
integration review as a defect to fix separately.)

**Analyst / Reviewer.** The case workspace is unchanged everywhere except
the `passport` section, where the resulting record now sits above the
journey map and sharing panel. Sections say where actions live rather than
duplicating buttons, so there is no second place to do the same thing.

**MLRO.** Issuance, grants, revocation, manifests stay in the Compliance
Sharing panel with their existing gates; the version register and partner
page now make the consequences of those actions visible (versions, who
holds what, who viewed when, decisions recorded).

**Finance / Solicitor / Builder partner.** The workspace they already have
gains the Passport strip: what they hold, which version, its lifecycle
state, their own recorded decision as their seal, and the warning when
their decision predates the current version. Acknowledgement remains the
existing responsibility-acknowledged determination flow — one decision
channel, now visibly stamped.

## The §43 questions

- Duplicate actions: none added — every Passport surface is read-only.
- Contradictory statuses: structurally excluded — one server derivation
  (`passportState.pure.ts`) feeds every surface; the client cannot see a
  different state from Command because neither computes one.
- AML terms exposed to clients: the client projection is allow-list built
  and tripwire-checked; the booklet test asserts the rendered DOM carries
  no internal vocabulary.
- Returning to unfinished work: the AML page's existing resume behaviour is
  untouched; the booklet links back to the journey; open requests surface
  on both.
- Versioning understandable: version register (Command), version chips +
  plain-language immutability note (client), version + refresh warning
  (partner).
- Refresh understandable: derived caution states with explanatory copy on
  all three surfaces; never a silent failure.
- Journey ↔ Passport continuity: the promo card narrates "each step adds to
  your Passport" from canonical state; stamps are the same objects across
  Command and client.

## Known polish deferred (Phase 6 candidates, separately approved)

Milestone toasts on step completion; Command "preview as client" rendering
the real client projection; printable booklet PDF via WeasyPrint; composite
suspend/revoke controls; identifier unmask-with-reason flow; enhanced
version-diff ("what changed") from v2 reason codes.

## Final non-regression position

Recorded in the phase reports: full-suite failing set identical to baseline
after Phases 0–2 (verified twice); Phases 3–4 verified against the portal,
AML, partner and adapter suites (1,760+ tests green), lint clean on changed
files, style ratchet under baseline, production build green. Deno-level
checks and the interactive UAT remain CI/staging responsibilities.
