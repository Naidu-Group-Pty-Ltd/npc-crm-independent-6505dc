# Property Data API Integration Architecture

**Providers:** CoreLogic (RP Data / Cotality) · SQM Research · Totality
**Status:** Specification — pre-integration
**Last updated:** 2026-04-28
**Owner:** Platform / Integrations
**Related memory:** `mem://integrations/dual-ghl-migration`, `mem://architecture/secure-external-api-proxy-pattern`, `mem://features/reports/financial-logic-fallbacks`

---

## 0. Executive Summary

This document defines the canonical architecture for integrating three external property-data providers into the dashboard:

| Provider | Role | Primary Use |
|----------|------|-------------|
| **CoreLogic (RP Data / Cotality)** | Foundational property database | Historical sales, AVM, suburb/LGA market trends, demographics, hazard risk |
| **SQM Research** | Real-time rental fluidity | Live vacancy rates, days-on-market, asking rents |
| **Totality** | Investment engine + new-build inventory | Land+build packages, acquisition costs, depreciation, 10-year projections, scenario modelling |

These providers are **complementary, not redundant**. CoreLogic provides the *baseline truth* for established properties; SQM provides the *live pulse* of the rental market; Totality provides the *forward-looking financial model* for new-build investment scenarios.

The integration must follow our existing **Secure External API Proxy Pattern** (see `mem://architecture/secure-external-api-proxy-pattern`): all third-party calls go through edge functions that inject credentials server-side, never from the browser.

---

## 1. CoreLogic (RP Data / Cotality) — Endpoint Map

CoreLogic is the **system of record for established/titled properties**, market trends, and risk overlays.

### 1.1 Endpoint Inventory

| Endpoint / Service | Data Points | Mapped Report Field (Manor Lakes example) | Dashboard Purpose |
|--------------------|-------------|-------------------------------------------|-------------------|
| **Property Master / Attributes API** | Beds, baths, land area, build area, property type | `House, 4 Bed, 2 Bath, 350m² Land, 158m² Build` | Validates developer specs against registered titles |
| **AVM (Automated Valuation Model) API** | Estimated value, confidence band, comparable sales | Baseline check vs `$686,467` purchase price | Automated price-check / overpayment risk flag |
| **Market Trends API** | Suburb / LGA / State growth, median price history | Suburb 4.2% · LGA 3.9% · State 4.8% | Powers Growth Trajectory charts; validates 10-year projection inputs |
| **Rental Market Trends API** | Median rent, gross yield, tenant profile | $500/wk median · 3.64% gross yield · 85% family | Cross-checks aggressive developer rent estimates |
| **Demographics API** (CoreLogic + ABS overlay) | Population, median age, income, SEIFA deciles | Pop 5,000+ · Age 32 · $2,745/wk · IRSAD 8/10 | Tenant serviceability proof (rent-to-income %) |
| **Hazard Insight API** | Bushfire (BAL), flood, coastal erosion, contamination | BAL-19 typical · flood unverified | Auto-populates Risk Assessment flags (CFA/AFRIP triggers) |

### 1.2 Implementation Notes

- **Auth:** OAuth 2.0 client credentials. Token refresh handled in edge function; never store tokens client-side.
- **Required secret:** `CORELOGIC_CLIENT_ID`, `CORELOGIC_CLIENT_SECRET`.
- **Edge function:** `supabase/functions/corelogic-proxy/index.ts` — single proxy with sub-routes per endpoint family (`/property`, `/avm`, `/trends`, `/rental`, `/demographics`, `/hazard`).
- **Cache layer:** All responses cached in `corelogic_cache` table keyed by `endpoint + params_hash` with TTLs:
  - Property attributes / demographics → 30 days
  - AVM → 7 days
  - Market trends → 7 days
  - Hazard → 90 days
- **Rate limits:** CoreLogic enforces per-minute and daily caps. Edge function must implement token-bucket throttling and return `429` with `Retry-After` to the client.

### 1.3 The "Unregistered Lot" Fallback

For new builds (e.g. Lot 20427), the Property Master API will return `NULL` because the lot has no title yet.

**Fallback chain:**

```
1. CoreLogic Property API (lot)        → NULL
2. Totality Inventory API (lot specs)  → returns dev-supplied beds/baths/area
3. CoreLogic Suburb Trends API (3024)  → returns valuation benchmark
4. Dashboard composes: specs (Totality) + valuation context (CoreLogic suburb)
```

This logic lives in the proxy, not the client — the frontend always receives a unified property object regardless of which source filled which field. A `_data_provenance` field on the response records which provider supplied each attribute (for audit and report disclosures).

---

## 2. SQM Research — Endpoint Map

SQM is the **gold standard for live rental fluidity metrics**. We already have a partial integration via `supabase/functions/sqm-rent-service/index.ts` (Firecrawl-scraped). This section documents the **direct API replacement**.

### 2.1 Endpoint Inventory

| Endpoint / Service | Data Points | Mapped Report Field | Dashboard Purpose |
|--------------------|-------------|---------------------|-------------------|
| **Vacancy Rates API** | Suburb + postcode-level vacancy %, 12-month trend | Manor Lakes 1.8% vs Wyndham LGA 2.9% | Rental Risk Score; "outperforming LGA by X%" badge |
| **Days on Market (DOM) API** | Median sell + rent DOM, trend | Manor Lakes 32 days vs Wyndham 42 days | Liquidity score; tenant-acquisition speed estimate |
| **Asking Rents / Yields API** | Live asking rents by bed count + property type | $500–$590 range vs national 4.2% benchmark | Validates that developer rent assumption is achievable |

### 2.2 Implementation Notes

- **Auth:** API key in `Authorization` header.
- **Required secret:** `SQM_API_KEY`.
- **Edge function:** Refactor existing `sqm-rent-service` to add a `mode: 'api' | 'scrape'` switch — preferring the API and falling back to Firecrawl scrape only if API fails (preserves current resilience).
- **Cache:** `median_rent_cache` table is reused. Add `vacancy_rate`, `dom_sell`, `dom_rent` columns. TTL 30 days for vacancy/DOM, 7 days for asking rents.
- **Realtime hook:** `useSqmMarketPulse(suburb, postcode, propertyType)` returns `{ vacancy, dom, asking, isStale, refresh() }`.

---

## 3. Totality — Endpoint Map

Totality is the **investment computation engine**. It owns: new-build inventory, acquisition cost calculation, construction-stage interest, depreciation schedules, and 10-year projections.

### 3.1 Endpoint Inventory

| Endpoint / Service | Data Points | Mapped Report Field | Dashboard Purpose |
|--------------------|-------------|---------------------|-------------------|
| **Project & Inventory API** | Subdivisions, lot pricing, build contracts, floorplans | Lot 20427 Richburg Rd · Land $340k + Build $346k = $686,467 | Source-of-truth for H&L package pricing |
| **Acquisition Costs API** | State stamp duty, legal, deposits | Stamp $15,470 · Legal $1,800 · Land dep $34,000 · Build dep $17,323 | Calculates "Total Funds to Complete" ($86,834) per state law |
| **Construction / Staging API** | Build timeline, capitalised interest | 7-month staged interest $18,240 | Holding-cost calc during build; drives Year 1 negative cashflow |
| **Operating Expenses Engine API** | Council, water, PM fees, insurance, land tax | Council $2,000 · Water $1,100 · PM 7.5% · Insurance $2,000 · Land Tax $1,470 (VIC) | Year 1 outflow column with live state tax rules |
| **Tax & Depreciation Engine API** | BMT/QS depreciation schedule, marginal tax bracket | Tax 30% · Yr1 dep $20,000 · Refund $11,586 | Pre-tax → after-tax cashflow transition |
| **10-Year Projections Engine API** | Capital growth, compounding cashflow, terminal value | Yr10 value $1,097,065 · 10yr deficit -$136,813 · Net yield Yr1 3.20% | Headline wealth-creation numbers |
| **Scenario Modelling API** ⚠️ critical | Recompute on rate / LVR / rent / growth deltas | 90% LVR @ 7.5% → deficit $27,771 | Powers interactive sliders (rate, LVR, rent) for live recalc |

### 3.2 Implementation Notes

- **Auth:** Bearer token (per-tenant). Token rotation supported.
- **Required secrets:** `TOTALITY_API_KEY`, `TOTALITY_TENANT_ID`.
- **Edge function:** `supabase/functions/totality-proxy/index.ts` — proxy with sub-routes mirroring the 7 endpoints above. Whitelisted operations only (see `mem://architecture/edge-function-whitelist-governance`).
- **No cache for projections:** Scenario API responses must NOT be cached — they are deterministic functions of user input and caching breaks slider responsiveness. Cache only `inventory` and `acquisition-costs` (TTL 24h).
- **Idempotency:** All write-style calls (e.g. saving a scenario) must include an idempotency key.

---

## 4. Cross-Provider Data Reconciliation

The three providers produce **overlapping but non-identical** values. The dashboard must reconcile them deterministically and surface discrepancies to the advisor.

### 4.1 Rent Estimate Discrepancy Detector

**Problem:** Totality input rent ($590/wk, 4.25% yield) > SQM suburb median ($500/wk, 3.64% yield) by 18%.

**Rule:**

```ts
const variance = (totalityRent - sqmMedian) / sqmMedian;
if (variance > 0.10) {
  flagAdvisor({
    severity: 'warning',
    code: 'YIELD_RISK_DEVELOPER_INFLATED',
    message: `Developer rent ($${totalityRent}) exceeds SQM median ($${sqmMedian}) by ${(variance*100).toFixed(1)}%.`,
    recommendation: 'Re-run cashflow at SQM median and present both scenarios to client.'
  });
}
```

This rule lives in `src/utils/rentVarianceDetector.ts` and runs on every cashflow render.

### 4.2 Valuation Benchmark Detector

**Problem:** Purchase price > CoreLogic AVM upper-band by >5%.

**Rule:** Flag `OVERPAYMENT_RISK` and require advisor acknowledgement before report can be marked "client-ready".

### 4.3 Provenance Tracking

Every numeric field surfaced in a report carries a `_source: 'corelogic' | 'sqm' | 'totality' | 'manual'` tag. PDF disclosures auto-list which provider sourced which figure (compliance requirement).

---

## 5. Architecture — Edge Function Layout

```
supabase/functions/
├── corelogic-proxy/         # CoreLogic OAuth + 6 endpoint families
├── sqm-rent-service/        # SQM API (existing, to be upgraded from scrape-only)
├── totality-proxy/          # Totality 7 endpoints + scenario engine
└── _shared/
    ├── auth.ts              # existing — verifyAuth pattern
    ├── propertyDataCache.ts # NEW — shared cache helpers
    └── providerProvenance.ts # NEW — _data_provenance tagging
```

All three proxies follow our standard:

1. `verifyAuth()` from `_shared/auth.ts` — validates session token (see `mem://auth/edge-function-cors-and-auth-standard`).
2. Whitelist input validation via Zod.
3. Server-side credential injection (`Deno.env.get`).
4. Cache check → upstream fetch → cache write → response.
5. CORS via `createCorsHeaders(origin)`.
6. Errors return structured `{ error, code, retryable }` — never raw upstream payloads.

---

## 6. Database Schema Additions

```sql
-- CoreLogic response cache
CREATE TABLE public.corelogic_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  params_hash text NOT NULL,
  response jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (endpoint, params_hash)
);
CREATE INDEX idx_corelogic_cache_lookup ON public.corelogic_cache (endpoint, params_hash, expires_at);

-- Extend existing median_rent_cache with vacancy + DOM
ALTER TABLE public.median_rent_cache
  ADD COLUMN dom_sell integer,
  ADD COLUMN dom_rent integer,
  ADD COLUMN data_provider text DEFAULT 'sqm_scrape';  -- 'sqm_api' | 'sqm_scrape'

-- Totality scenario snapshots (for audit & report repro)
CREATE TABLE public.totality_scenario_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  property_id uuid,
  inputs jsonb NOT NULL,
  outputs jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

All three tables follow the **service_role-only RLS standard** (see `mem://architecture/secure-data-mediation-and-rls-standard`).

---

## 7. Required Secrets

Add via the secrets tool before deployment:

| Secret | Provider | Scope |
|--------|----------|-------|
| `CORELOGIC_CLIENT_ID` | CoreLogic | OAuth client ID |
| `CORELOGIC_CLIENT_SECRET` | CoreLogic | OAuth client secret |
| `CORELOGIC_API_BASE_URL` | CoreLogic | Region-specific base (AU prod) |
| `SQM_API_KEY` | SQM Research | API key |
| `TOTALITY_API_KEY` | Totality | Bearer token |
| `TOTALITY_TENANT_ID` | Totality | Tenant identifier |
| `TOTALITY_API_BASE_URL` | Totality | Tenant-specific base URL |

---

## 8. Strategic Red Flags (Integration Risks)

| # | Risk | Mitigation |
|---|------|------------|
| 1 | **Unregistered lot returns NULL from CoreLogic** | Provenance fallback chain (§1.3) |
| 2 | **Developer rent inflation vs SQM median** | Variance detector + advisor flag (§4.1) |
| 3 | **CoreLogic rate limits during bulk client review** | Token-bucket throttle + 30-day cache + queue background refresh |
| 4 | **Totality scenario API latency on slider drag** | Debounce 250ms + show stale-while-revalidate skeleton |
| 5 | **Provider outage** | Each proxy returns `{ degraded: true, source: 'cache_stale' }` rather than failing — UI shows amber freshness badge |
| 6 | **PII / compliance — sending client data to Totality** | Only property + financial inputs go upstream; never names, emails, phone (see `mem://features/marketing/market-intelligence-nurturing-system` PII rules) |
| 7 | **Cost control** | Per-user daily call budget tracked in `api_usage_log`; superadmin dashboard at `/api-usage` |

---

## 9. Phased Rollout Plan

| Phase | Scope | Gate |
|-------|-------|------|
| **0** | Secrets + edge function scaffolds + cache tables | All three proxies return mock data |
| **1** | CoreLogic — Property + AVM + Market Trends only | Validated against 5 known properties |
| **2** | SQM — upgrade from scrape to API | A/B compare with existing scrape for 30 days |
| **3** | Totality — Inventory + Acquisition Costs + Operating Expenses | Reproduces Manor Lakes report values exactly |
| **4** | Totality — Tax/Depreciation + 10-Year Projections | Matches the existing in-house cashflow engine within 1% |
| **5** | Totality — Scenario Modelling + interactive sliders | UX live in PropertyInsights modal |
| **6** | Cross-provider reconciliation rules + provenance disclosures | Compliance sign-off |

---

## 10. Open Questions for Provider Onboarding

Before contracts are signed, confirm with each vendor:

**CoreLogic:**
- Is the AU "Cotality" rebrand changing endpoint hostnames? (token URL impact)
- Per-call vs per-property pricing tier?
- Bulk endpoint for batch suburb refresh (avoid N+1)?

**SQM:**
- Is the API offering parity with the public web data, or is some metrics web-only? (determines whether we keep the Firecrawl fallback)
- Postcode-level vs suburb-level granularity for vacancy?

**Totality:**
- Multi-tenant: do client portal users get scoped tokens, or do we proxy everything via our service tenant?
- Webhook support for inventory price changes (otherwise we poll daily)?
- Sandbox environment for scenario-engine validation?

---

*End of specification. Implementation tickets to be created against §9 phases once vendor contracts are confirmed.*
