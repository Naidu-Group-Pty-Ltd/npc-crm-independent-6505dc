# Market Updates Phase 4 — central LLM routing

Market classification, digest generation and grounded Q&A now use the shared
`_shared/llmRouter.ts` contract. No Market Updates function reads a provider key or
calls the Lovable gateway directly. Model Hub assignments control route, model,
fallback chain, sampling, token limits and reasoning effort.

Apply `20260726170000_market_updates_central_llm_router.sql` before deploying the
changed functions. It adds four assignments (`market_updates_classifier`,
`market_updates_digest`, `market_updates_qa_fast`, `market_updates_qa_deep`) only
when absent. Existing administrator selections are preserved with `ON CONFLICT DO
NOTHING`. New environments reuse an enabled OpenRouter assignment when one exists,
with gateway fallbacks; otherwise they receive the existing safe gateway default.

The migration adds assignment active/test state and safe AI telemetry to updates,
digests and questions. Persisted attempts contain route, model, success and HTTP
status only—not provider response bodies or credentials. Ingestion performs one
classifier readiness probe before source processing. All-provider failure returns a
controlled provider error instead of claiming classification or generation worked.

Q&A chooses the fast or deep assignment from question complexity. Citation and
retrieved-update validation remains unchanged. The existing SSE client contract is
preserved by emitting start, delta, metadata and done events after the routed call;
metadata contains the actual model and route used.
