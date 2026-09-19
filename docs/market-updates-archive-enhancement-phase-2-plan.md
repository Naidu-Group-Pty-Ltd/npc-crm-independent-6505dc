# Market Updates archive enhancement — Phase 2 technical plan

**Plan date:** 2026-08-01

**Scope:** Phase 2 only — implementation design; no runtime, schema, API, or UI changes

**Phase 1 evidence:** repository investigation completed against branch `work`

**Delivery rule:** Phase 3 must implement the database and backend slice before Phase 4 changes the UI

## 1. Objective and non-goals

This plan covers the five requested Market Updates corrections without rewriting
the page or changing its design system:

1. contain Candidate Review within the visible viewport;
2. enlarge Source Coverage and Market Sources administration, including source
   geography;
3. add a six-field `Clear All` action that preserves segment, freshness, and tab;
4. replace operator removal with a server-authoritative 30-day archive, restore,
   management, and purge workflow; and
5. remove user-visible numerical AI confidence from Market Updates surfaces while
   retaining confidence for internal publication and routing decisions.

The work must not change source adapters, publication thresholds, digest periods,
Ask AI grounding, source links, shadow-mode controls, module permissions, or the
existing ingestion cadence except where archived-row exclusions are required.
This enhancement does not alter unrelated application modules or AML contracts.

## 2. Confirmed current architecture

### Front end

- `/market-updates` renders `src/pages/MarketUpdates.tsx` inside the authenticated
  application shell.
- The page loads at most 200 public published updates and performs search, source,
  category, geography, impact, audience, segment, and freshness filtering in
  local React state.
- The main article card, article Analysis dialog, Candidate Review, Ask AI views,
  High Impact Watchlist, and digest presentation are inline in the page.
- Candidate Review uses a `90vh` dialog containing a separately capped `70vh`
  scrolling list.
- `MarketSourcesAdminDialog` is a `90vh`, `max-w-5xl` dialog with one scrolling
  result region. `MarketSourceCoveragePanel` expands inline into three columns.
- Current `clearFilters` also clears segment and freshness and is exposed only in
  the no-results state.
- Current Remove calls `market-updates-curate`, removes the row from local state,
  and renders Undo in a normal document-flow Card beneath the hero.
- Sonner is already mounted globally and is the established viewport-fixed toast
  implementation.

### Backend and data

- `market-updates-status` is the authoritative service-role read boundary. Public
  reads require `market_updates.can_view`; unpublished reads additionally require
  admin access.
- `market-updates-curate` requires `market_updates.can_edit` and conditionally
  transitions `published -> ignored` for hide and the matching operator-hidden
  row back to `published` for restore.
- `market_updates.dedupe_hash` is unique. Ingestion also looks up canonical URL and
  `(source_id, external_id)` across the entire table, so retained archived rows
  naturally continue to suppress rediscovery.
- Digest, RSS feed, QA retrieval, status counts, and embedding backfill query
  `market_updates` independently and therefore each needs an explicit archive
  predicate.
- Market automation uses idempotently scheduled `pg_cron` jobs. A database-local
  purge function is preferable to a new Edge Function because cleanup is a small,
  transactional data lifecycle operation and needs no provider/network access.

## 3. Key design decisions

### 3.1 Archive representation

Use additive metadata on `public.market_updates`:

| Column | Type | Purpose |
|---|---|---|
| `archived_at` | `timestamptz null` | Authoritative UTC archive time and retention anchor. |
| `archived_by` | `uuid null references auth.users(id) on delete set null` | Operator identity when available without blocking user deletion. |
| `pre_archive_status` | `text null` | Original state required for a safe restore decision. |

Do **not** add a redundant boolean or `archive_status`. A row is archived exactly
when `archived_at is not null`. Keep the existing status during archive instead of
adding `archived` to the shared status vocabulary. This avoids breaking ingestion
statistics, status check constraints, candidate reasons, RLS assumptions, and old
consumers. Active reads must add `archived_at is null`; archive reads must add
`archived_at is not null`.

On archive, preserve `status = 'published'` and store
`pre_archive_status = 'published'`. The operation is intentionally limited to
public published articles in this enhancement. Candidate archival is not exposed
by the existing UI and is outside scope. Restore clears all three archive fields;
because only published articles can enter this archive, restore safely returns the
same published record. If later work permits candidate archival, restore must use
`pre_archive_status` and route candidates back to review.

### 3.2 Existing operator-hidden records

Do not silently migrate every `status = 'ignored'` row: ignored rows also include
below-relevance decisions and other pipeline outcomes. Backfill only rows with
`status = 'ignored' and failure_reason = 'hidden_by_operator'`:

- set `archived_at = coalesce(decisioned_at, updated_at, created_at)`;
- set `pre_archive_status = 'published'`;
- leave `archived_by` null because the historical actor was not recorded; and
- set `status = 'published'` and clear `failure_reason` in the same migration so
  the archive predicate, not an overloaded status, becomes authoritative.

This preserves existing removed data and makes it available in the new Archive
interface. The migration must report or make queryable the backfilled count.

### 3.3 Authorization boundary

- Archive and restore remain behind `market_updates.can_edit` in
  `market-updates-curate`.
- Archive listing/count requires `market_updates.can_view` **and**
  `market_updates.can_edit`, matching the control's operator-only nature.
- Service-role Edge Functions remain the only write path.
- Do not add authenticated direct table writes or loosen RLS.
- Preserve current CSRF, body-size, UUID, correlation-ID, safe-error, and
  observability helpers.

### 3.4 API contract and concurrency

Extend the existing boundaries instead of adding a new public API surface:

#### `market-updates-curate`

- `action: 'archive', updateId`
  - condition: `id = updateId and archived_at is null and status = 'published'`;
  - patch archive timestamp, authenticated user ID, and previous status;
  - return `200 archived`, `200 already_archived` for an idempotent duplicate,
    `404 not_found`, or `409 invalid_state_transition`.
- `action: 'restore', updateId`
  - condition: `id = updateId and archived_at is not null`;
  - clear archive metadata without rewriting article content;
  - return `200 restored`, `200 already_restored`, `404 not_found_or_purged`, or
    `409 invalid_state_transition`.

Both actions re-read after a zero-row conditional mutation so concurrent requests
receive a meaningful idempotent result instead of a generic failure. Purge winning
the race produces `404 not_found_or_purged`; restore winning first makes the purge
predicate false.

#### `market-updates-status`

Add an `archive` action accepting:

- `search?: string`, trimmed and length-limited;
- `page?: number`, minimum 1;
- `pageSize?: number`, clamped to 10–50;
- `sort?: 'archived_desc' | 'deletion_asc'`.

Return `{ items, count, page, pageSize, hasMore }`. Select only archive-management
fields: ID, title, source name/URL, category, geography, summary/excerpt, archived
time, archiver display identity where permitted, pre-archive status, and source
publication time. Compute `deletes_at` as `archived_at + interval '30 days'` and
`days_remaining` server-side or from that returned timestamp. Do not return AI
confidence. Search title/source/summary using the repository's safe query pattern;
escape PostgREST wildcard/control characters if an `or/ilike` expression is used.

Add a lightweight `archive_count` action or include `archivedCount` in the existing
status payload. Prefer the latter so the page's existing health request supplies
the badge without an additional initial request.

### 3.5 Active-query invariant

Every non-archive consumer must use both its existing status/visibility rules and
`archived_at is null`:

- `market-updates-status`: published, candidate, counts;
- `market-updates-feed`: RSS rows;
- `market-updates-digest`: all input updates and digest prerequisites;
- `market-updates-qa`: explicit update IDs, lexical retrieval, vector retrieval,
  conversation anchors, and fallback retrieval;
- `market-updates-embed-backfill`: candidates for embedding;
- automation freshness/publication checks in SQL;
- any public RLS policy that permits selecting published rows.

The front end still immediately removes a successfully archived row, but database
predicates are the source of truth. High Impact Watchlist, filter results, and
client-side Ask AI source selection inherit exclusion from the active page load.

### 3.6 Retention and referential integrity

Create `public.purge_expired_market_updates_archive()` as a `security definer`
function with a fixed `search_path`, revoked from public/anon/authenticated and
granted only to `service_role`. It must:

1. identify rows with non-null valid archive timestamps satisfying
   `archived_at <= now() - interval '30 days'`;
2. lock/select a bounded batch (for example 500 IDs) to limit transaction size;
3. never select `archived_at is null` rows;
4. delete or detach dependent, non-audit data in the reviewed FK order;
5. preserve immutable operational/audit evidence where required;
6. delete the selected article rows;
7. write one structured execution record with attempted/deleted counts and UTC
   time; and
8. return the deleted count.

Schedule it daily, e.g. `37 2 * * *`, under a uniquely named
`market-updates-archive-purge-daily` job. Unschedule only that exact job before
recreating it; do not use the older broad `jobname like 'market-updates-%'`
pattern because it could remove unrelated Market jobs introduced later.

Before implementing the delete body, Phase 3 must re-run a schema reference audit
for conventional FKs and JSON/array references. Expected relationships include
digest `top_update_ids`, QA `source_update_ids`, row-local embeddings/search
vectors, and conversation source anchors. Historical digests and audit logs should
not be deleted merely because an article expires. If arrays are not FK-backed,
retain them as historical identifiers; active retrieval must tolerate absent
articles. If a dependent row is operational rather than audit evidence, delete or
detach it explicitly in the same transaction.

### 3.7 AI score visibility

Delete `ConfidenceBar` and every Market Updates invocation. Remove numerical
confidence badges from both Ask AI render paths and the digest header. Candidate
Review keeps the textual reason “Confidence Below Publication Threshold” but never
shows a number. High Impact Watchlist already has no score.

Retain backend `confidence_score` storage and ingestion/classification behavior.
Remove it from public `UPDATE_COLUMNS`, digest response columns, and QA response
mapping only where no current front-end behavior requires it. It may remain in
internal types or introduce internal/DTO type separation so publication tests and
shadow metrics continue to compile. Archive DTOs must never contain it.

## 4. Front-end component plan

### 4.1 Candidate Review dialog

Extract an internal or feature component only if that improves testability; do not
redesign it. Use the existing shadcn/Radix Dialog:

- dialog: `flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col
  overflow-hidden p-0` with a `vh` fallback before the `dvh` utility if required;
- fixed `shrink-0` header with `pr-12` for the close control;
- exactly one list scroller: `min-h-0 flex-1 overflow-y-auto overflow-x-hidden`;
- `overscroll-contain`, focusable scroll region where needed, and theme-consistent
  scrollbar utilities already used by the application;
- list bottom padding at least equal to normal card spacing;
- cards with natural height, `min-w-0`, `break-words`, and no line clamps;
- URL/model badges with `max-w-full`, wrapping or accessible title text;
- retain Radix Escape, focus trap, scroll lock, and focus return behavior.

### 4.2 Market Sources and Source Coverage

- Increase the admin dialog to a responsive `max-w-7xl` and
  `max-h-[calc(100dvh-2rem)]`, preserving its single flex scroller.
- Keep header, registry controls, and source filters fixed.
- Give source information and administration actions explicit responsive grid
  tracks so controls do not compress names, URLs, or geography.
- Render `source.geography` with a “Geography” label in a materially wider,
  wrapping container; use `title`/Tooltip only as a supplemental full-value aid.
- Preserve source URL wrapping, status, health, counts, refresh/test/run, cadence,
  error clearing, toggle, canonical/legacy tabs, and authorization.
- In inline Source Coverage, use the available page width, raise the expanded
  list's visible minimum height, and use a deliberate internal list scroller only
  if the source count makes unlimited page growth impractical. Avoid horizontal
  overflow and preserve expand/collapse semantics.

### 4.3 Clear All

Define a target-filter predicate separate from the existing broad predicate:

```ts
const hasClearableFilters = Boolean(search.trim()) || sourceFilter !== 'all' ||
  Object.values(filters).some((value) => value !== 'all');
```

The toolbar action resets only `search`, `sourceFilter`, category, geography,
impact, and audience. It must not touch `activeSegment`, `activeFreshness`,
`workspaceTab`, or digest period. There is currently no pagination or URL state to
reset; archive pagination is separate. Place the secondary/outline button in the
same responsive filter container, disable it when the predicate is false, include
visible text, accessible name, reset icon from Lucide, and existing focus styling.

### 4.4 Archive management

Use a full-size responsive Dialog to match existing application patterns and avoid
adding a route/navigation entitlement:

- top action button near Review candidates and Sources, with an Archive icon and
  count badge; keep digest generation as the primary button;
- load the first archive page only when opened;
- server-paginated search with a modest debounce or explicit submit;
- fixed header/search controls and one flex list scroller;
- cards show title, source, category, geography, archived date/by, deletion date or
  days remaining, and original link;
- “Review” opens an archive-safe detail presentation without restoring;
- “Restore” uses the same service operation as toast Undo, disables per record
  while pending, and removes the row only after success;
- empty state uses the requested 30-day explanation;
- refresh archive rows/count after a stale `not_found_or_purged` response.

On successful archive, remove the active row and close its Analysis dialog if
necessary, update the page-level archive count, and show `toast.success` with an
Undo action. On failure, leave or restore the article in local state and show
`toast.error`. Avoid a speculative optimistic removal before the server confirms;
the existing request is fast and confirmation-first eliminates rollback ordering
bugs. Restore success reloads/inserts the active record only if it still belongs in
the loaded window; otherwise call the existing page reload. Preserve scroll
position by avoiding navigation and full-page reloads.

## 5. File-by-file implementation map

| File | Planned change | Phase |
|---|---|---|
| `supabase/migrations/20260812000000_market_updates_article_archive.sql` | Archive fields, historical backfill, constraints/index, policy adjustment, purge log/function, grants, daily cron. | 3 |
| `supabase/functions/market-updates-curate/index.ts` | Archive/restore API, actor metadata, idempotent concurrency responses, logs. | 3 |
| `supabase/functions/market-updates-status/index.ts` | Active exclusions, archive pagination/search/count, sanitized DTO without visible score. | 3 |
| `supabase/functions/market-updates-feed/index.ts` | Exclude archived rows. | 3 |
| `supabase/functions/market-updates-digest/index.ts` | Exclude archived inputs; preserve internal threshold behavior. | 3 |
| `supabase/functions/market-updates-qa/index.ts` | Exclude archived rows from every standard retrieval path. | 3 |
| `supabase/functions/market-updates-embed-backfill/index.ts` | Do not create/recreate embeddings for archived rows. | 3 |
| `supabase/migrations/20260726210000_market_updates_continuous_automation.sql` | No edit; use only as the scheduler pattern reference. | — |
| `src/integrations/supabase/types.ts` | Regenerate archive and purge-log schema types. | 3 |
| `src/types/marketUpdates.ts` | Archive DTOs/page metadata and front-end score type cleanup where safe. | 3/4 |
| `src/services/marketUpdatesService.ts` | Archive/list/count/restore methods and error mappings. | 3/4 |
| `src/pages/MarketUpdates.tsx` | Clear All, archive action/count/dialog wiring, fixed toasts, score removal, Candidate Review viewport. | 4 |
| `src/components/market-updates/MarketArchiveDialog.tsx` | Paginated archive search/review/restore surface. | 4 |
| `src/components/market-updates/MarketSourcesAdminDialog.tsx` | Larger responsive viewport and geography layout. | 4 |
| `src/components/market-updates/MarketSourceCoveragePanel.tsx` | Larger expanded source tree and safer row wrapping. | 4 |
| Market Updates Vitest/Edge tests and validation scripts | Behavioral, security, retention, dedupe, layout-contract, and score-removal coverage. | 3–5 |

If schema inspection during Phase 3 finds an existing equivalent archive actor or
audit-log table, reuse it and revise the migration rather than creating duplicate
columns/tables. The migration timestamp must remain later than every Market Updates
migration present on the implementation branch.

## 6. Test plan

### Database and backend

- migration static validation: additive columns, UTC `timestamptz`, partial index,
  fixed search path, revokes/grants, exact cron name and daily cadence;
- archive writes timestamp/actor/pre-status and excludes the row from every active
  read;
- archive list/count pagination and search;
- restore clears all archive metadata and returns the original published content;
- duplicate archive/restore requests return idempotent statuses;
- unauthorized view/edit requests fail closed;
- purge deletes exactly rows at least 30 days archived, retains younger rows, and
  never deletes active rows;
- purge is safe on repeated execution and records deleted counts;
- restore/purge race has deterministic meaningful responses;
- ingestion dedupe still finds archived rows by hash, canonical URL, and external
  source identity;
- feed, digest, QA, candidate, count, and embedding paths exclude archived rows;
- internal confidence-threshold publication tests remain unchanged and passing.

### Front end

- Candidate dialog has one internal scroller, natural-height cards, safe wrapping,
  reachable final record, close behavior, and focus return;
- source dialogs/panels use expanded dimensions and geography wraps without
  shifting controls; expand/collapse remains accessible;
- Clear All disabled at defaults, enabled by each target filter, resets exactly six
  targets, and preserves segment/freshness/tab;
- archive success/failure, count changes, modal pagination/search, restore
  success/failure, stale purge response, and repeated-submit prevention;
- toast is viewport-fixed through the existing global Sonner host and Undo invokes
  the same restore service;
- main cards, Analysis, digest, Candidate Review, Ask AI workspace/dialog,
  watchlist, and Archive contain no numerical intelligence confidence.

### Required commands and manual evidence

Run focused tests first, then:

```bash
npm run test:market-updates-read-contract
npm run test:market-updates-publication-decisions
npm run test:market-updates-digest
npm run test:market-updates-qa
npm run test:market-updates-automation
npm run test:market-updates-security-legal
npm test -- --run
npm run typecheck:portals
npm run lint
npm run audit:style
npm run build
```

Use browser tooling to exercise the authenticated page and capture screenshots at
1280×720, 1366×768, 1440×900, and 1920×1080, plus one narrower responsive width.
At each size, open Candidate Review, Sources, and Archive; keyboard through all
controls; inspect console/network; verify body scroll lock; archive and restore an
authorized non-production test article; and confirm fixed toast visibility after
scrolling.

`test:market-updates-qa` is not currently a package script; Phase 5 should run the
specific Deno security tests or add a repository-conventional aggregate script
rather than claiming that command succeeded unchanged.

## 7. Deployment order and rollback

### Deployment order

1. Back up or snapshot affected Market Updates rows and capture counts grouped by
   status/failure reason.
2. Apply `20260812000000_market_updates_article_archive.sql`.
3. Verify backfilled operator-hidden count, archive index, purge function grants,
   and exact cron job definition.
4. Deploy backend functions in dependency order:
   `market-updates-curate`, `market-updates-status`, `market-updates-feed`,
   `market-updates-digest`, `market-updates-qa`, then
   `market-updates-embed-backfill`.
5. Run backend smoke/authorization tests before deploying the front end.
6. Deploy the front-end build.
7. Run authenticated archive/restore, active-feed, digest, QA, RSS, candidate, and
   ingestion-dedupe acceptance checks.
8. Observe the first purge job in `cron.job_run_details` and the purge execution
   log; do not manually age production content solely to prove deletion.

### Rollback

- Front end and Edge Functions can be redeployed to the previous reviewed versions.
- Unschedule only `market-updates-archive-purge-daily` before backend rollback.
- Do not drop archive columns or hard-delete restored/backfilled data in a down
  migration. Use a reviewed forward migration if schema reversal is required.
- While old functions are live against the additive schema, rows backfilled to
  `status = 'published'` would become visible unless active read policies/functions
  understand `archived_at`. Therefore deploy the migration and archive-aware read
  functions in one controlled maintenance window, and verify the RLS policy itself
  excludes archived rows before old clients can read directly.

## 8. Acceptance traceability

| Workstream | Planned evidence |
|---|---|
| Candidate Review viewport | Component assertions, keyboard/browser inspection, five viewport screenshots. |
| Source viewport | Dimension/wrapping assertions, expand/collapse test, browser screenshots. |
| Clear All | Six reset assertions plus segment/freshness/tab preservation. |
| Archive | Migration/API tests, archive UI tests, fixed toast/Undo check, active-query matrix. |
| 30-day cleanup | SQL boundary/idempotency/active-safety tests and cron definition evidence. |
| Ingestion dedupe | Archived-row hash/canonical/external-ID regression tests. |
| AI score removal | Static/component assertions plus visual inspection of every Market Updates surface. |
| Regression protection | Existing Market Updates validators, full test suite, lint, style audit, typecheck, and build. |

## 9. Phase gate

This document is the complete Phase 2 deliverable. It changes no runtime behavior.
Phase 3 may begin only in a separate task and is limited to database/backend work:
schema, migration/backfill, secured archive APIs, active-query exclusions,
retention cleanup, ingestion-dedupe verification, generated types, and backend
tests. Candidate Review, Source viewport, Clear All, Archive UI/toasts, and visible
score removal remain Phase 4 work.
