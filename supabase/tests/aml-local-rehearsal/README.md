# AML local database rehearsal harness (synthetic only)

Reproduces the release-candidate database gate on a **disposable local
Postgres 16** — never a shared or production database. Everything here is
synthetic; no real client data, documents or identifiers may enter this
harness.

## What it proves

Applied and verified during release-candidate validation (and re-runnable
by any operator):

1. the full AML migration chain — 58 committed migrations referencing the
   `aml` schema, in filename order, plus the classification-correction and
   action-flag migrations (60 total, `migration-order.list`) — applies
   cleanly from scratch;
2. schema objects, corrected classifications (raw ID P3 / legal hold P4 /
   SMR P5 / biometric P6), structural export CHECKs, RLS and the fourteen
   default-false partner flags (`10-verify-schema.sql`);
3. RLS denies `authenticated`/`anon` on every partner table; flag-off means
   zero outbox writes; transition triggers emit atomically; duplicate
   enqueues collapse; restricted payload keys and unknown event types are
   refused at the SQL choke point (`11-synthetic-behaviour.sql`);
4. material change applies once and idempotently; revocation emits once and
   cannot be reversed by re-updates; claim/dead-letter/replay round-trips;
   grant-less evidence-access logging; the delivery → opaque document
   reference chain with no path column (`12-material-and-delivery.sql`);
5. the correction and action-flag migrations roll back exactly per their
   headers with every earlier-phase object intact, then reapply cleanly
   (`13-rollback-rehearsal.sql` + re-run of the apply loop).

## Running it

```bash
docker run -d --name aml-rc-db -e POSTGRES_PASSWORD=synthetic \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
export PGPASSWORD=synthetic PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres

psql -v ON_ERROR_STOP=1 -f 00-preamble.sql -f 00b-platform-stubs.sql -f 01-outbox-core.sql
psql -v ON_ERROR_STOP=1 -f 02b-stub-fns.sql -f 02-feature-flags.sql
# apply the chain (run from the repository root):
while read -r f; do psql -v ON_ERROR_STOP=1 -q -1 -f "$f" || break; done \
  < supabase/tests/aml-local-rehearsal/migration-order.list
psql -v ON_ERROR_STOP=1 -f 10-verify-schema.sql
psql -f 11-synthetic-behaviour.sql
psql -f 12-material-and-delivery.sql
psql -f 13-rollback-rehearsal.sql   # then re-apply the two 20260828 files and re-run 10
docker rm -f aml-rc-db
```

## What the stubs are (and are not)

`00-preamble.sql`–`02b-stub-fns.sql` recreate ONLY the environment a
Supabase project provides (roles, `auth.uid()`, `storage` tables, realtime
publication) plus id-only stub tables for the six non-AML public FK targets
and no-op bodies for non-AML platform helper functions.
`00b-platform-stubs.sql` carries the platform objects the chain also needs
(`auth.users`, `custom_users`, `user_roles`, extra `storage.buckets`
columns, the realtime publication, and no-op bodies for the five non-AML
functions the search_path-pin migration ALTERs) — without it the chain
stops at `20260721130000_security_phase7_pin_function_search_path.sql`.
`01-outbox-core.sql` is the platform outbox's table/RPC definitions taken
VERBATIM from `20260730220000_field_ownership_outbox_projections_phase6.sql`
(that migration's portal read models and triggers are outside AML scope and
depend on dozens of portal tables). Stubs never replace an AML object — if
an AML migration failed, the gate failed.

This harness verifies the DATABASE layer. Edge-function authorisation is
covered by the source-contract and behavioural vitest suites; end-to-end
verification against running functions requires a full local Supabase stack
(`supabase start`), which this environment does not provide.
