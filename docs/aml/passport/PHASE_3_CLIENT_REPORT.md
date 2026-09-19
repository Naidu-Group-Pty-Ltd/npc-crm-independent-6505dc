# Passport Phase 3 Report — Client Portal Passport

Phase 3 gives the client their Passport: the premium booklet expression of
the same server projection, plus the journey → Passport bridge. Everything
is behind `aml_passport_client_view`; with it off, `/client/aml` is
byte-identical to before and `/client/aml/passport` shows only a quiet
return path.

## What was built

- **`src/pages/portal/PortalPassport.tsx`** (route `/client/aml/passport`,
  lazy-loaded): the booklet. Navy cover (holder, credential, status,
  version, first-issued, issuer, evidence fingerprint) + cream pages —
  Identity, Verification, Documents, Transaction (when linked), Stamps,
  Versions (when issued), Journey record. Page chips + previous/next +
  keyboard arrows; every page has a reassuring empty state; mobile renders
  the same single-page flow. The booklet is a deliberate single-look print
  world painted entirely from the scoped tokens (`passport-cover`,
  `passport-page` recipes added to `passport-tokens.css`) — paper stays
  paper in dark mode.
- **`src/components/portal/PassportPromoCard.tsx`** on `/client/aml`, under
  the status card: "Your Compliance Passport" with derived state, earned
  stamp count and a view/preview link. Renders nothing when the flag is off
  or no case exists; hardened against partial API surfaces (sync-throw safe).
- **`src/components/aml/passport/loadState.ts`** — one shared classifier of
  the server's `passport_disabled` answer, now used by both the Command
  section and the client page, so no surface can treat flag-off as an error.

## Client-safe by construction

The page renders only the `get_passport` client projection (Phase 1):
allow-listed identity, component-level verification (no provider, no
scores), document metadata, the client's own transactions, client-safe
stamps, constructed history. A page-level test renders the full booklet and
asserts the DOM never contains risk/sanction/PEP/MLRO vocabulary.

## Evidence

| Check | Result |
|---|---|
| Passport suites (8 files, 72 tests) | pass |
| Full portal + AML sweep (`src/pages/portal`, `src/lib/aml`, `src/components/aml`, `src/components/portal`) — 85 files, 1,728 tests | pass (includes the untouched `PortalAml` behaviour suite with the promo card mounted) |
| Lint on changed files | clean |
| `npm run audit:style` | ✔ under baseline |
| `npm run build` | pass |

## Test-harness note (recorded for honesty)

A mocked **rejection** rendered through the full `PortalPassport` graph is
mis-attributed by the runner as an unhandled error even when demonstrably
caught (instrumented: the catch runs once, the disabled UI renders, the
mock is called exactly once; minimal reproductions of the same state
machine, the same JSX and the same mock pattern all pass). The rejection
semantics are therefore pinned at unit level (`loadState.test.ts`) and at
render level on the Command component (same classifier, same pattern),
while the page suite covers the resolved paths. No production code path is
affected.

## Deliberate limitations

- Milestone **toasts** ("stamp added") are Phase 5 polish; the bridge card
  already shows earned-stamp progress from canonical state, with no
  frontend milestone flags.
- The client sees SoF/ownership stamps only when the issued attestation
  payload carries those facts (Phase 1 boundary decision); pre-issuance the
  client earns consent/identity/documents stamps from their own actions.
- Print/export of the booklet remains deferred (Phase 6 option).
