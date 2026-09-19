# Market Updates — tiered publication policy

The flat 55-point AI-confidence gate was measuring *model certainty*, not source
quality, so regulators and official statistics agencies were being held out of the
feed whenever the classifier was timid or fell back to heuristics. Publication is
now keyed off `market_sources.reliability_tier`.

| Tier | Reliability tiers | Confidence floor | Relevance floor | Heuristic classification |
|---|---|---|---|---|
| 1 | `official`, `partner`, `institutional_research` | none | `MARKET_RELEVANCE_THRESHOLD` (40) | Accepted |
| 2 | `tier_1_media`, `industry` | `MARKET_TIER2_CONFIDENCE_FLOOR` (40) | `MARKET_TIER2_RELEVANCE_FLOOR` (55) | Rejected |
| 3 | everything else (`watchlist`, unclassified) | `MARKET_AI_CONFIDENCE_THRESHOLD` (55) | 40 | Rejected |

Non-negotiable at every tier: a real canonical citation and a usable summary. An
item missing either has nothing to render or attribute, so it is still held.

`publication_reason` records which rule applied
(`tier_1_authoritative_source_auto_published`,
`tier_2_source_meets_tiered_thresholds`, `operator_manual_publication`). A new
`relevance_below_tier_publication_floor` candidate reason distinguishes Tier 2
noise from low-confidence classification.

Shadow sources are unaffected: `publishable` is still recorded and the item is
still held, which is the measurement shadow mode exists to produce.

## Operator surface

The Candidate review modal is retired. Held items are managed in place on the
Market News Feed through the **Published / Held** scope chips, each item showing
its hold reason, relevance and confidence, with a **Publish to feed** action.
That action calls `market-updates-curate` with `action: 'publish'`, which promotes
only a live, public, non-archived `candidate` row (a shadow row can never be
promoted — the database check constraint forbids a published shadow row).

Existing held rows were backfilled against the same policy at rollout.
