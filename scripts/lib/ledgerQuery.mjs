/**
 * One way to reach a deployment's migration ledger, shared by everything that
 * reads or writes `supabase_migrations.schema_migrations` from a workflow.
 *
 *   const route = ledgerRoute(process.env);   // null when there is no route
 *   const q = ledgerQuery(route);
 *   const versions = await q('select version from supabase_migrations.schema_migrations');
 *
 * Two routes, chosen the way `apply-migration.yml` chooses one, and the
 * narrower one wins. `SUPABASE_DB_URL` is a session-pooler string for this
 * deployment's own database; a Management API token (`SUPABASE_ACCESS_TOKEN`
 * plus a project ref) reaches the same database a different way. A repository
 * holding only the token is not one without a database.
 *
 * This lived inside `migration-drift-facts.mjs`. It moved here so that the
 * applied-body re-check, the apply preflight and the ledger record read the
 * table through the same code. The re-check was psql-only because giving it
 * the Management API would have meant "a second way of reading the same
 * table" in `apply-migration.yml`. With one reader, it can run where the prime
 * applies, which is the Management API.
 *
 * Every answer is the FIRST column of each row, trimmed, with empty values
 * dropped. A caller that needs more than one value per row concatenates them
 * in SQL.
 */
import { execFileSync } from 'node:child_process';

/**
 * Pick the route from the environment. Returns null when neither route is
 * available. The caller says what to do about that, because a reporter and
 * a writer have different remedies.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ route: 'psql', conn: string } | { route: 'api', token: string, ref: string } | null}
 */
export function ledgerRoute(env) {
  const conn = String(env?.SUPABASE_DB_URL ?? '').trim();
  if (conn) return { route: 'psql', conn };
  const token = String(env?.SUPABASE_ACCESS_TOKEN ?? '').trim();
  const ref = String(env?.SUPABASE_PROJECT_REF || env?.PROJECT_REF || '').trim();
  if (token && ref) return { route: 'api', token, ref };
  return null;
}

/** How a route is named in a log or a manifest header. Never includes a secret. */
export function describeLedgerRoute(route) {
  if (!route) return 'no route';
  return route.route === 'psql' ? 'psql $SUPABASE_DB_URL' : `the Management API (project ${route.ref})`;
}

/**
 * A query function over one route.
 *
 * The SQL goes to psql on STDIN rather than as a `-c` argument. A single
 * argument is capped at 128 KiB by the kernel (MAX_ARG_STRLEN), and the ledger
 * record carries a migration body of up to 256 KiB as base64, about 342 KiB.
 * `-q` keeps the command tag ("INSERT 0 1") out of the answer, so an
 * `insert … returning` reads exactly like a select.
 *
 * @param {NonNullable<ReturnType<typeof ledgerRoute>>} route
 * @param {{ fetchImpl?: typeof fetch, exec?: typeof execFileSync }} [io] injected for tests
 * @returns {(sql: string) => Promise<string[]>}
 */
export function ledgerQuery(route, io = {}) {
  if (!route) throw new Error('ledgerQuery needs a route; ledgerRoute() returned none');
  const exec = io.exec ?? execFileSync;
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  return async function q(sql) {
    if (route.route === 'psql') {
      return String(
        exec('psql', [route.conn, '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-f', '-'], {
          input: sql,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      )
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
    const res = await fetchImpl(`https://api.supabase.com/v1/projects/${route.ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`);
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error('the Management API answered something that is not a row set');
    return rows
      .map((r) => Object.values(r ?? {})[0])
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter(Boolean);
  };
}
