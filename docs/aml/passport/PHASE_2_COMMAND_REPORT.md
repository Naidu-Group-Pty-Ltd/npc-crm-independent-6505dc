# Passport Phase 2 Report — Command Centre Reference Implementation

Phase 2 ships the Command Centre Compliance Passport UI — the reference view
every later audience presentation derives from. Flag-gated end to end; with
`aml_passport_command_view` off the workspace renders exactly what it
rendered before this phase.

## What was built

`src/components/aml/passport/`:

- **`CommandPassportSection.tsx`** — the working Passport view, mounted at
  the top of the case workspace's existing `passport` section (above
  `ComplianceJourneyMap` and `ReliancePassportSection`, which keep their
  jobs). Loads `amlRelianceApi.getPassportView`; renders these states:
  - **disabled** (server 404 `passport_disabled`) → renders **nothing** —
    the flag-off acceptance rule, pinned by test;
  - **loading** → labelled progress card;
  - **error** → destructive alert with retry (never a fake view);
  - **ready** → identity strip (subject, credential, state badge, current
    version, evidence fingerprint with full-hash tooltip) + nine pages:
    Overview, Identity, Verification, Evidence, Transactions, Partner
    access, Stamps, Versions, History. Every page has a real empty state.
- **`StampSeal.tsx`** — the registry stamp face (circle/rect/seal shapes,
  five ink tones). Renders only `PassportStamp` data; no free text.
- **`PassportStateBadge.tsx`** — derived-state badge in the `AmlCaseBadges`
  convention (label always present, semantic-token tones).
- **`format.ts`** — shared en-AU date/currency formatting.
- **`src/styles/passport-tokens.css`** — the scoped `.passport-scope` token
  set (five seal inks as HSL tokens, shape/ring recipes,
  `prefers-reduced-motion`-guarded hover). No hex literals, no inline
  colours: `npm run audit:style` deltas are byte-identical to baseline.

## Decisions worth recording

- **Controls are not duplicated.** Issue/grant/revoke/manage-manifest remain
  in `ReliancePassportSection` (MLRO-gated ops that already exist); gate
  decisions remain in the Risk tab; client requests in the Requests section.
  The Passport is the resulting record — its pages say where each action
  lives instead of duplicating buttons. (§22 of the execution prompt: "Do
  not duplicate existing operational AML tabs"; §30 composite ops remain
  Phase 6 options.)
- **Stamps open their record.** Every stamp is a button whose dialog shows
  the underlying source (`aml.consents`, `aml.verification_checks`, …),
  actor, portal, timestamp and bound version — §16's attributability made
  visible.
- **The flag check is the server's answer**, not a second client-side flag
  read: the component reacts to `passport_disabled`. One authorisation
  path.
- **Demo data: none.** All content renders from the projection; the states
  battery covers not-issued/empty cases.

## Evidence

| Check | Result |
|---|---|
| `src/components/aml/passport` tests (4: disabled-renders-nothing, identity strip + credential + state, error+retry, stamps) | pass |
| Full `src/components/aml` suite (120 tests, incl. workspace redesign source contracts) | pass |
| Full `src/lib/aml` suite (1,484 + 61 passport) | pass |
| `npm run lint` on new files | clean |
| `npm run audit:style` | identical deltas to baseline (+36/+20/2) |
| `typecheck:portals` | same 5 pre-existing errors, no new |
| `npm run build` | pass |
| Full vitest | rerun at the PR checkpoint; the one non-baseline failure observed mid-phase (`marketUpdatesPremiumUi.test.tsx`) passes in isolation and is attributable to files changing under an in-flight run |

## Known limitations (deliberate)

- The booklet presentation ships with Phase 3 (client) and is then offered
  to Command as a preview; the Command working view is the operational
  expression of the same projection.
- "Preview as client" lands with Phase 3, rendering the real server-side
  client projection (never CSS hiding).
- Suspend/revoke/refresh composite controls remain deferred (Phase 6,
  separate approval); the derived states already render.

## Deployment

Ships with the Phase 1 function/migration deploy; additionally requires only
the normal frontend bundle release. Flag-enable order: deploy migration →
deploy functions → enable `aml_passport_command_view` for staff validation.
