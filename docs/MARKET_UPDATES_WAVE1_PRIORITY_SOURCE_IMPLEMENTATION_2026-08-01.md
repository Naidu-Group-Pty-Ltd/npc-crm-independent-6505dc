# Market Updates — Wave 1 priority source implementation (2026-08-01)

## Existing-state audit

Before this change: **23 canonical sources enabled**. The ingestion engine already supported
`rss`, `rss_multi`, `rss_with_html_fallback`, `feed_with_html_fallback`, `html_listing`,
`official_api` and `licensed_partner_feed` via `adapters/index.ts`. No new adapter type was
needed — every source below is served by an existing adapter.

Two pre-existing assets were found and reused rather than duplicated:

- `supabase/functions/abs-data-service` already integrates `api.data.abs.gov.au`. A second
  ABS API client was therefore **not** built; this PR adds ABS *media-release metadata*,
  which is a different concern from the statistical Data API already in place.
- `supabase/functions/market-source-relay` (added 2026-07-28) is an allow-list-only fetch
  relay written for exactly the RBA problem. It is reused in the remediation guidance.

Registry contract, anchor-pattern safety rules and the `sourceDomains` apex/www trap are
documented in `MARKET_UPDATES_SCHEMA_DRIFT_INVESTIGATION_2026-07-28.md`.

## Method

No source was enabled on the strength of an HTTP 200. Every endpoint was fetched live and
parsed through a faithful port of the adapter's own logic — including `isSafeAnchorPattern`
— and only sources returning genuine, dated article metadata were enabled.

## Results

| # | Source | Adapter | Verified | State |
|---|---|---|---|---|
| 1 | Reserve Bank of Australia | `rss_multi` | 5 feeds reachable off-network; **403 from project egress** | Disabled — blocked |
| 2 | Australian Bureau of Statistics | `html_listing` | **20 items** live | Enabled |
| 3 | ASIC | `html_listing` | 0 article anchors | Disabled — unextractable |
| 4 | Australian Treasury | `html_listing` | **10 items** live | Enabled |
| 5 | Treasury Ministers | `rss_with_html_fallback` | 10 items, newest 2026-07-30 | Enabled |
| 6 | NHSAC | `html_listing` | **4 items** live | Enabled |
| 7 | Commonwealth Bank Economics | `html_listing` | **6 items** live | Enabled |
| 8 | Westpac IQ Economics | `html_listing` | 3 items | Enabled |
| 9 | NAB Economics | `rss_with_html_fallback` | feed 404 | Disabled |
| 10 | ANZ Institutional Insights | `html_listing` | 13 items | Enabled |
| 11 | Domain Research | `feed_with_html_fallback` | feed 403 | Left disabled |
| 12 | Cotality Australia | unchanged | already healthy | Untouched |
| 13 | AFR | `licensed_api` | not fetched | Licence pending |
| 14 | Reuters | `licensed_api` | not fetched | Licence pending |
| 15 | Bloomberg | `licensed_api` | not fetched | Licence pending |

**Post-change: 43 canonical sources, 30 enabled, 13 disabled. Latest run: 30/30 succeeded,
630 items discovered, zero failing sources.**

## Two extraction defects found and worked around

**Anchor patterns are silently dropped when unsafe.** `isSafeAnchorPattern` allows at most
128 characters, one unbounded quantifier and no lookarounds. The first ASIC pattern used two
unbounded quantifiers and was discarded, yielding zero items with no error. All patterns here
use bounded `{n,m}` repetitions to stay within one unbounded quantifier.

**One junk selector hit suppresses the anchor fallback.** `HtmlListingAdapter` only runs the
anchor step when earlier steps produced nothing. CBA's page yields a single "Latest articles"
match from the default `article` selector, which blocked extraction entirely. Setting
`item_selector` to an unmatchable sentinel took CBA from 1 junk item to 6 real ones. ABS,
Treasury, NHSAC and Westpac use the same approach; ANZ does not, because its selector sweep
legitimately returns 13 articles.

## RBA remediation

Retested 2026-08-01 from the database egress: **still HTTP 403** (Akamai "Access Denied").

This confirms the 2026-07-28 finding: the block follows the **egress region of internal
invocations**, not the request. The same function fetching the same URL returns 200 when
invoked externally and 403 when invoked by `pg_net` or another function. Both automated
paths use the blocked egress, so an in-project relay is blocked identically to its caller.

Two remediations, neither available from inside the project:

1. Have the RBA allow-list the Supabase `ap-southeast-1` egress ranges, then re-enable —
   `feed_urls` already holds all five verified feeds, so no other change is needed.
2. Host `market-source-relay` off Supabase (an Australian-region Cloudflare Worker is the
   natural fit) and point `feed_urls` at it. The relay is written, tested and allow-list-only.

RSS 1.0/RDF parsing — which every RBA feed uses — is already deployed and verified.

## Licensed sources

AFR, Reuters and Bloomberg are registered as `licensed_api`, **disabled**, with exact
credential requirements in `disabled_reason`. No scraping fallback exists for any of them,
by design. Required environment variables are listed in `docs/MARKET_UPDATES_LICENSED_SOURCE_ENV.example`
(kept under `docs/` because the repo `.gitignore` excludes `.env.*`, so a dotfile at the root
would not be committable).
Reuters was converted from its previous scraping configuration — its old HTTP 401 was the
paywall, not a misconfiguration.

## Known limitations / Wave 2

- **Event-level clustering is not implemented.** Deduplication remains URL- and hash-based.
  A cash-rate decision reported by several publishers still produces several cards. This is
  the single largest remaining item and needs its own PR.
- **Shadow mode is not implemented.** New sources went straight to enabled after live
  validation; the relevance threshold and the existing Remove control absorb low-value items.
- **Authority badges are not yet rendered.** `source_authority` is populated correctly for
  every source, so the UI work is unblocked but not done.
- ANZ skews international; Westpac yields only 3 items per fetch.

## Verification

```sql
select source_key, enabled, health_status, left(coalesce(disabled_reason,''),60)
  from public.market_sources where registry_status='canonical' order by enabled desc, source_key;
select status, sources_succeeded, sources_considered, items_discovered
  from public.market_ingestion_runs order by started_at desc limit 1;
```

## Rollback

The migration only upserts by `source_key` and never deletes. To revert, set `enabled=false`
for the keys added here. The pre-existing registry is untouched except for the documented
RBA, Reuters and Domain repairs.
