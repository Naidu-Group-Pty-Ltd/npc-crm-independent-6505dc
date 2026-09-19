# AML/CTF Command Center — UI/UX audit (current state)

Audit taken from `origin/main` @ `84c5304832bdcc2755ae588109b1a024141531a5`
(2026-08-05), before any enhancement work on
`claude/aml-ctf-command-center-ui-mcrchp`.

This document records what the Command Center AML surface looks like today,
separated into three buckets:

- **Confirmed problems** — inconsistencies or defects a user can hit.
- **Design opportunities** — preference-level improvements, not defects.
- **Intentional behaviour** — permission gating, feature-flag states and
  compliance boundaries that *look* like gaps but are deliberate and must not
  be "fixed".

---

## 1. Route inventory (`src/App.tsx`)

All Command Center AML routes render inside `AmlLayout` (`admin/aml/*`) behind
`AmlGuard`, which enforces the tenant `aml_ctf` flag, role membership,
capability and (for AUSTRAC/configuration) step-up confirmation. Two admin
routes render outside the shell.

| Route | Component | Guard capability | Notes |
| --- | --- | --- | --- |
| `/admin/aml` | `AmlOverview` → `AmlComplianceHomeV3` when `aml_v3_compliance_home` | `aml.view` | V2 renders by default |
| `/admin/aml/intake` | `AmlIntakeQueue` (shell placeholder) | `aml.view` | placeholder surface |
| `/admin/aml/cases` | `AmlCases` | `aml.view` | supports `?open=`, `?tab=`, `?activateClientId=` |
| `/admin/aml/cases/:caseId` | `AmlCaseWorkspace` | `aml.view` | behind `aml_v3_case_workspace`; falls back to `?open=` deep link |
| `/admin/aml/verification` | `AmlVerification` | `aml.view` | legacy alias page (V3 hides from nav) |
| `/admin/aml/screening` | `AmlScreening` | `aml.view` | legacy alias page |
| `/admin/aml/risk` | `AmlRisk` | `aml.view` | legacy alias page |
| `/admin/aml/counterparty` | `AmlCounterparty` | `aml.view` | "Ownership & Control" / "Counterparty Due" |
| `/admin/aml/finance` | `AmlFinance` | `aml.investigate` | Funding & Finance |
| `/admin/aml/transactions` | `AmlTransactions` | `aml.investigate` | |
| `/admin/aml/monitoring` | `AmlMonitoring` | `aml.view` | |
| `/admin/aml/investigations` | `AmlInvestigations` | `aml.investigate` | |
| `/admin/aml/austrac` | `AmlAustracReporting` | `aml.report` + step-up | |
| `/admin/aml/records` | `AmlRecords` | `aml.view` | |
| `/admin/aml/governance` | `AmlGovernance` | `aml.view` | |
| `/admin/aml/launch-ops` | `AmlLaunchOps` | `aml.view` | |
| `/admin/aml/partner-operations` | `AmlPartnerOperations` | `aml.view` | reads `?register=`/`?status=` |
| `/admin/aml/configuration` | `AmlConfiguration` | `aml.configure` + step-up | |
| `/admin/aml-v3-cutover` | `AmlV3Cutover` | (own guard) | outside shell |
| `/admin/aml-integration-health` | `AmlIntegrationHealth` | (own guard) | outside shell |

Navigation ships two configurations in `AmlLayout` — `LEGACY_WORKSPACES`
(default) and `V3_WORKSPACES` (behind `aml_v3_nav`). Both group the same
routes into five workspaces (Compliance Home, Customer Compliance,
Transaction Compliance, Regulatory & Assurance, Organisation Settings); V3
moves the per-discipline customer pages inside the case workspace and hides
their nav entries while the routes remain reachable — **intentional**, not a
defect.

## 2. Confirmed problems

### Shell (`AmlLayout.tsx`)

1. **No page-level context in the shell header.** The header shows the module
   title and a fixed strapline; the current workspace/subsection is only
   discoverable from nav highlight state. On mobile, where nav wraps into
   several rows, users lose "where am I".
2. **Primary nav at 320–360 px** wraps into up to five rows of icon+label
   tabs (`flex-wrap`), consuming ~40% of the first viewport. No compact
   treatment exists for small screens.
3. **Secondary nav has no overflow treatment** — seven entries in the legacy
   Customer Compliance workspace wrap to three rows at 360 px.
4. **Content containers are inconsistent**: the shell wraps `<Outlet />` in
   `px-6 py-6`, yet `AmlCases`, `AmlLaunchOps` and others add their own
   `p-6`, producing double padding (48 px) on those pages while the home
   pages sit at 24 px.

### Compliance Home (`AmlComplianceHomeV3.tsx`, `AmlOverview.tsx`)

5. **"—" is used for both loading-complete-but-unavailable and zero-adjacent
   states.** `value={counts?.onboarding ?? "—"}` renders an em dash when the
   API failed *or* when the payload hasn't arrived; a real `0` and an
   unavailable metric are visually identical to a glance (a dash could read
   as "none"). The monitoring tiles have the same pattern
   (`monitoring?.open_alerts ?? "—"`).
6. **Monitoring/finance API failures are silent.** `catch(() => null)`
   without any user-visible signal — tiles just show "—" forever with the
   hint "Awaiting first data refresh", which reads as *loading*, not
   *failed*.
7. **Two visually identical 4-tile grids** sit adjacent with no group
   headings (customer pipeline vs monitoring/finance) — the §8 questions the
   page is designed around are not visible on the page.
8. **No refresh affordance or last-updated timestamp** anywhere on the home,
   although the data is operational queue data.
9. **Metric tiles all deep-link to the same place.** All four case tiles link
   to `/admin/aml/cases` without carrying the matching saved view/filter, so
   "Awaiting decision → click" lands on the unfiltered register.
10. **V2 `AmlOverview` duplicates `MetricTile` wholesale** — an identical
    ~30-line component is pasted in both files with tiny divergences (V2 has
    no `rounded-lg` on the focus ring wrapper).
11. **V2 "Total cases / Open (recent)" tiles are not linked** — no
    deep-link, no keyboard affordance, unlike their monitoring siblings.

### Case register (`AmlCases.tsx`)

12. **Loading state is a bare centred spinner** that replaces the whole
    register — no skeleton resembling the table, causing a large layout
    shift on every filter change.
13. **Load failure is a toast only.** If `amlCasesApi.list` rejects, the page
    keeps whatever rows it had (or an empty state that claims "No cases
    yet") with no inline error and no retry.
14. **The empty-filtered state's advice ("Clear a filter…") has no action**
    — there is no clear-all-filters control anywhere.
15. **No active-filter summary.** With a saved view + search + risk filter
    applied, nothing summarises the effective query; the result count in the
    header ("N cases") silently changes meaning.
16. **Saved-view chips and filter row are two disconnected strips** with
    different vertical rhythm; on mobile the `w-48`/`w-40` selects overflow
    their row and the search input is capped at `max-w-xs` even at 360 px.
17. **Search only fires on Enter** — no visible search button, no hint, and
    the result count doesn't say a search is in effect.
18. **Table rows use `role="link"` on `<tr>`** (non-interactive element with
    a link role); focus style is browser-default, and there is no visible
    focus ring on rows. No sticky header; no per-row explicit action.
19. **Mobile cards compress metadata into one dense line**
    (`ref · type · opened date`) and omit the service-gate dimension
    entirely; stage/risk appear only as badges.
20. **Gate column is raw-ish text** — `gate.replace(/_/g, " ")` with
    `capitalize` rather than the shared `SERVICE_GATE_LABELS` vocabulary
    used by the workspace dialog.
21. **Header count "N cases" is server total, list caps at 100** — nothing
    communicates the truncation when total > 100.

### Case workspace (`AmlCaseWorkspace.tsx`)

22. **Section state is not written back to the URL.** `?section=` is read on
    mount, but switching sections never updates the URL — refresh returns to
    the *initially requested* section, deep links can't be shared from the
    current state, and browser back/forward does nothing.
23. **The progress rail renders 14 wrap-packed steps** with 3.5 px icons and
    11-ish px text in up to 3 wrapped rows; on mobile it is a dense word
    cloud. Current-step prominence is minimal (`in_progress` = primary icon
    only).
24. **1024 px laptops get all three columns** (`lg:grid-cols-[200px_1fr_260px]`)
    leaving ~520 px of content width for dense forms — below the phase's
    usable threshold.
25. **The action panel's "Advance status" exposes every legal next status as
    a flat row of identical outline buttons** — destructive transitions
    (Blocked/Closed) sit visually camouflaged beside progression ones,
    *unlike* the legacy dialog which groups and confirms them. Reason input
    is optional-looking even where the server requires one.
26. **`aria-live` percent counter** announces on a `span` whose content
    changes on load only; the rail states themselves are icon-only + sr-only
    text — colour-only for sighted users at small sizes (icons differ, so
    borderline; kept as an opportunity).
27. **Overview/Documents/Monitoring sections use bare `Loader2` spinners**,
    inconsistent with the page-level skeleton.

### Legacy dialog (`AmlCaseWorkspaceDialog.tsx`)

28. Generally the strongest surface (grouped destructive actions, retryable
    error, accessible loading). Remaining nits: tab bar overflows
    horizontally on mobile with no affordance; header badges wrap awkwardly
    at 360 px. (Opportunities, not defects.)

### Operational / admin pages

29. **Page headers: four competing shapes on the same tier of page.**
    - Shape 1 — `h1 text-2xl` + inline icon + right-side Refresh:
      AUSTRAC, Records, Configuration, Governance, LaunchOps,
      PartnerOperations, IntegrationHealth, Screening, Verification.
    - Shape 2 — icon chip + `h2 text-xl`: `AmlShellPage`, Counterparty,
      Monitoring (`text-lg`), Finance.
    - Shape 3 — title inside a `Card`, no heading element at all:
      Investigations (`AmlInvestigations.tsx:54`), Risk (`AmlRisk.tsx:109`).
    - No header at all: Transactions (`AmlTransactions.tsx` starts with the
      master/detail grid), V2 Overview.
    Heading levels are also wrong for the document outline: the shell renders
    `h1`, so page titles rendered as another `h1` (or skipped to a bare
    `CardTitle`) break heading order.
30. **Seven near-identical local metric-card components**, none shared:
    `AmlOverview.MetricTile`, `AmlRecords.Tile`, `AmlScreening.KpiCard`,
    `AmlVerification.KpiCard`, `AmlIntegrationHealth.KpiCard`,
    `AmlCounterparty.SummaryTile`, `AmlConfiguration.SummaryTiles` — plus
    fully inline tiles in AUSTRAC, Monitoring, Finance, Governance and
    LaunchOps headers. LaunchOps/Governance embed a fixed `grid-cols-3` stat
    grid inside the header row that never collapses on mobile.
31. **A dozen per-page status-tone maps** re-declare the same
    `Record<string, string>` → `<Badge className={MAP[x]}>` idiom
    (Monitoring, Investigations, AUSTRAC, Records ×2, Finance ×2, Screening,
    Verification, Risk, Transactions ×2 — one declared *inside a render
    loop*, Counterparty, Configuration, IntegrationHealth), while the
    canonical `StatusBadge` + `statusTone()` from
    `src/components/ui/status-badge.tsx` is used only by Governance and
    LaunchOps. Screening/Verification hand-roll a `<span>` pill instead of
    any Badge.
32. **Loading states range from good to absent.** Configuration and
    Governance use page/section skeletons; Transactions and Counterparty use
    list skeletons; Monitoring, Records, Finance and Risk have **no content
    loading state at all** (tables render their empty row while loading, so
    "No alerts" flashes as a false empty); Investigations shows a bare
    unlabeled 16 px spinner; only IntegrationHealth labels its spinner
    ("Loading telemetry…"). Verification is the only table with a proper
    in-table loading row distinct from its empty row.
33. **Errors are toast-only almost everywhere** (Monitoring, Investigations,
    Records, Finance, LaunchOps…); V2 Overview has the only inline error
    Alert and even it has no retry. `RegulatoryAssuranceHeader` renders its
    error as ordinary description text.
34. **Five variants of the no-access/read-only state**: illustrated + CTA
    (Overview), Card (Records), bare div ("You do not have any AML role." —
    AUSTRAC), Card + ShieldAlert (IntegrationHealth), inline "Read-only"
    Alert (Configuration, LaunchOps ×2).
35. **Icon-only buttons without accessible names**: refresh buttons on
    Screening, Verification, Finance, Transactions; approve/reject
    ThumbsUp/ThumbsDown on Investigations; resolve/waive on Risk.
    (PartnerOperations' refresh is correctly labelled.)
36. **`<th scope="col">` exists only on PartnerOperations' raw tables**;
    every shadcn `TableHead` renders `<th>` without scope, and no AML table
    uses a caption or `aria-label` except PartnerOperations.
37. **IntegrationHealth's health badge always renders `CheckCircle2`** —
    only its colour changes, so "Failing" is a red *check mark*; the
    timeline bar chart has `title=` tooltips as its only text alternative.
38. **Native `confirm()`/`prompt()`** used for destructive/notes flows on
    Monitoring; raw `<select>` elements on Governance and LaunchOps; raw
    `<input type="checkbox">` on AUSTRAC and Counterparty.
39. **Mobile**: zero mobile fallbacks for tables (horizontal scroll only —
    acceptable inside the table frame, but 10-column tables on Finance);
    fixed-width selects (`w-[320px]` on Finance) and fixed-height
    ScrollAreas (`h-[540px]`/`h-[560px]`) overflow small screens;
    `CardHeader flex-row` action rows never collapse; 5–6-trigger
    `TabsList`s (Records, Configuration, Governance) have no overflow
    strategy.
40. **Refresh placement varies** — most pages top-right (labelled), four
    icon-only unlabelled, Compliance Home has none.
41. **Empty states vary** from dashed-border actionable boxes (Overview) to
    bare `text-muted-foreground` paragraphs to table empty-rows to an
    Alert; Governance's empty runbooks tab renders a skeleton forever (an
    empty state that looks like loading).

## 3. Design opportunities (preference, not defects)

- Group the workspace's three-column layout into two columns at `lg`,
  reserving three columns for `xl+`.
- Give the progress rail a horizontal scroll-snap treatment on mobile
  instead of wrapping.
- Surface "what changed since I last looked" on the home (recent activity).
- Consolidate the `MetricTile` implementations into one shared card with an
  explicit `state` prop (`loading | ready | unavailable | restricted`).
- Introduce a shared page-header primitive with a consistent
  title/description/actions slot.
- Align dialog paddings and section heading sizes across workspace sections
  (`text-sm` card titles vs `text-base`).

## 4. Intentional behaviour (do NOT change)

- **Both nav configurations** (`LEGACY_WORKSPACES` / `V3_WORKSPACES`) ship
  together; V3 hides legacy per-discipline pages from nav while keeping the
  routes — deliberate rollout design.
- **All V3 flags default false**; nothing may enable them.
- **Restricted metrics are omitted from render entirely** for users without
  the capability (tipping-off protection). Their absence is not "missing
  UI".
- **Role chips and module status were deliberately removed** from the shell
  header (V2 spec); do not reintroduce role/dev metadata.
- **Manual case creation is MLRO-only by design** ("Exception case") with a
  recorded reason — the friction is the feature.
- **Step-up prompts** on AUSTRAC and Configuration are a security control.
- **`PartnerOpsQueueStrip` renders nothing** while
  `aml_partner_operations_reporting` is off — fail-closed by design.
- **The workspace flag redirect** (`/admin/aml/cases/:id` →
  `/admin/aml/cases?open=<id>` while `aml_v3_case_workspace` is off) keeps
  bookmarks working mid-rollout.
- **Readiness surfaces must keep distinguishing** source-exists /
  configuration-recorded / environment-verified / unknown — the "not
  verified" wording is a truthfulness control, not hedging.
- **The standalone Developer Portal stays fail-closed** and has no route in
  this app.

## 5. Duplicated patterns worth extracting

| Pattern | Occurrences |
| --- | --- |
| Metric tile (icon + label + big number + hint) | `AmlOverview`, `AmlComplianceHomeV3` (identical local components), LaunchOps header cards |
| Page header (title + description + actions) | every AML page, all hand-rolled |
| Centred access/empty gate | `AmlCases.EmptyGate`, no-access states in both homes, `AmlGuard` alerts |
| Dashed-border empty state | homes ×3, several workspace sections |
| Spinner-only loading block | register, workspace sections ×4+ |
| List row (name + sub-line + badges) | homes ×3 lists, workspace documents/evidence/requirements |
| Toast-only error handling | register, LaunchOps, several workspace actions |
| Refresh button (labelled + unlabelled variants) | 12+ pages |
| No-access / read-only gate | 5 distinct variants |
| Table empty row (`colSpan` + centred muted text) | Monitoring ×4, Records ×7, AUSTRAC, Finance ×4, Screening ×2, Verification |

These are the seeds for the Phase 2 primitives.

## 6. Constraints the enhancement must respect

- `npm run audit:style` is a **ratchet**: new `.tsx` must contribute zero raw
  palette classes, hex literals, inline colour styles or hard-coded fonts.
  The AML surface currently has zero violations; it must stay at zero.
- `Card` gets its material from the glass re-skin (`luxury-card`); do not add
  `bg-*`/`shadow-*` utilities to it, and never put `backdrop-filter` on
  repeated elements.
- Source tests pin exact code strings:
  `amlCaseWorkspace.source.test.ts` (register/dialog/tabs class strings and
  wiring), `amlActivationPathway.source.test.ts` (`?activateClientId=`
  handling), `amlUiDisclosure.source.test.ts` (no role/flag metadata in UI
  copy; V3 home must keep its "Priority work queue"),
  `stepUpDisclosure.source.test.ts`. Enhancements must keep those contracts
  or update the tests together with the intent they encode.
- `StatusBadge` (`src/components/ui/status-badge.tsx`) is the sanctioned
  status pill; its docblock says to prefer it over hand-tinted Badges.
