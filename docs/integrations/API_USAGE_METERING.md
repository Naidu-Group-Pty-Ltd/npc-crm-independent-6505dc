# API usage metering — this deployment may be spending someone else's money

## The situation

A workspace provisioned by **Aurixa Mission Control** is a clone of this repo's
Supabase architecture, and it boots with the prime's own vendor keys forwarded
into its project: `OPENAI_API_KEY`, `RESEND_API_KEY`, `DOMAIN_API_KEY`,
`COTALITY_API_KEY`, `LOVABLE_API_KEY` and the rest. That is what stops every
edge function 500-ing on a secret shell on day one.

It also means every model token, transactional email and property lookup that
workspace makes is billed to the *prime's* vendor accounts. Mission Control
recharges it per tenant. A workspace that supplies its own key for a given
secret costs the prime nothing for that key and is charged nothing for it.

**The prime install itself is never charged** — a tenant with no clone is
Mission Control's own project. Nothing here changes what this repo costs to run
in its home deployment; it makes the same calls attributable when the code is
running somewhere else.

## What this repo contributes

Nothing decides billing here. This repo's job is to say *what was consumed and
on which credential*; Mission Control decides whose key it was, from its own
record of what it forwarded.

| file | role |
|---|---|
| `_shared/logApiUsage.ts` | already writes every metered call to `api_usage_log` — unchanged, and still the only place call sites touch |
| `_shared/meteredFetch.ts` | drop-in `fetch` that resolves the credential from the URL and meters the call |
| `_shared/apiUsageBilling.pure.ts` | `service_name` and vendor host → the secret name spent, and what one unit of it is. Pure, tested |
| `report-api-usage/` | cron worker that drains the queue into Mission Control |
| `_shared/missionControl.ts` | `reportApiUsage()` — the only place that talks to the metering API |
| migration `…_api_usage_mission_control_forwarding.sql` | the queue columns and the claim/mark RPCs |

## Why a worker and not an inline call

Metering on the request path puts a network hop in front of a client's report to
buy a billing nicety, and loses the call outright whenever Mission Control is
slow. Rows queue in `api_usage_log` instead and `report-api-usage` drains them in
batches of 200, so an outage delays revenue rather than destroying it.

The **row id is the idempotency key**. The worker retries; without a stable key
a re-sent batch would meter the same calls twice. Mission Control dedupes on
`(tenant, idempotency_key)` and returns the original rating.

## The queue

`api_usage_log` gained four columns:

- `mc_reported_at` — NULL means still queued
- `mc_attempts` — at 5 the row leaves the partial index and needs an operator
- `mc_last_error`
- `mc_billing_reason` — Mission Control's verdict: `inherited` (billed), `byok`,
  `no_key`, `unknown_secret`, `not_billable`, `error_call`, `rate_missing`

`api_usage_forwarding_status()` gives pending / stuck / reported / billed /
own-key / unbillable counts and the oldest pending row.

`claim_api_usage_for_forwarding()` deliberately narrows what the worker can read
to the fields metering needs — `api_usage_log` carries request metadata that has
no business leaving this project. Rows older than 30 days are skipped: Mission
Control will not accept them, so retrying them forever is pure waste.

Claim and mark are separate RPCs so a partial failure marks only what actually
landed. An all-or-nothing update would either re-bill the accepted rows or
silently drop the rejected ones.

## Adding a vendor

Two rules, both cheap to get wrong:

1. **`service_name` must be in the map.** `apiUsageBilling.pure.ts` resolves
   `service_name` → secret name. It is deliberately explicit — no fuzzy
   matching, no "closest key" fallback. An unmapped service is metered here and
   **never billed**, because guessing bills the wrong tenant, which is worse
   than not billing. Aliases are handled (`ghl` / `gohighlevel`, `lovable-ai` /
   `lovable-ai-gateway`), but a new vendor needs a real entry.

2. **Or name the credential at the call site.** `metadata: { secret_name:
   "OPENROUTER_API_KEY" }` wins over the map. That is how a new vendor gets
   billed before this file learns about it.

Then add a matching row to Mission Control's `api_provider_rates`, or the call
lands as `rate_missing` on its dashboard.

`service_name` is a vendor, not a credential: `google-maps` and `google-ai` are
the same vendor and separate bills. Keep them apart.

## `meteredFetch` — how a call gets metered now

Instrumenting by hand meant a rule ("remember to log") that decays the moment
somebody adds the next function, and one chance per call site to attribute the
spend to the wrong credential. `_shared/meteredFetch.ts` wraps the thing the
author was already writing instead:

```ts
import { meteredFetch } from "../_shared/meteredFetch.ts";

const res = await meteredFetch("https://api.resend.com/emails", init);
```

That is the whole change. The URL already says which credential it spends, so
`secretForUrl` resolves it; token-priced vendors have their token count read off
the response via `clone()` so the caller's body is untouched; the log write is
fire-and-forget and cannot fail the call that earns the revenue. It builds its
own service-role client from env, so no plumbing reaches the call site.

Two rules it cannot infer for you:

- **Self-hosted sidecars need an explicit credential.** WeasyPrint, the PDF
  parser and the AML service take their URL from env and have no fixed host, so
  they pass `{ secretName: "WEASYPRINT_SERVICE_TOKEN" }`.
- **A request that consumes more than one unit must say so.** One Resend call
  can send 50 emails; pass `{ quantity: 50 }`.

Never add `meteredFetch` to a call site that already calls `logApiUsage` for the
same request — that bills the tenant twice, which is worse than not billing.

## Instrumentation coverage

Coverage bounds everything: a call that never reaches `logApiUsage` or
`meteredFetch` is invisible to the meter, and the billing dashboard can only
show what it was told about.

| | edge functions metered |
|---|---|
| Before | 27 of 413 |
| After the sweep | **61 of 413** |

The sweep converted 51 direct vendor `fetch` calls across 38 functions, plus two
shared clients that cover many routes at once — `weasyprintClient.ts` (all
eleven PDF render routes) and the PDF-parse sidecar dispatcher.

### Model calls: metered at the router, opt-out at the caller

`_shared/llmRouter.ts` is the choke point for the gateway, OpenAI, Anthropic,
Perplexity, OpenRouter and Gemini, and it now meters every call it makes.

Measured before the change: **25 edge functions call `callLLM`/`callLLMRaw`, and
19 of them never logged anything** — including `report-qa`,
`parse-template-document` and `vapi-call-webhook`, whose only `logApiUsage`
calls turned out to be for embeddings or a different vendor entirely. Those were
spending a forwarded key for free.

Exactly **6 functions log adjacently to their own call** and would otherwise be
billed twice, which is worse than not billing. They opt out explicitly:

| function | call sites opted out |
|---|---|
| `email-copilot` | 7 |
| `clean-note-transcript` | 1 |
| `generate-chart-analysis` | 1 |
| `estimate-property-expenses` | 1 |
| `parse-property-pdf` | 2 |
| `format-comparison-report` | 1 |

The flag is `meterUsage`, and it **defaults to true** — the whole liability was
silence, so an omitted flag must never mean unbilled. `email-copilot` has an
eighth `callLLM` with no adjacent logging; it is deliberately NOT opted out.

Which credential a call spent is resolved by
`_shared/llmUsageBinding.pure.ts`, which mirrors the router's own `(route,
modelId)` dispatch. An unrecognised model family returns **null**, and the
router then logs nothing and warns — a `service_name` the map does not know is
metered and never billed, and a wrong one bills the wrong tenant. A CI test
reads the router's source and fails if a new `modelId.startsWith(...)` branch
appears that the resolver cannot bind.

`template-design-agent` does not go through the router: it calls the Anthropic
Messages API directly via `_shared/claudeReconstruct.ts`, which meters
unconditionally against `ANTHROPIC_API_KEY`.

The remaining uninstrumented functions that touch a billable credential are
those whose vendor URL is assembled from a variable the sweep could not resolve
statically.

## Deployment

- `verify_jwt = false` in `config.toml`; the function authenticates itself with
  `INTERNAL_EDGE_SECRET` or the cron secret, constant-time compared. It reads a
  billing queue and is never public.
- Registered `cron-worker` in `functions-registry/SECURITY_REGISTRY.json`.
- Schedule it hourly via pg_cron with `x-internal-edge-secret`. Frequency only
  affects how fresh Mission Control's dashboard is; a missed run costs nothing
  because the queue drains on the next one.
- Requires `MISSION_CONTROL_URL` and `MISSION_CONTROL_CLONE_API_KEY`, and that
  key must carry the **`usage:report`** scope. Without the scope the worker
  gets 401s, the retry counter burns out, and nothing is ever billed — silently.

## The other side

Mission Control's contract, the billability rule, the rate catalog and
settlement: `docs/prime-repo-api-usage-metering.md` in `aurixa-mission-control`.
