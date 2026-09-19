# Cotality (CoreLogic) Integration — Scoping & Source-of-Truth Spec

> Status: **Scoping** — outbound enquiry sent to Cotality Data Solutions team.
> Owners: NPC Services platform team.
> Last updated: 2026-05-26.

This document is the canonical brief for the Cotality integration. While Cotality is the eventual single source of truth for ~8 of our 10 data branches, we are building scaffolding now (provenance table, edge-function shell, fallback hierarchy) so reports can swap to live Cotality data the moment sandbox credentials land.

---

## 1. Why Cotality

Current reports stitch together ~7 free APIs (ABS, BOCSAR, RBA, Google Places, mock transport, mock schools) and a lot of modelled defaults. The "47/52 score clustering" and "fabricated School Name 1" issues both trace back to this. Cotality replaces almost the entire stack in one licence and gives us:

- Verified property attributes & AVM
- Sales & rental history (per-property and per-suburb)
- Suburb growth, DOM, vendor discount, stock-on-market
- Cordell construction cost data
- Demographics
- Climate / hazard risk (separate SKU)

Crime statistics and state planning overlays remain government feeds — Cotality does not cover those.

## 2. Branch Mapping (10 reporting branches)

| # | Branch | Source under Cotality | Fallback |
|---|--------|----------------------|----------|
| 1 | Property attributes & AVM | Cotality Property Data API + AVM | Domain API (read-only) |
| 2 | Sales history & comparables | Cotality sales feed | Domain comparables |
| 3 | Rental history & yield | Cotality rentals | Domain rentals |
| 4 | Suburb market analytics | Cotality Market Trends / Suburb Stats | ABS + manual |
| 5 | Planning / zoning / overlays | Cotality (partial) + state portals (Vicplan, ePlanning Spatial, DA Mapping) | State portals only |
| 6 | Build cost benchmarks | Cordell Insights | Internal cost tables |
| 7 | Demographics | Cotality demographics OR ABS | ABS Census API |
| 8 | Crime | **Government feeds only** (BOCSAR, CSA, QPS) | "Data unavailable" |
| 9 | Climate / hazard risk | Cotality Climate Risk (separate SKU) | "Data unavailable" |
| 10 | Infrastructure / amenities | Cotality POI + Google Places hybrid | Google Places only |

## 3. Confidence & Provenance Model

Every numeric value flowing into a report must carry a `data_provenance` envelope:

```ts
{
  value: number | string,
  source: 'cotality' | 'abs' | 'rba' | 'bocsar' | 'csa' | 'qps' | 'google' | 'domain' | 'modelled' | 'manual',
  confidence: 0..1,           // 1.0 = licensed live API, 0.5 = cached >30d, 0.3 = modelled fallback
  fetched_at: ISO timestamp,
  licence_tag: 'cotality' | 'public' | 'derived',
  cache_ttl_days: number
}
```

The PDF generator surfaces source + confidence next to every number. If `confidence < 0.4`, the renderer must suppress the figure and print "Insufficient data" rather than fabricate.

## 4. Caching & Licensing Questions (to confirm with Cotality)

- Permitted cache duration per dataset (target: AVM 7d, sales 30d, suburb stats 90d, demographics 365d)
- Redistribution rights for client-facing PDFs (we render server-side and email/share PDFs to end clients)
- Right to persist derived metrics (our investment score) computed from Cotality inputs
- Refresh cadence at source per dataset

## 5. Volume Forecast

| Stage | Reports/month | Cotality calls/report | Calls/month |
|-------|---------------|----------------------|-------------|
| Launch | 400 | 6–10 | 2.4k–4k |
| Year 1 | 1,500 | 6–10 | 9k–15k |

## 6. Implementation Phases

1. **Now (no live key)**: build `cotality-service` edge-function shell, `data_provenance` Postgres table, fallback resolver. All calls return `{ source: 'modelled', confidence: 0.3 }` until creds are wired.
2. **Sandbox**: wire real endpoints, validate against 25 sample properties (NSW/VIC/QLD/WA).
3. **Production**: enable in `generate-investment-report`, deprecate ABS/RBA/mock paths where Cotality covers them, keep government feeds (crime, planning) intact.
4. **Score recalibration**: with verified inputs flowing, switch scoring from base-50 defaults to evidence-weighted (per separate spec).

## 7. Contact

Outbound email is in `docs/integrations/cotality-outreach-email.md`.
PDF scoping brief at `/mnt/documents/Cotality_Integration_Scoping.pdf`.

## 8. Do-Not-Patch List

Once Cotality is live, do **not** propose free-API patches for branches 1–4, 6, 7, 10. Update this doc instead.
