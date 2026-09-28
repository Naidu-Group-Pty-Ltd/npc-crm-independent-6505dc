/**
 * Whether the tree a spec is reading is the PRIME's own.
 *
 * Almost every file a clone holds arrives from the prime, so one spec can judge
 * it the same way everywhere. Two kinds never arrive:
 *
 *   - **a file Mission Control protects on every clone.**
 *     `.github/workflows/apply-migration.yml` is one: each clone keeps its own
 *     fail-closed guard against applying migrations to the wrong project, and
 *     the cascade never overwrites it;
 *   - **a template-library seed too large to carry.** Seed v20 is 42.2 MB, and
 *     GitHub refuses the cascade's write of it ("input was too large", HTTP
 *     422) on every pass. A clone holds the manifest and the generator that
 *     describe it and never the file itself.
 *
 * A spec that asserts either kind is a statement about the prime's tree.
 * Cascaded to a clone, it asserts that the clone ought to be the prime. That is
 * how both parents' cascade pull requests went red on 24 Sep 2026.
 *
 * The answer comes from `supabase/config.toml`, for the reason
 * `shippedBackendIdentity.spec.ts` gives: `project_id` is the tree's own
 * statement of which project it belongs to, the Supabase CLI acts on it, and
 * the cascade protects it on every clone. It is read the same way that spec
 * reads it.
 *
 * It is not `BACKEND_DEPLOYED_BY`. That marker arms the CI CHECK scripts, and it
 * reaches a script only because the step that runs it maps it, which
 * `check-gate-env-wiring.mjs` holds in place. A spec runs in a vitest step that
 * maps nothing, and on a laptop, so a spec that read the marker read `undefined`
 * on every clone and asserted there.
 *
 * A tree that declares no project is an error rather than "not the prime", so
 * an unreadable file cannot quietly skip the assertions this gates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIME_BACKEND_REF } from '../primeDeployment';

/** The project a `supabase/config.toml` declares. Throws when it declares none. */
export function declaredProjectRef(configToml: string): string {
  const match = /^project_id\s*=\s*"([a-z0-9]+)"/m.exec(configToml);
  if (!match) throw new Error('supabase/config.toml declares no project_id');
  return match[1];
}

/**
 * The largest file the cascade writes into a clone: 40 MiB, Mission Control's
 * `CASCADE_STREAM_MAX_FILE_BYTES`. Measured on the seeds: v19, at 41,773,244
 * bytes, is carried, and GitHub refuses v20, at 42,195,218. Any file over this
 * is on the prime's tree alone, so a spec that reads one must stand down
 * elsewhere. `primeTree.spec.ts` holds every spec to that.
 */
export const CASCADE_FILE_LIMIT_BYTES = 40 * 1024 * 1024;

/** True only on the prime's own tree. */
export const TREE_IS_PRIME =
  declaredProjectRef(readFileSync(resolve(__dirname, '../../../supabase/config.toml'), 'utf8')) ===
  PRIME_BACKEND_REF;
