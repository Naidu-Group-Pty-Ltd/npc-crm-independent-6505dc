# Market Updates Phase 8 — grounded Ask AI

Ask AI now uses exact-origin CORS and CSRF protection, retains module permissions, rate limits, conversation ownership, published-only retrieval and active segment scope, and routes simple/complex questions through the central fast/deep assignments.

Retrieval and provider failures are returned as explicit safe operational errors rather than being disguised as insufficient context. Model citations and key figures are retained only when they map to retrieved published updates; ungrounded output is refused. Responses include limitations, follow-ups, key figures, horizon, sentiment, model and route telemetry.

Streaming retains the existing SSE contract with non-streaming fallback, while deliberate aborts do not trigger another provider call. The UI exposes Cancel, aborts requests when conversations change, and uses request identities to prevent stale deltas or results entering a new conversation.

This repository phase does not deploy the function or perform live provider/browser acceptance, which remain pending authorised infrastructure and a runnable frontend environment.
