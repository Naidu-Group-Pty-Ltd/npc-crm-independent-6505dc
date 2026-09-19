# Market Updates Phase 6 — canonical refresh cadence

`refresh_frequency_minutes` is now the only accepted write contract for Market Updates source cadence. The additive migration preserves explicitly configured legacy hour values where the earlier minutes default masked them, constrains cadence to 15 minutes–7 days, and derives the legacy hours column for read compatibility.

The source-admin function validates and persists minutes, calculates each source's next eligible fetch, and bases overdue warnings on minutes. Ingestion freshness checks also use minutes exclusively. The responsive admin control displays minutes and an approximate hours value, only presents Save for a valid changed cadence, and reports mutation success or failure without leaving controls busy.

This repository phase does not apply the migration or deploy functions. Production rollout and browser verification require the authorised deployment environment.
