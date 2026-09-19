# Market Updates Phase 5 — ingestion and publication decisions

Phase 5 makes each source item outcome explicit and auditable. The additive migration records publication/candidate reasons, AI status and safe validation failures, while retaining existing rows and statuses.

The ingestion worker now bounds source and item concurrency, enforces a full-run deadline, opens a provider circuit after repeated failures, validates router tool output against supported enums, preserves only the adapter's canonical citation, and checks every item mutation before incrementing counters. Invalid source items are rejected, low-relevance items are ignored, heuristic results are candidates, and only validated routed results meeting the configured threshold are published.

Unpublished review reads are exposed through the existing authoritative status contract only to administrators. This phase does not apply the migration or deploy functions; those production actions remain subject to authorised deployment verification.
