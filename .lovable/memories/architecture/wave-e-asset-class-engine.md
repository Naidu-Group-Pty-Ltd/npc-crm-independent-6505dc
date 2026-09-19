---
name: Wave E — Asset-Class BC Engine Live
description: bcSegmentEngine flag default-on; commercial/industrial segments now include capex reserve amortised over 5yr horizon
type: feature
---

# Wave E — Asset-Class Borrowing Capacity Engine

Default ON globally. `feature_flags.bcSegmentEngine = {enabled: true}` (no allowlist).

## Segment NOI now nets capex reserve
Both `segments/commercial.ts` and `segments/industrial.ts` query the Wave-C `commercial_capex` / `industrial_capex` tables, sum `amount` per `property_id`, amortise over a **5-year** forward horizon, and subtract from segment NOI before ICR/DSCR caps.

```
noi = max(0, grossRent - opex - (sum(capex_amount) / 5))
```

## Data precedence (unchanged)
- Commercial: `commercial_financing` > latest `commercial_dcf_runs` > policy defaults
- Industrial: `industrial_financing` > legacy `industrial_properties.industrial_financing` JSONB > policy defaults

## Reconciler (`segments/reconcile.ts`)
- Reads `bcSegmentEngine` flag (`enabled`, optional `allowlist`, optional `dragFactorOverride`).
- Runs commercial + industrial evaluators in parallel with 6 s hard timeouts; failures degrade silently to empty (residential pipeline never breaks).
- Overlays applied to residential capacity:
  - `extraMonthlyCommitments = annualDebtService / 12`
  - `extraShadedAnnualIncome = additionalAnnualNoi`
  - `extraDtiDenominator = additionalAnnualNoi` (when `dtiIncludeCommercialNoi`)
  - `portfolioCapacityDelta = Σ headroom × dragFactor (only on negative headroom)`
- `portfolioCapacity = max(0, residentialCapacity + portfolioCapacityDelta)` when triggered.

## Surfaces
- Hook: `useBorrowingCapacity` exposes `segmentReconciliation`.
- UI: `BorrowingCapacitySegmentCard` (per-segment ICR/DSCR/LVR/headroom/band).
- Admin: `/admin/bc-segment-engine` for flag inspection per client.

## Default policy
- Commercial: minICR 1.50, minDSCR 1.30, maxLVR 0.65, assess rate 8.50%, 25yr P&I
- Industrial: minICR 1.75, minDSCR 1.35, maxLVR 0.60, assess rate 8.75%, 25yr P&I
- `dtiIncludeCommercialNoi = true`, `commercialDragFactor = 1.0`

## Health logging
Every reconcile attempt writes to `api_health_log` with `service_name='bc-segment-engine'` and status `success|error|skipped` (reason in `error_message`).
