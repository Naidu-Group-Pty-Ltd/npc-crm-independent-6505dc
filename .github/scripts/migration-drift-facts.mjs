#!/usr/bin/env node
/**
 * Collect the database side of the migration-drift question.
 *
 *   SUPABASE_DB_URL=... node .github/scripts/migration-drift-facts.mjs > facts.json
 *
 * Three facts, and nothing else leaves the database: the versions the ledger
 * records, the objects the catalogue holds, and — for each migration that
 * declares one — whether its `@effect` probe is satisfied. No table contents,
 * no row values, only existence.
 *
 * The credential lives here rather than in `scripts/ops/migration-drift.mjs`
 * so the classifier stays pure and testable, which is the same split
 * `apply-migration.yml` already makes between the route and the decision.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { effectProbeIn } from '../../scripts/build-migration-object-index.mjs';
import { probeIsReadOnly } from '../../scripts/ops/migrationDrift.pure.mjs';
import { ledgerQuery, ledgerRoute } from '../../scripts/lib/ledgerQuery.mjs';

/*
 * Two routes, chosen the same way `apply-migration.yml` chooses one, and for
 * the same reason: `SUPABASE_DB_URL` is a session-pooler string Mission
 * Control distributes to a provisioned clone, and a repository that has only
 * a Management API token is not a repository without a database — it is one
 * reached a different way.
 *
 * Requiring the pooler string was this reporter's own first defect. Measured
 * 21 Sep 2026: the drift job failed at its credential check on the very
 * repository it was written for, four steps before it read anything, while
 * `apply-migration.yml` had applied seed v18 over the Management API nine
 * minutes earlier. A reporter that cannot run where the thing it reports on
 * happens is not a reporter — and it fails LOUDLY, so the gap was visible
 * rather than silent, which is the one thing it got right.
 *
 * Both routes are read-only here by construction: every statement below is a
 * SELECT, and a declared `@effect` probe reaches neither route unless
 * `probeIsReadOnly` admits it.
 */
const ROUTE = ledgerRoute({
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN,
  SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
});
if (!ROUTE) {
  console.error('Neither SUPABASE_DB_URL nor SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF is set.');
  process.exit(2);
}
console.error(`route: ${ROUTE.route}`);

/**
 * One query, first column only, trimmed, empties dropped. The reader is
 * `scripts/lib/ledgerQuery.mjs`, shared with `apply-migration.yml`'s preflight,
 * ledger record and applied-body re-check, so there is one way of reading this
 * table rather than one per workflow.
 */
const q = ledgerQuery(ROUTE);

const appliedVersions = await q(
  'select version from supabase_migrations.schema_migrations order by version',
);

/*
 * The object catalogue, in the same `"<class>:<qualified name>"` spelling the
 * migration object index uses. Every class is emitted BOTH qualified and bare,
 * because `CREATE INDEX foo ON t` and `CREATE TYPE report_tier_enum AS ENUM
 * (…)` name no schema and the extractor therefore records a bare name —
 * matching only the qualified form reads every such migration as unapplied.
 *
 * That was stated here for indexes and triggers alone and was true of the rest
 * too. Measured 21 Sep 2026: seven unqualified `CREATE TYPE`s across two
 * migrations — `template_type`, `report_tier_enum`, `report_category_enum` and
 * four `depreciation_*` — were reported absent because the catalogue published
 * only `type:public.template_type`. Both files had run.
 *
 * A bare catalogue entry can only ever satisfy a bare SOURCE name: a migration
 * that writes `public.foo` is still matched on `table:public.foo`. So this
 * loosens exactly the case where the schema is unknowable from the file, which
 * is the case the index's own header already resolves toward "ours".
 */
const existingObjects = await q(`
  select 'table:'||n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
  union all select 'table:'||c.relname            from pg_class c where c.relkind in ('r','p')
  -- A MATERIALIZED view is published under BOTH words. The shared extractor
  -- consumes the optional materialized prefix before it reads the class, so
  -- CREATE MATERIALIZED VIEW IF NOT EXISTS public.pdf_import_cost_daily
  -- records view:public.pdf_import_cost_daily and could never match a
  -- catalogue that spells relkind 'm' one way only — measured 21 Sep 2026 on
  -- two migrations that had both run.
  union all select 'view:'||n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m')
  union all select 'view:'||c.relname             from pg_class c where c.relkind in ('v','m')
  union all select 'materialized_view:'||n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='m'
  union all select 'materialized_view:'||c.relname from pg_class c where c.relkind='m'
  union all select 'sequence:'||n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S'
  union all select 'sequence:'||c.relname         from pg_class c where c.relkind='S'
  union all select 'index:'||n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='i'
  union all select 'index:'||c.relname            from pg_class c where c.relkind='i'
  union all select 'function:'||n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  union all select 'function:'||p.proname         from pg_proc p
  union all select 'trigger:'||t.tgname           from pg_trigger t where not t.tgisinternal
  union all select 'type:'||n.nspname||'.'||t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype in ('e','c','d')
  union all select 'type:'||t.typname             from pg_type t where t.typtype in ('e','c','d')
  union all select 'schema:'||nspname             from pg_namespace
`);

const probeResults = {};
for (const file of readdirSync('supabase/migrations').filter((f) => /^\d{14}_.*\.sql$/.test(f))) {
  const probe = effectProbeIn(readFileSync(join('supabase/migrations', file), 'utf8'));
  if (!probe) continue;
  if (!probeIsReadOnly(probe)) {
    // Refused rather than run. `migration-drift.mjs` reports it by name; a
    // probe that is not a lone SELECT never reaches the connection.
    continue;
  }
  try {
    /*
     * Cast to text so the two routes agree on the word. `psql -At` renders a
     * boolean as `t`; the Management API returns a JSON `true`. Comparing
     * against one spelling would have read every probe as unsatisfied on the
     * other route — which is the same answer a migration that never ran
     * gives, and therefore invisible.
     */
    const [row] = await q(`select (exists(${probe}))::text`);
    probeResults[file] = row === 'true';
  } catch (err) {
    // A probe naming a table that does not exist throws, and that IS the
    // answer: the migration that would have created it has not run.
    probeResults[file] = false;
    console.error(`probe failed for ${file}: ${String(err.message ?? err).split('\n')[0]}`);
  }
}

process.stdout.write(JSON.stringify({ appliedVersions, existingObjects, probeResults }, null, 2));
