/**
 * Which Supabase project a script run from this checkout is about.
 *
 *   const ref = projectRef(process.env);   // null when nothing names one
 *
 * The environment's `SUPABASE_PROJECT_REF` or `PROJECT_REF` first, in the
 * order `ledgerQuery.mjs` reads them. Then the `project_id` in THIS checkout's
 * own `supabase/config.toml`, read from the preamble only, the way
 * `deploy-supabase-functions.yml` and `aml-sanctions-refresh.yml` read it.
 * Never a literal.
 *
 * Why never a literal: every clone's repository holds `.github/scripts/**`
 * and `scripts/**` as the prime wrote them, so a project ref typed into one of
 * them names the PRIME on every clone. Three lanes did exactly that until
 * 28 Sep 2026: `builder-network-sync-state.mjs`, `builder-stock-mirror-state.mjs`
 * and `builder-network-connection-remap.mjs` fell back to the prime's ref, and
 * their workflows pass none. Dispatched with an access token on a clone's
 * repository, the first two described the prime's database as the clone's.
 * The third writes, so it re-pointed the prime's connection instead of the
 * clone's. `supabase/config.toml` is per deployment: each clone's names its own
 * project, and Mission Control never cascades the prime's copy over it.
 *
 * Nothing found is `null`, never a guess. The caller refuses and says what to
 * set.
 */
import { readFileSync } from 'node:fs';

/**
 * This checkout's config, from the working directory. Every lane under
 * `.github/scripts` reads the tree that way, because a workflow runs it from
 * the repository root.
 */
export const CONFIG_TOML_PATH = 'supabase/config.toml';

/** A Supabase project ref: twenty lowercase letters. It is also a hostname label. */
const PROJECT_REF = /^[a-z]{20}$/;

/**
 * The preamble's `project_id`, meaning any line before the first `[section]`.
 * A `project_id` inside a section is that table's key, not the project's.
 * A value that is not a project ref is treated as absent.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function preambleProjectId(text) {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) return null;
    const declared = line.match(/^project_id\s*=\s*"([^"]*)"/);
    if (declared) return PROJECT_REF.test(declared[1]) ? declared[1] : null;
  }
  return null;
}

/**
 * The project this run is about. A ref given in the environment wins, and one
 * given there that is not a ref is refused rather than passed on: it is
 * interpolated into a Management API URL.
 *
 * @param {Record<string, string|undefined>} env
 * @param {() => string} [readConfig] reads `supabase/config.toml`; a spec passes its own
 * @returns {string|null}
 */
export function projectRef(env, readConfig = () => readFileSync(CONFIG_TOML_PATH, 'utf8')) {
  const given = String(env?.SUPABASE_PROJECT_REF || env?.PROJECT_REF || '').trim();
  if (given) return PROJECT_REF.test(given) ? given : null;
  let text;
  try {
    text = readConfig();
  } catch {
    return null;
  }
  return preambleProjectId(text);
}
