# Market Updates Phase 13 — focused automated tests

Phase 13 adds one executable repository gate for the Market Updates recovery work. `npm run test:market-updates-phase13` runs behavioural tests for classification validation, deterministic digest buckets, URL normalisation and legal excerpt handling, followed by every Phase 2–12 contract validator.

The behavioural suite covers malformed AI output, enum removal, confidence conversion and bounds, deterministic daily/weekly/bi-weekly/monthly/quarterly/annual keys, tracking-parameter removal, link-only excerpt suppression and excerpt size limits. Existing Deno suites continue to cover source-fetch SSRF/redirect handling, RSS escaping, classifier validation, digest windows and Q&A security/grounding contracts.

The gate deliberately distinguishes repository tests from live acceptance. Provider fallbacks, database failures, RLS identities, cron execution, source network behaviour, browser cancellation and deployed function integration still require the authorised Phase 14 environment; passing Phase 13 does not claim production deployment or repair.
