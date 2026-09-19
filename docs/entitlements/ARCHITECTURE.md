# Tiered Entitlements & Modular Overview

How the platform decides, for every capability, whether this workspace — and
this user — may use it. One resolver, one registry, one snapshot; enforced in
the UI, at every route, and in the Edge Functions.

## The model

Eight independent inputs combine into one decision:

1. **Base tier** — `launch` / `growth` / `scale`, from Mission Control.
2. **Active add-ons** — canonical catalogue slugs, from Mission Control
   (`clone_addon_purchases`, statuses `active` + `past_due`).
3. **Trials** — `trialSlugs` on the snapshot (reserved; Mission Control does
   not issue trials yet — Stripe `trialing` maps to an active add-on).
4. **Workspace overrides** — Mission Control's audited `billing_exempt` flag
   (and the snapshot's `overrideSlugs`), reported as `workspace_override`.
5. **User permission** — the existing `dashboard_modules` /
   `user_permissions` model, unchanged.
6. **Dependencies** — parent capability (every `client.*` needs
   `module.clients`) and declared dependency capabilities.
7. **Product status** — `coming_soon` / `unavailable` beat purchase state
   (Lenders is coming_soon: nobody sees it, nobody is upsold to it).
8. **Operator override** — the viewer holds the `superadmin` role, reported as
   `operator_override`. See below.

```
effective capability = ((base tier ∪ add-ons ∪ trials ∪ overrides)
                        ∧ user permission ∧ dependencies
                        ∨ operator override)
                       ∧ product status
```

Add-ons never mutate the tier: `Launch + commercial-industrial` gets exactly
the Commercial & Industrial module, nothing else from Scale. A Scale
workspace with a duplicate add-on keeps BOTH sources on the decision, so
cancelling the duplicate cannot remove the bundled module.

### Anchor commercial rules

| Capability | Included in | Add-on slug |
|---|---|---|
| `module.market_news_feed` | **scale** | `market-updates` |
| `module.commercial_industrial` | **scale** | `commercial-industrial` |
| `module.property_marketplace` | scale | `opportunity-marketplace` |
| `report.comparisons` | growth, scale | `report-comparisons` |
| `cashflow.comparisons` | growth, scale | `cashflow-comparisons` |
| `client.deals` / `module.deal_pipeline` | growth, scale | `deal-pipeline` |
| `module.aml_ctf` | **none** — SKU-driven | `aml-ctf` |

Full matrix: `src/lib/entitlements/registry.ts` (57 capabilities). Server
mirror: `supabase/functions/_shared/entitlements.ts`, pinned together by
`src/lib/entitlements/__tests__/serverMatrixParity.spec.ts`.

> **Recorded conflict.** The pricing-sheet transcription in Mission Control's
> catalogue listed `market-updates` as included from Growth. The signed-off
> commercial rules for this rollout place Market News Feed at **Scale or
> add-on** (mirroring Commercial & Industrial). The app registry, Mission
> Control catalogue (`aurixa-catalog.ts` + migration
> `20260804090000_market_updates_scale_only_bundling.sql`) and the pricing
> site (`tierFeatures.ts`) were all moved to Scale-only in the same change.
> **Rollout note:** any existing Growth workspace relying on tier bundling
> for Market News Feed should be granted the `market-updates` add-on in
> Mission Control before this ships, so nobody loses a feature they use.
> The pricing workbook (`Aurixa Pricing Tier (1).xlsx`) is not in any repo;
> the transcribed catalogue in Mission Control was used as the workbook
> source, with the spec's rules prevailing where they conflict.

### AML/CTF

`module.aml_ctf` belongs to no tier list. Entitlement follows the purchased
SKU:

- Mission Control's balance response now **states** it: tenants on a known
  tier receive `aml-ctf` in `entitlements.addons` (headline SKUs include the
  module — `TIER_INCLUDES_AML`), unless `tenants.metadata.aml_excluded` is
  set (the hook for future without-AML SKUs).
- SKU slugs of the form `launch-with-aml` / `growth-without-aml` are
  decomposed by the snapshot normaliser into base tier ± the `aml-ctf` slug.
- Against an older Mission Control that states nothing, the normaliser
  assumes headline-SKU AML for known tiers and records `amlAssumed: true`,
  visible in diagnostics. A `*-without-aml` SKU always wins over the
  assumption.

## Layers

| Layer | File(s) |
|---|---|
| Types & keys | `src/lib/entitlements/types.ts` |
| Slug canonicalisation (ONE boundary) | `src/lib/entitlements/aliases.ts` |
| Capability registry | `src/lib/entitlements/registry.ts` |
| Resolver (decision + reasoning) | `src/lib/entitlements/resolver.ts` |
| Snapshot normaliser + last-known-good cache | `src/lib/entitlements/snapshot.ts` |
| Structured logging | `src/lib/entitlements/log.ts` |
| Provider (one fetch per session) | `src/hooks/useWorkspaceEntitlements.tsx` |
| Combined workspace+user decision | `src/hooks/useCapability.ts` |
| Legacy hook shims | `src/hooks/usePlanEntitlements.ts`, `src/hooks/useModulePermissions.ts` |
| Navigation registry | `src/lib/navigation/registry.ts`, `src/hooks/useNavigation.ts` |
| Route guard | `src/components/auth/ModuleGuard.tsx` |
| Client workspace registry | `src/components/clients/clientWorkspaceRegistry.ts` |
| Overview quick actions | `src/lib/overview/quickActions.ts` |
| Server gate | `supabase/functions/_shared/entitlements.ts` |
| Diagnostics | `src/components/settings/EntitlementDiagnosticsCard.tsx` (Settings, superadmin) |

Components never compare plan slugs. They ask `useCapability(key)` (or the
legacy hooks, which now delegate) and receive a `CapabilityDecision`:
`enabled`, a `status` explaining why not (`plan_excluded` /
`permission_denied` / `dependency_missing` / `product_unavailable` /
`loading` / `unknown`), every `entitlementSources` that would grant it, the
`requiredPlan`, and the `availableAddons`.

`ModuleGuard` renders a distinct state per status — "not included in your
subscription" (with Billing actions) is never conflated with "your account
does not have permission" (contact your administrator), a missing
configuration, an unavailable product, or an unconfirmed entitlement
(retry, no upsell).

## Mission Control contract

`GET /api/public/tokens/balance?tenant_ref=…` (consumed via the
`mission-control-balance` edge proxy → `fetchTokenBalance()`):

- `tenant.billing_plans.slug` → base tier. Accepted: `launch`, `growth`,
  `scale`; legacy `professional` maps to `growth`; `*-with-aml` /
  `*-without-aml` suffixes are decomposed.
- `tenant.status`, `tenant.current_period_end`, `tenant.billing_exempt`.
- `entitlements.addons` → active add-on slugs (`active` + `past_due`;
  cancellation respects `current_period_end` — Mission Control keeps the row
  entitling until period end). Now includes plan-bundled `aml-ctf`.

The app canonicalises once on receipt (`snapshotFromBalance`), keeps the
last-known-good snapshot per workspace in `localStorage` (14-day cap), and
refreshes: on load, every 5 minutes, on window focus/visibility (throttled
30s — this covers returning from the storefront checkout), on
`tokens-used`/`out-of-tokens` events, and manually from the diagnostics
card. This is a single-tenant clone architecture: the workspace IS the
deployment (`tenant_ref` derived server-side; never trusted from the
browser).

### Failure posture (replaces the old fail-open)

| State | Behaviour |
|---|---|
| Snapshot fresh | Exact decisions. |
| Mission Control down, LKG cache valid | Serve cached snapshot, marked `stale`; paying customers keep what they bought; logged. |
| No snapshot ever obtained | Core capabilities (in every tier) stay usable; premium withheld with status `unknown` — shown as *temporarily unavailable*, never an upsell. Backend premium ops return 503 `PRODUCT_UNAVAILABLE`. |
| Unprovisioned / unconfigured clone (MC 404) | Explicit answer → treated as billing-exempt override, so dev installs work. |

### The operator override

A `superadmin` reaches every available capability, on both axes, reported as
the `operator_override` source.

This reverses an earlier rule — *superadmins bypass the user permission, never
the plan* — which was written to stop an operator seeing features nobody else
could see and then answering support tickets with advice that cannot be
followed. The cost landed somewhere it was not anticipated. **Add-on-only
capabilities belong to no tier at all**, so `module.email_copilot`,
`module.call_logs`, `module.integrations`, `module.aurixa_agent`,
`module.intelligence_hub` and `module.aml_ctf` resolved `plan_excluded` for
*every* superadmin on *every* plan. Two of them — Email Copilot and Call Logs
— are ordinary CRM pages sitting in the main sidebar, and the people who
administer the deployment could not open them.

The override is reported rather than silent, which is what keeps the original
concern addressed:

- the decision carries `effectiveSource: "operator_override"`;
- `operatorOnly: true` marks a capability the **workspace** holds no source
  for, so it is open to the operator alone;
- `requiredPlan` / `availableAddons` are still populated, so the decision
  still says what the workspace would have to buy;
- `ModuleGuard` renders that on the page: *"Open to you as a superadmin — this
  workspace's subscription does not include X"*, together with the fact that
  premium **server** operations enforce separately and can still refuse data;
- `includedInPlan` from `useModulePermissions` keeps reporting the workspace's
  position, not the viewer's, so upsell surfaces stay honest.

`productStatus` is not overridable. Purchase state is negotiable; whether the
capability runs at all is not — `client.lenders` (coming_soon) stays shut to
everyone.

## Backend enforcement

`requireWorkspaceCapability(supabase, actor, capability)` in
`_shared/entitlements.ts` — Mission Control first, `token_balance_cache` as
last-known-good, 60s in-instance cache. Applied after auth in 23 premium
functions: all C&I data/calculation functions, Market News Feed
reads/archive/feed, both comparison engines + formatter + both PDF
renderers, borrowing-capacity set, agreements, marketing (meta-ads),
portfolio analysis, and `airtable-proxy` (the marketplace listings intake).
Denials are machine-readable: `ENTITLEMENT_REQUIRED` (403) /
`PRODUCT_UNAVAILABLE` (503). Verified internal calls (`service_role`)
bypass; **superadmins do not** — commercial bypass exists only as Mission
Control's audited billing-exempt override.

The operator override above is deliberately a **client-side** rule and stops
here. This is a single-tenant clone architecture: every customer's principal
holds `superadmin` in their own clone, so honouring the override at this layer
would hand every clone its whole catalogue for free. Neither of the modules
that motivated the override is gated here — nothing calls
`requireWorkspaceCapability` with `email-copilot` or `call-logs` — so those
pages work end to end. On a capability that *is* gated here, an operator gets
in and sees the module, and premium data calls still answer 403; the guard's
notice says so on the page. `serverMatrixParity.spec.ts` pins this boundary by
asserting `_shared/entitlements.ts` never imports `actorIsSuperadmin`.

`requireModulePermission` (user axis) is unchanged and still applies where
it already did.

## Modular Overview

`src/pages/Overview.tsx` assembles capability-gated sections:

- **Universal** (every tier): hero, quick-actions row
  (`src/lib/overview/quickActions.ts` — filtered, never disabled),
  operations snapshot (tasks due today / overdue / due this week / reports
  this month), upcoming reminders.
- **`module.property_marketplace`**: the listings fetch itself
  (`propertyDataService.fetchAllListings` does not run without it), intake
  KPIs, content stats, data-integrity panel, all six listings charts, recent
  listing activity, snapshot export, filters.
- **`module.commercial_industrial`**: `CommercialPortfolioWidget` +
  `IndustrialPortfolioWidget` — unmounted (hooks never fire) when not held.
- **`module.market_news_feed`**: compact latest-developments widget
  (`MarketNewsWidget`) reading the published feed only.

## Data preservation

Nothing here deletes on downgrade. Expiry removes navigation, widgets,
quick actions, routes and backend access; `commercial_*`, `industrial_*`,
assessment, comparison and news tables are untouched, and re-purchase
restores access to the same records. RLS policies were not weakened.

## Manual verification checklist

Simulate tiers by adjusting the Mission Control tenant (plan row /
`clone_addon_purchases`) and refreshing entitlements from Settings →
Entitlement Diagnostics.

1. **Launch**: sidebar shows no Market News Feed / Commercial‑Industrial /
   Marketplace / Deal Pipeline; `/market-updates`, `/commercial`,
   `/listings` show the subscription denial with Billing actions; Generated
   Reports has no Comparisons tab and `?tab=comparisons` redirects;
   cash-flow modal has no Compare button; client modal shows core tabs only;
   Overview shows quick actions + ops snapshot + reminders, no listings
   charts; direct POST to `manage-commercial-data` → 403
   `ENTITLEMENT_REQUIRED`.
2. **Growth**: adds Deals tab, Deal Pipeline, both comparison surfaces;
   still no Market News Feed / C&I.
3. **Scale**: everything, including both anchor modules, marketplace
   sections and Scale client actions.
4. **Launch/Growth + `market-updates` add-on**: Market News Feed appears in
   all four nav surfaces, routes open, Overview news widget renders,
   backend reads pass — and nothing else changes.
5. **Launch/Growth + `commercial-industrial` add-on**: same for C&I
   (routes, calculators, assessments, widgets, backend).
6. **AML**: tenant with `metadata.aml_excluded` (or a `-without-aml` SKU) →
   AML action hidden on the client modal, AML entitlement "not entitled" in
   diagnostics; default tenant → entitled.
7. **Permission denial**: remove a user's `clients` permission → client
   surfaces show the *permission* message, not the subscription one.
8. **Mission Control outage**: block the balance endpoint; with a cached
   snapshot, everything keeps working and diagnostics shows `stale`; with
   storage cleared, premium shows "temporarily unavailable" with retry and
   core keeps working.
9. **Add-on expiry**: cancel in Mission Control past period end → refresh →
   navigation, widgets, routes and backend deny; historical records remain
   in the database; re-grant restores them.
