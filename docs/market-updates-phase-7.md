# Market Updates Phase 7 — deterministic, durable digests

Digest periods now resolve to canonical UTC buckets and a stable `period_key`. The digest lifecycle is persisted as `queued`, `generating`, `published`, `no_data`, or `failed`, and retries upsert the same period key rather than creating a moving-window duplicate.

Only published source-backed updates within the half-open canonical window are supplied to the central `market_updates_digest` assignment. Returned top-update IDs are restricted to the retrieved records. No-data rows retain candidate counts and the last published date with a remediation message. Post-ingestion digest invocation is awaited, and failures are returned as ingestion warnings instead of relying on fire-and-forget execution.

This repository phase does not apply migrations or deploy functions. Live deployment and acceptance remain pending authorised Supabase access.
