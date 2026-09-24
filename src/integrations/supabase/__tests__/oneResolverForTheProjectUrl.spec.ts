/**
 * One module resolves which Supabase project this build talks to, and every
 * other reader takes its answer.
 *
 * ## The rule, and what breaks without it
 *
 * `resolveSupabaseTarget` treats the URL and the publishable key as a MATCHED
 * PAIR. Given a URL and no key it refuses the half-configured pair and falls
 * back to BOTH built-in defaults — so on such a build
 * `import.meta.env.VITE_SUPABASE_URL` names a project the client never talks
 * to, while `SUPABASE_URL` names the one it does.
 *
 * A raw reader therefore disagrees with the client, silently, and the shape of
 * the failure depends on what it does with the string:
 *
 *   - `organisation.ts` compared stored logo URLs against the raw origin. The
 *     row came from the fallback project, every asset was rejected as
 *     `not-project-storage`, and the document printed with no brand mark and
 *     no error anywhere. That is the finding this spec was written for.
 *   - `internalMessageAttachments.ts` (its own header records it) built an
 *     upload URL from a raw read with an empty-string fallback, so an
 *     unconfigured build PUT to the app's own origin and got HTML back.
 *
 * With NOTHING configured the raw read is `undefined`, which interpolates as
 * the literal string `undefined/functions/v1/...`.
 *
 * ## What counts as reading it
 *
 * Not the literal text. This spec first looked for
 * `import.meta.env.VITE_SUPABASE_URL` and, while its own header said three raw
 * readers remained, the tree held five: the Template Builder's two image
 * upload paths read `(import.meta as any).env?.VITE_SUPABASE_URL ?? ''`, which
 * the bundler replaces exactly like the plain form (esbuild removes the cast
 * first; `buildTimeEnvReads.spec.ts` records the measurement) and which no
 * scan for the literal can see. With nothing configured that `''` put an
 * address on the app's own origin into every template an image was uploaded
 * to. Both read `SUPABASE_URL` now.
 *
 * So the rule is about the module, not the spelling: one that reads the build
 * environment and names `VITE_SUPABASE_URL` in its code is reading the project
 * URL for itself, whether through a cast, an optional chain, an alias or a
 * helper that takes the name — the form `env.ts` itself used until
 * 23 Sep 2026. Measured on the tree before that date it finds all seven
 * readers, where the literal found three. It can be wrong in one direction
 * only: a module that reads some OTHER variable and quotes this one's name in
 * a string is listed too, and the remedy is to say so here rather than to
 * narrow the rule, because the opposite mistake is the silent one.
 *
 * ## Why a ratchet rather than a ban
 *
 * Three call sites still read it raw, and each is a separate behaviour change
 * with its own blast radius — two build Edge Function URLs and one is a
 * clipboard affordance. They are named here so they cannot grow, and so the
 * next person fixing one finds the reason written down. Removing a file from
 * this list is the fix; adding one requires deciding to.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');

/**
 * Strip comments by WALKING the source, not by regex.
 *
 * A `/\*[\s\S]*?\*\/` pass is the obvious way and it is wrong here: a `/*`
 * inside a `//` line comment opens a block comment the stripper then closes at
 * the next real `*` + `/`, deleting everything between. Measured on this
 * repository that has already eaten 13,438 characters of one module, and a
 * scan over a source with a hole in it reports a clean file. Tracking the
 * state instead costs twenty lines and cannot do that.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'tick' = 'code';
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'tick';
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1; continue;
    }
    // inside a string literal: copy through, honouring escapes
    if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'tick' && c === '`')) {
      state = 'code';
    }
    out += c; i += 1;
  }
  return out;
}

/**
 * Whether a module reads `VITE_SUPABASE_URL` for itself, in any spelling.
 * Comments are stripped first, so prose about the variable is not a read.
 */
export function readsProjectUrlItself(code: string): boolean {
  return /\bimport\s*\.\s*meta\b/.test(code) && /\bVITE_SUPABASE_URL\b/.test(code);
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      sourceFiles(full, found);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The reader that IS the resolver, plus the three that have not been moved.
 * Paths are `src/`-relative with forward slashes.
 */
const RESOLVER = 'integrations/supabase/env.ts';
const NOT_YET_MOVED = [
  'components/borrowing-capacity/scenarios/BCScenarioAgent.tsx',
  'components/market-updates/MarketSourcesAdminDialog.tsx',
  'services/marketUpdatesService.ts',
];

describe('one resolver for the project URL', () => {
  const raw = sourceFiles(SRC)
    .filter((file) => readsProjectUrlItself(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .sort();

  it('is read raw only by env.ts and the three sites named here', () => {
    expect(raw).toEqual([RESOLVER, ...NOT_YET_MOVED].sort());
  });

  it('recognises every spelling a raw read has taken in this tree', () => {
    const reads = [
      'const u = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/x`;',
      "const u = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';",
      "const read = (k: string) => import.meta?.env?.[k];\nconst u = read('VITE_SUPABASE_URL');",
      'const env = import.meta.env;\nconst u = env.VITE_SUPABASE_URL;',
    ];
    for (const code of reads) expect(readsProjectUrlItself(stripComments(code)), code).toBe(true);

    // Naming the variable is not reading it: the resolver's own warning
    // quotes it and touches no environment.
    expect(readsProjectUrlItself("const w = 'VITE_SUPABASE_URL is set but no key is';")).toBe(false);
    // And prose about it is not code.
    expect(
      readsProjectUrlItself(stripComments('// import.meta.env.VITE_SUPABASE_URL was read here\nconst a = 1;')),
    ).toBe(false);
  });

  it('and the brand-asset origin is the resolved one', () => {
    // The finding this spec was written for: the row is fetched with the
    // client's own project, so the origin its assets are compared against must
    // be the client's own project too.
    const adapter = stripComments(
      readFileSync(join(SRC, 'lib', 'reportTemplate', 'adapters', 'organisation.ts'), 'utf8'),
    );
    expect(adapter).toMatch(/inlineBrandAssets\(stored, \{ supabaseUrl: SUPABASE_URL \}\)/);
    expect(adapter).toMatch(/from '@\/integrations\/supabase\/env'/);
  });
});
