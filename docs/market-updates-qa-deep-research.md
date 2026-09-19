# Market News Feed — Ask Aurixa deep research

Ask Aurixa answered thinly: asking a question about a feed card returned a
paraphrase of that card. This document records why, what replaced it, and the
contracts that must hold.

## Why the answers were thin

Five compounding causes, all upstream of the model:

1. **Single-article tunnel vision.** The dialog sent `updateIds: [thisUpdate.id]`
   and the endpoint applied it as `.in('id', updateIds)` — a *filter*. Context
   was exactly one row, so the answer could not contain anything the card did
   not already show.
2. **Half the record never reached the prompt.** The select stopped at
   `ai_summary`, `why_it_matters` and `key_points`. `public_excerpt`,
   `raw_excerpt`, `property_implications`, `finance_implications`,
   `policy_implications`, `risk_flags`, `lending_criteria_tags`, `legal_topics`,
   `economic_topics`, `legal_status`, `author` and `source_authority` were all
   populated by ingestion and then discarded at query time.
3. **A hard length cap.** The prompt said "under 260 words" and the agent keys
   carried `max_tokens` of 900 (`_fast`) and 1400 (`_deep`).
4. **Semantic search existed but was never used.** `market_updates.embedding`
   (1536-dim, ivfflat-indexed, backfilled hourly since Phase 6) was never
   queried. The endpoint ran `ILIKE` and labelled the result `retrieval_mode:
   'vector'`.
5. **Fake streaming.** The full answer was generated, then replayed word-by-word
   at 12 ms/word. The user waited the whole model latency on a spinner, then
   watched a typewriter animation of text that already existed.

## What replaced it

Four stages. The parallelism is the point: depth costs one round trip per
stage, not one per strategy.

### 1. Query planning (`market_updates_qa_planner`)

A small, fast call that repairs typos, resolves `this`/`it`/`that` against the
conversation and the update in focus, emits 2–5 *complementary* search queries
(the event, its mechanism, the policy context, the wider trend, counter-evidence)
and names the entities involved. Failure is non-fatal — retrieval falls back to
heuristic term extraction and the answer still runs.

### 2. Parallel retrieval + reciprocal rank fusion

All strategies are issued concurrently via `Promise.allSettled`:

| Strategy | Weight | Notes |
| --- | --- | --- |
| `semantic:N` | 1.4 | `match_market_updates` RPC, one per planned query |
| `fulltext:N` | 1.1 | `websearch` tsquery over `search_tsv` |
| `lexical` | 1.0 | ILIKE over planner entities — catches proper nouns stemming mangles |
| `conversation` | 0.9 | sources cited earlier in the thread |
| `neighbourhood:segment` | 0.7 | other coverage sharing the focused update's segments |
| `neighbourhood:region` | 0.6 | same geography/category |
| `recent` | 0.45 | recent pool; guarantees a non-empty corpus |

Merged by RRF (`score = Σ weight/(k + rank)`, k=60), then re-scored with
recency, impact and source authority, then spread across publishers (max 3 per
source, overflow demoted rather than dropped).

**`updateIds` is now a pin, not a filter.** The focused update is placed first
and never trimmed; everything else is retrieved *around* it.

A failing or unavailable strategy simply contributes no votes.

### 3. Concurrent synthesis behind a grounding gate

Two calls run at once:

- **Evidence pass** (`_fast` / `_deep` / `_research` by depth) — a tool call
  returning `used_ids`, `key_figures`, per-audience `implications`, `timeline`,
  `watch_items`, `contrarian_view`, `confidence`, `limitations`. This is the
  authority on grounding.
- **Narrative pass** (`market_updates_qa_narrative`) — streams the sectioned
  markdown dossier with inline `[[N]]` citation markers.

The narrative streams into a buffer. Deltas are released to the client **only
once the evidence pass validates the cited ids**. If validation fails, the
buffer is discarded and the legacy refusal is returned instead. The two calls
overlap, but unverified text is never shown — the pre-existing grounding
guarantee is unchanged.

`[[N]]` markers are rewritten to `[[<uuid>]]` before persistence so the client
can resolve them to source chips regardless of later reordering.

### 4. Depth

One dial, auto-selected from the question and overridable in the UI:

| Depth | Context | Word budget | Queries |
| --- | --- | --- | --- |
| `brief` | 8 | 200 | 2 |
| `standard` | 16 | 550 | 3 |
| `deep` | 26 | 1100 | 5 |

An explicit user choice always beats the planner's read of intent.

## Client

- `MarketQAAnswer` renders sectioned markdown, resolves `[[id]]` markers to
  numbered source chips, and shows figures, per-audience implications, the
  timeline, the contrarian read and what would change it. Markers that do not
  resolve to a retrieved source are **stripped, not rendered** — an
  unresolvable citation is a grounding gap.
- `MarketQAProgress` renders the `stage` SSE events (planning → searching →
  reading → analysing) with the planned queries and the retrieved counts, so a
  longer answer does not read as a hang.
- `MarketQADepthSelector` exposes Auto / Quick / Standard / Deep dive.
- `SharedMarketQAAnswer` uses the same renderer; raw markers and literal `##`
  would otherwise leak onto the public share page.

## Contracts that must hold

- **Security envelope is unchanged.** `supabase/functions/market-updates-qa/tests/security-contract.test.ts`
  asserts 18 exact strings across auth, CSRF, rate limiting, the signed internal
  path, published-only retrieval and the grounding-validation message. All are
  preserved. Do not reword them.
- **`match_market_updates` is `SECURITY DEFINER`** and hard-filters to
  `status = 'published' AND archived_at IS NULL`. It can never widen what a
  caller may already read. Execute is granted to `service_role` only.
- **Both response paths return the same depth.** The narrative pass runs on the
  JSON path too, so scheduled callers (`market-qa-subscriptions`,
  `market-qa-digest-runner`) and the client's non-streaming fallback are not
  quietly downgraded.
- **`segments` and `geography` are `jsonb`.** Overlap must be expressed as an OR
  of single-element `contains` filters — PostgREST `overlaps` maps to the array
  `&&` operator and errors on jsonb.
- **Existing model assignments are preserved.** The migration lifts the seeded
  `max_tokens` on `_fast`/`_deep` only where they still sit at their seeded
  values (900/1400), so an administrator's tuning is never overwritten.

## Tests

`src/lib/__tests__/marketQaResearch.test.ts` covers the ranking maths, which is
where a silent regression would degrade answers without failing anything else:
RRF agreement and weighting, source diversity as demotion rather than deletion,
pinning the focused update, anchor boosting, citation remapping (raw id, `[[N]]`
marker, bare index, unresolvable), inline marker rewriting, and depth
classification.
