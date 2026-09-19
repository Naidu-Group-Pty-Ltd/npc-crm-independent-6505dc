# AML V3 · Phase 12 — Legacy Alias Hardening & Cutover Adoption Signal

## Scope
Phase 12 tightens the cutover experience for the four legacy KYC
top-level routes (`verification`, `screening`, `risk`, `finance`) that
V3 collapses into case-workspace tabs, and gives the superadmin
Cutover Console a first, zero-backend adoption signal so operators
can judge when it is safe to flip `aml_v3_nav`.

No hard-exclusion surface is touched. No schema, no edge function,
no data migration.

## Directive coverage
- **Directive 2 / 4 / 15 · Case-centred workspace** — legacy KYC
  alias pages now offer a one-click deep link into the correct case
  tab, and quietly record local hits so the Cutover Console can
  surface adoption. Legacy pages remain fully functional per the
  Phase 1 non-destruction rule.
- **Phase 10 follow-up** — the Cutover Console gains a "Legacy alias
  usage · this browser" panel, closing an open question raised in
  `phase-10-brief.md` ("does the org actually consult V3 before
  we flip `aml_v3_nav`?").

## Files touched
- `src/components/aml/LegacyAliasBanner.tsx` — enriched: optional
  `tabHint` + `routePath`, inline case picker (Popover) fetching
  the 25 most recent cases, and mount-time `recordLegacyAliasHit`
  call. Preserves the original wording verbatim.
- `src/lib/aml/legacyAliasTelemetry.ts` — new. localStorage-backed
  helper (`aml:v3:legacy_hits`, capped at 500 entries). Exports
  `recordLegacyAliasHit`, `readLegacyAliasSummary`,
  `clearLegacyAliasHits`, `totalLegacyAliasHits`.
- `src/components/aml/CaseWorkspaceTabs.tsx` — accepts optional
  `initialTab` prop, whitelisted against a `KNOWN_TABS` set to
  prevent arbitrary query values driving the workspace.
- `src/pages/aml/AmlCases.tsx` — reads `?open=<id>&tab=<hint>` on
  mount, opens the case sheet with the requested tab pre-selected,
  and strips the query params so a refresh does not re-open the
  sheet unexpectedly.
- `src/pages/aml/AmlVerification.tsx` /
  `src/pages/aml/AmlScreening.tsx` /
  `src/pages/aml/AmlRisk.tsx` — banner call updated with the
  corresponding `tabHint` + `routePath`.
- `src/pages/aml/AmlFinance.tsx` — banner added (Funding & Finance /
  `finance` tab hint). Closes the last KYC-alias page that was
  missing a banner.
- `src/pages/admin/AmlV3Cutover.tsx` — new "Legacy alias usage · this
  browser" card with per-path counts, last-seen timestamp, refresh
  and clear controls.

## Guardrails preserved
- **Hard exclusions untouched.** `AmlLaunchOps.tsx`,
  `aml-launch-ops`, `aml-provider-webhook`, and the Provider
  Configuration sub-panel are neither read nor written.
- **Read-only telemetry.** Adoption signal is local (`localStorage`)
  and per-browser. No PII, no server writes, no cross-tenant
  visibility.
- **Tri-portal separation.** Banners, telemetry, and the console
  panel live in Command Centre only. Client Portal and Finance
  Portal are untouched.
- **Non-destruction.** Legacy `/admin/aml/*` routes still render
  their original V2 pages in full — the banner sits above the
  existing content and every original control remains functional.
- **Deep-link safety.** `initialTab` is whitelisted (`KNOWN_TABS`),
  and `?open=&tab=` query params are stripped after use so a
  browser back or refresh does not silently re-open the sheet.
- **No schema change, no new edge function, no data migration.**

## Cutover interaction
- Once `aml_v3_case_workspace` is enabled, the banner's "Jump to a
  case" popover is the fastest path into the correct case tab.
- The Cutover Console panel gives superadmins a browser-local read
  on how often legacy aliases are still being consulted before they
  flip `aml_v3_nav`. Zero → safe to flip; steady non-zero → talk to
  the team before removing the aliases in a future phase.

## Phase 12 acceptance
- [x] `LegacyAliasBanner` accepts `tabHint` + `routePath`, renders a
      case picker Popover, and records mount-time hits.
- [x] Verification, Screening, Risk and Finance legacy pages all use
      the enriched banner with correct tab hints.
- [x] `AmlCases` deep-links via `?open=&tab=`, whitelisted through
      `CaseWorkspaceTabs.KNOWN_TABS`.
- [x] Cutover Console shows a per-path usage summary with refresh
      and clear controls.
- [x] Launch Operations and Provider Configuration surfaces
      untouched.
- [x] No schema change, no new edge function.
