# Mission Control — Pricing Catalog Integration

The Prime repo reads the canonical pricing catalogue (seat roles, add-on
modules, setup packages, per-report credit costs) from Mission Control via the
public endpoint `GET /api/public/pricing/catalog`. The clone API key never
leaves the server; the SPA fetches through an authenticated edge proxy.

## Surface area

| Layer | File | Purpose |
|------|------|---------|
| Server client | `supabase/functions/_shared/missionControlCatalog.ts` | `fetchCatalog`, `getReportCreditCost`, `getSeatRole`. 5-min in-memory cache per edge instance. |
| Edge proxy | `supabase/functions/mission-control-catalog/index.ts` | Authenticated passthrough that the SPA hits via `invokeSecureFunction`. |
| Frontend client | `src/lib/missionControlCatalog.ts` | Mirrors the server client (5-min cache, same helpers). |
| Hook | `src/hooks/useMissionControlCatalog.ts` | React adapter with `loading` / `error` / `refresh`. |
| UI — Settings | `src/components/settings/PricingCatalogCard.tsx` | Read-only render of roles / add-ons / setup packages / report costs. |
| UI — Reports | `src/components/billing/ReportCostBadge.tsx` | Drop-in `<ReportCostBadge slug="…" />` for report pickers. |

## Report submission (token reservation)

`generateWithTokens(fn, body, { kind, reportSlug })` now resolves the catalog
`credit_cost` and forwards it to the server under `body.__catalog`. The
`withReportMetering` middleware reads `__catalog.report_slug` /
`__catalog.credit_cost`, converts credits → tokens via
`MC_TOKENS_PER_CREDIT` (default `1000`), and uses that as the authoritative
reservation amount. If the slug is missing from the catalog we fall back to
the existing heuristic estimator and log a warning.

```ts
await generateWithTokens("generate-investment-report", body, {
  kind: "report.investment.compass",
  reportSlug: "full-property-report",
  label: "Full Property Report",
});
```

## Seat invitations

`reserveSeat({ … roleSlug })` (shared client) forwards the catalog role slug
as `metadata.role_slug` on the seat-reserve call. `admin-user-management`
picks `role_slug` off the invite body and passes it through, so newly invited
users carry the chosen pricing tier inside Mission Control without any extra
schema in this repo.

```ts
await reserveSeat({
  externalUserId: email,
  email,
  displayName: username,
  idempotencyKey: token,
  roleSlug: "standard",
});
```

## Settings UI

`Settings → Pricing & Catalog` (superadmin-visible) renders the four
catalogue sections read-only with a deep-link to Mission Control's
`/billing/catalog`. Edits **always** happen in Mission Control — this repo is
read-only by design.

## Failure modes

- `MISSION_CONTROL_URL` or `MISSION_CONTROL_CLONE_API_KEY` missing →
  `MissionControlError("unconfigured")`. The metering middleware silently
  falls back to heuristic estimates so generation keeps working.
- Catalog endpoint 5xx → one retry, then the server uses the previous cache
  if available, otherwise empty stub (UI shows "No items configured").
- Catalog returns a slug we don't recognise → `getReportCreditCost` returns
  `null` and we keep the local heuristic estimate.

## Cache invalidation

Both clients cache for 5 minutes. Force a refresh:

- Server: `fetchCatalog({ force: true })` or `invalidateCatalogCache()`.
- SPA: `useMissionControlCatalog().refresh()` (also wired to the refresh
  button in the Settings card).
