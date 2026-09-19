# AML V3 · Phase 13 — Closeout, Invariant Sweep & Sign-Off

Phase 13 is the **verification-only** V3 closeout. No user-facing change,
no schema change, no edge function change. It confirms every Phase 1–12
deliverable is in place, every V2/V3 invariant still holds, and the two
hard-exclusion surfaces (Directives 9 & 12) remain byte-identical to
their Phase 0 baseline.

## 1. Directive → phase closure map

| # | Directive | Delivered in | Status |
| - | --- | --- | --- |
| 1 | `Start Client Compliance` on master client record | Phase 2 | ✅ |
| 2 | Case-centred Customer Compliance (Cases + My Queue) | Phase 1, 4 | ✅ |
| 3 | Rename Structures → Ownership & Control | Phase 1 | ✅ |
| 4 | Rename Finance handoff → Funding & Finance (in case) | Phase 4 | ✅ |
| 5 | Adaptive, action-led Compliance Home | Phase 3 | ✅ |
| 6 | Neutral continuation banner + Open AUSTRAC Hub | Phase 3 | ✅ |
| 7 | Rename Platform Administration → Organisation Settings | Phase 1, 9 | ✅ |
| 8 | Remove tenant-facing Plans & Entitlements | Phase 1 | ✅ |
| 9 | **DO NOT MODIFY Launch Operations** | Phase 0 baseline | ✅ frozen |
| 10 | Consolidate AML branding into platform branding | Phase 1 | ✅ |
| 11 | Structured terminology editor | Phase 7 | ✅ |
| 12 | **DO NOT MODIFY Provider Configuration** | Phase 0 baseline | ✅ frozen |
| 13 | Relocate provider metrics away from daily workflow | Phase 7, 11 | ✅ |
| 14 | Compliance leadership contacts | Phase 9 | ✅ |
| 15 | Full chronological case workspace | Phase 4, 6 | ✅ |

Cutover Console (Phase 10), Integration Health workspace (Phase 11) and
legacy-alias deep-linking + adoption telemetry (Phase 12) close the
operational rollout loop on top of the directive work.

## 2. Invariant sweep (evidence)

- **Legacy routes preserved.** `src/App.tsx` still mounts all 16
  `admin/aml/*` routes (overview, intake, cases, verification,
  screening, risk, counterparty, finance, transactions, monitoring,
  investigations, austrac, records, governance, launch-ops,
  configuration). No route has been deleted or hijacked; V3 shell is
  additive.
- **Hard exclusions untouched.** `src/pages/aml/AmlLaunchOps.tsx`,
  `supabase/functions/aml-launch-ops/**`, and
  `supabase/functions/aml-provider-webhook/**` remain at their Phase 0
  baseline. Provider sub-panel inside `AmlConfiguration.tsx` is
  byte-identical (Phase 9 only renamed the *surrounding* container to
  "Organisation Settings" and hid non-provider legacy tabs behind
  `aml_v3_org_settings`).
- **V3 flag keys reserved and default-off.** All seven keys present in
  `src/lib/aml/useAmlV3Flags.ts`: `aml_v3_nav`,
  `aml_v3_start_client_compliance`, `aml_v3_compliance_home`,
  `aml_v3_case_workspace`, `aml_v3_terminology_editor`,
  `aml_v3_metrics_relocation`, `aml_v3_org_settings`.
- **Step-up + hash-chain audit intact.** `stepUpTokenStore.ts` and
  hash-chained audit references remain across 29 files — unchanged by
  any V3 phase.
- **Tri-portal separation preserved.** Client Portal (`PortalAml`) and
  Finance Portal (`AmlCaseSnapshot`) surfaces still whitelist fields;
  no restricted case data, SMR content or provider metrics leaked into
  either portal.
- **Model A / Model B guardrails preserved.** Activation still requires
  a human-confirmed event, and Model B still gates designated services
  behind `legal_approval` + `program_version`.
- **RLS + GRANT contract intact.** No V3 phase created a public-schema
  table without explicit `GRANT`s. AML schema access remains via
  `SECURITY DEFINER` RPCs only.
- **No Supabase reserved schemas were altered.**

## 3. Rollout runbook (recommended flag-flip order)

Reaffirms Phase 8 / Phase 10 guidance so operators have a single
authoritative sequence to follow from the Cutover Console
(`/admin/aml-v3-cutover`):

1. `aml_v3_compliance_home` — new landing surface.
2. `aml_v3_start_client_compliance` — master-record activation CTA.
3. `aml_v3_case_workspace` — case-centred workspace tabs (Timeline
   tab included from Phase 6).
4. `aml_v3_metrics_relocation` — moves provider metrics out of the
   daily workflow into the Integration Health workspace.
5. `aml_v3_terminology_editor` — structured label editor in
   Organisation Settings.
6. `aml_v3_org_settings` — surfaces Governance Contacts and renames
   Platform Administration to Organisation Settings.
7. `aml_v3_nav` — flips the primary shell to the V3 four-workspace
   layout.

Legacy `/admin/aml/*` routes stay live throughout so operators can
fall back without a code change. The Cutover Console legacy-alias
usage panel (Phase 12) is the local signal for judging when to
retire aliases in a future PR (not in scope for V3).

## 4. Files touched in Phase 13

- `archives/aml-v3/phase-13-brief.md` (this document).
- `archives/aml-v3/phase-0-audit.md` (Phase 13 gate row added in §9 —
  see next commit; content-only append, no route/permission change).

No production code changed in this phase.

## 5. Phase 13 acceptance

- [x] Every directive traced to its delivering phase and marked
      complete.
- [x] Hard exclusions verified untouched vs Phase 0 baseline.
- [x] All V3 flag keys reserved and default-off.
- [x] Legacy `/admin/aml/*` routes and guards intact.
- [x] Tri-portal separation, step-up, hash-chain audit and
      Model A/B guardrails preserved.
- [x] Rollout runbook restated in one authoritative place.
- [x] Zero user-facing changes shipped in this phase.

## 6. V3 phase gate — closed

Version 3 is functionally complete behind flags. Enabling the rollout
is now an operations task performed from `/admin/aml-v3-cutover` in
the order given in §3. Any change to Launch Operations or Provider
Configuration remains outside V3 scope and requires an explicit
exception recorded in `phase-0-audit.md` §6.
