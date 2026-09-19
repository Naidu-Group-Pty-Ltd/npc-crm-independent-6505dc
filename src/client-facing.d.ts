/**
 * Compile-time constants for client-facing mode, declared in a file of their own.
 *
 * The declaration used to live in `src/vite-env.d.ts` — a file both
 * repositories have, which the cascade therefore overwrites. Taking the
 * prime's version deleted the declaration and `npc-client-dashboard` stopped
 * type-checking with five `TS2304: Cannot find name '__CLIENT_FACING__'`. That
 * bit during the 26 Aug sync (docs/CLIENT_FACING_MODE.md records it), was
 * repaired in place, and the very next cascade deleted the repair again.
 *
 * The file therefore exists in BOTH repositories with identical content, so a
 * cascade writing the prime's copy over the clone's is a no-op. It used to be
 * clone-only, which was safe only while nothing in the prime's own source
 * named a constant: `src/lib/clientFacing.ts` is cascade-synced and now reads
 * `__CLIENT_FACING__`, so the prime has to type-check it too.
 *
 * `__CLIENT_FACING__` and `__CLIENT_FACING_ALLOW__` are injected by `define`
 * in vite.config.ts and are the ONE authority the running code reads.
 *
 * The `__EXCLUDE_*__` constants gate the dynamic `import()` of the five pages
 * whose CHUNK is the leak — the integration registry with its secret names,
 * the workflow vendor catalog, the model roster, the Cloudflare surface and
 * the API-usage internals. Only `npc-client-dashboard` defines them, because
 * only its App.tsx carries those gates; the declarations are shared so this
 * file can be cascade-written in either direction without losing one.
 */
declare const __CLIENT_FACING__: boolean;
declare const __CLIENT_FACING_ALLOW__: readonly string[];
declare const __EXCLUDE_INTEGRATIONS__: boolean;
declare const __EXCLUDE_WORKFLOW_PLAYGROUND__: boolean;
declare const __EXCLUDE_CLOUDFLARE__: boolean;
declare const __EXCLUDE_MODEL_HUB__: boolean;
declare const __EXCLUDE_API_USAGE__: boolean;
