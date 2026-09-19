# AML/CTF Command Center — UI/UX enhancement

Companion to the current-state audit in
[`ui-ux-audit.md`](./ui-ux-audit.md). Branch
`claude/aml-ctf-command-center-ui-mcrchp`, based on `origin/main`
@ `84c5304832bdcc2755ae588109b1a024141531a5`.

This was a **frontend presentation change only**. No migration, Edge
Function, permission, feature-flag value, retention rule, evidence-access
rule, outbox behaviour, attestation/disclosure behaviour, service-gate
behaviour, API contract or route changed. Both AML navigation
configurations (V2 legacy and V3) ship exactly as before; every V3 flag
still defaults to `false`.

## Design principles

1. **One shape per job.** One page header, one metric tile, one refresh
   action, one empty/error/loading language, one badge vocabulary for
   stage / risk / service gate — everywhere in the module.
2. **States are honest.** Loading, a real zero, "not available" (a failed
   or absent source) and permission-restricted are four different things
   and render differently. A restricted metric is *omitted*, never
   placeholdered (tipping-off protection).
3. **Counts are doors.** A metric that counts a queue links to the queue,
   filtered the way the count was computed (`/admin/aml/cases?view=…`).
4. **Status is never colour alone.** Every badge carries its label text;
   tones come only from the fixed semantic tokens
   (success/warning/destructive/info/muted).
5. **The next action is visible.** Empty states say what fills them and
   offer the action; the workspace leads with "next best action";
   destructive transitions are grouped apart and confirmed with a
   recorded reason.
6. **Presentation may not touch behaviour.** The primitives take no data
   dependencies and make no permission decisions; capability gating stays
   in the pages and `AmlGuard` stays authoritative.

## Primitives introduced (`src/components/aml/primitives/`)

| Primitive | Job |
| --- | --- |
| `AmlPageHeader` | title tier (h2 in-shell, h1 outside), description, icon chip, actions slot |
| `AmlPageSection` | labelled region with heading for grouped content |
| `AmlMetricCard` | KPI tile with explicit `loading / ready / unavailable` states and optional deep link |
| `AmlRefreshButton` | labelled refresh with in-flight state |
| `AmlLoadingState` | announced (role=status) skeleton/spinner variants |
| `AmlEmptyState` | dashed actionable empty (icon, title, body, action) |
| `AmlErrorState` | destructive alert: what happened, whether work is safe, retry |
| `AmlAccessGate` | centred no-access state (copy varies, layout doesn't) |
| `AmlTableLoadingRow` / `AmlTableEmptyRow` | loading distinct from empty inside tables |
| `AmlStageBadge` / `AmlRiskBadge` / `AmlGateBadge` | the shared case-dimension vocabulary from `caseDimensions.ts` |

`StatusBadge` (`src/components/ui/status-badge.tsx`) remains the pill for
generic lifecycle statuses; the case badges wrap the case-specific
vocabulary so every surface grades stage/risk/gate identically.

## Surfaces enhanced

- **Shell (`AmlLayout`)** — workspace › section context trail; labelled
  `Select` navigation below `md` (usable at 320 px, no wrapped tab stacks,
  no horizontal-only interaction); visible focus rings; correct
  `aria-current` derived from the workspace path groups (previously
  NavLink's URL-prefix logic marked Compliance Home current on every
  subpage). Deliberately **not sticky**: the case workspace pins its own
  rails and a sticky shell header would stack with them on short laptops.
  `LEGACY_WORKSPACES` / `V3_WORKSPACES`, capability filtering and all
  routes are unchanged.
- **Compliance Home (V3 + V2)** — header with refresh and last-updated;
  dominant next-best-action panel; priority work queue ahead of metrics;
  metrics grouped by purpose ("Customer pipeline", "Monitoring & finance
  operations") with deep links per tile; explicit unavailable states with
  retry (monitoring failures were previously silent dashes);
  `PartnerOpsQueueStrip` unchanged (fail-closed).
- **Case register (`AmlCases`)** — one toolbar (search with explicit
  action, status, risk); active-filter summary with clear-all; result
  count including truncation ("first 100 of N"); table skeletons; inline
  retryable error; `th scope="col"`; shared badges in table and mobile
  cards; mobile cards show stage/risk/gate in text with a large target;
  saved views addressable via `?view=` (new optional param — all existing
  deep links unchanged). New "Onboarding" saved view backs the home's
  onboarding tile.
- **Case workspace (`AmlCaseWorkspace`)** — selected section lives in the
  `?section=` URL param (deep links, refresh, back/forward); progress
  rail with a highlighted current step and larger targets; three-column
  layout defers the action rail to a full-width row at `lg` so 1024 px
  laptops keep a usable content column; action panel separates
  progression / attention / destructive transitions with confirmation and
  required reason (mirroring the legacy dialog); labelled section
  loading. Tab business components (`VerificationTab`, `ScreeningTab`,
  `RiskTab`, `OwnershipControlTab`, `FundingFinanceTab`, `TimelineTab`,
  `AuditTab`) untouched. The flag-off redirect to
  `/admin/aml/cases?open=<id>` is preserved, as is the legacy dialog.
- **Operational/admin pages** — Monitoring, Investigations, AUSTRAC Hub,
  Records & Retention, Screening, Verification, Risk, Transactions,
  Funding & Finance, Governance, Launch Operations, Partner Operations,
  Integration Health, Counterparty Due, Configuration: unified headers,
  labelled refresh, loading rows distinct from empty rows, actionable
  empty states, one access-gate shape, `scope="col"` + table labels,
  aria-labels on all icon-only actions, stat grids out of header rows,
  viewport-relative scroll panes, shadcn `Select`/`Checkbox` replacing
  raw elements where the swap was trivial. Integration Health's "Failing"
  badge no longer renders a check-mark icon. Readiness copy still
  distinguishes source-exists / configured / environment-verified /
  unknown-not-verified.

## Microcopy rules applied

Plain operational language ("Awaiting decision", "Additional information
required") with legal terms kept verbatim (AML/CTF, AUSTRAC, CDD, EDD,
MLRO, SMR/TTR/IFTI). Error states say what happened and what to do next.
Copy never prints feature-flag names, environment-variable names, role
taxonomies or capability identifiers (enforced by
`amlUiDisclosure.source.test.ts` and the new
`amlUiEnhancement.source.test.ts`).

## Responsive rules

- The shell collapses both nav rows into labelled Selects below `md`.
- Tables scroll only inside the shared table wrapper; no page-level
  horizontal overflow.
- Metric grids: `grid-cols-1/2 → sm/md/lg` steps; header stat clusters
  never share a flex row with the title.
- Fixed pixel heights on scroll panes became viewport-relative
  (`h-[60vh] min-h-[320px]`).
- The case workspace is 1-column below `lg`, 2-column (nav + content) at
  `lg`, 3-column from `xl`.
- A sticky register table header was **not** added: the shared `Table`
  wrapper owns `overflow-x-auto overflow-y-hidden`, and changing that
  cross-portal primitive was out of scope. Recorded as a follow-up.

## Accessibility decisions

- Heading order: shell owns the only `h1` (Integration Health, outside
  the shell, renders its own); pages use `h2`, sections `h3`.
- `aria-current` on both nav levels reflects the workspace grouping.
- All loading states are announced (`role="status"` with labels); the
  register/home counts update via `aria-live="polite"`.
- Status badges always carry text; rail states carry icon + sr-only text.
- Icon-only buttons all have accessible names; tables have
  `aria-label`/`scope="col"`.
- Focus is visible on nav links, register rows and mobile cards;
  destructive confirmations use the focus-trapping `AlertDialog`.
- Native `confirm()`/`prompt()` flows on Monitoring were left in place
  (non-trivial capture flows) — follow-up below.

## Preserved business/security boundaries

- `AmlGuard` and step-up enforcement byte-identical.
- Legal transition maps (`NEXT_STATUSES`) unchanged and still mirrored by
  the server; grouping is visual only.
- Restricted metrics/sections/actions render nothing (no placeholders).
- `?open=`, `?tab=`, `?activateClientId=` contracts intact (source-test
  pinned); `?view=` and `?section=` are additive optional params.
- Exception-case creation remains MLRO-only with recorded reason.
- Readiness wording never equates source presence with deployment.
- The standalone Developer Portal remains fail-closed; no route exists
  (source-test pinned).

## Test matrix

New suites (all Vitest + Testing Library, same patterns as the existing
AML tests): `amlLayout.test.tsx` (9), `amlPrimitives.test.tsx` (11),
`amlComplianceHomeV3.test.tsx` (8), `amlCases.test.tsx` (11),
`amlCaseWorkspace.test.tsx` (8), `amlUiEnhancement.source.test.ts` (9).
Full AML battery after the change: **42 files / 656 tests, all passing**
(previously 36 files / 600 — zero pre-existing tests modified except the
layout suite added here).

## Visual review — NOT RUN

Screenshot capture of the running AML surface was **not run** in this
environment: the admin app requires an authenticated Supabase session and
no synthetic backend exists in the container, and the repository's
Playwright infrastructure is scoped to PDF-import golden rendering
(`tests-e2e/`, own config) — using it for app navigation would have meant
inventing a new environment. Responsive and accessibility behaviour is
covered by the jsdom suites above; a manual pass over the ten audit
screens (home, register, workspace ×2, monitoring, partner ops, records,
mobile home, mobile register, tablet workspace) is recommended in a
staging environment before rollout.

## Known limitations / follow-ups

- Sticky register header needs an opt-in on the shared `Table` wrapper
  (vertical scroll container) — cross-portal change, not taken here.
- Monitoring's `confirm()`/`prompt()` flows should move to the
  `usePromptDialog` pattern used by the workspace.
- The legacy `AmlCaseWorkspaceDialog` (already the strongest surface, and
  heavily pinned by source tests) was left visually unchanged apart from
  the shared badge vocabulary already flowing through
  `caseDimensions.ts`.
- `audit:style` currently fails on **pristine `origin/main`** (baseline
  800/320/94 vs actual 846/343/97 — legacy report/PDF files); this branch
  adds zero new violations (verified per-file and against a pristine
  worktree). The baseline needs reconciling in its own change.
- `typecheck:portals` fails with 4 errors on pristine `origin/main`
  (solicitor-portal files; the strict config does not include AML paths).
- `security:cors-contract` fails on pristine `origin/main` (three push
  Edge Functions) — unrelated to this change.
