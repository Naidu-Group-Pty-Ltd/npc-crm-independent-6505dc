/**
 * A build-time variable is read in the one form the bundler replaces.
 *
 * Vite substitutes the literal token sequence `import.meta.env` — and, for a
 * named variable, `import.meta.env.VITE_X` — at BUILD time. Put anything
 * between `import.meta` and `.env`, or index the result with a bracket, and
 * the sequence no longer matches: nothing is substituted, the code keeps a
 * property access on a browser's real `import.meta` (which has no `env`), and
 * the read is `undefined` forever however the environment is set.
 *
 * It is a silent failure in the worst possible way. The bundle builds, the
 * types check, the lint passes, and the value is simply never there.
 *
 * ── What it cost ─────────────────────────────────────────────────────────────
 *
 * `integrations/supabase/env.ts` read `import.meta?.env?.[key]`, so no clone
 * has ever talked to its own Supabase project. Measured 19 Sep 2026 on
 * `npc-crm-independent`: five `VITE_*` variables set on the hosting project,
 * a build 85 minutes later, and a deployed bundle carrying none of them —
 * the browser opened a realtime socket to the PRIME with the prime's anon key,
 * which is why the password Mission Control had written into the clone's
 * project could not log anybody in. `preflight-property-group` does the same.
 *
 * Four more reads were dead the same way and had never been noticed, because
 * each one's absence looks like the feature simply being off:
 * `VITE_TEMPLATE_LIBRARY`, `VITE_TEMPLATE_EDITOR_V2`, `VITE_TEST_CALL_NUMBERS`
 * and the letterhead asset base URL in the organisation adapter.
 *
 * ── Why a source scan and not a unit test ────────────────────────────────────
 *
 * There is nothing to unit-test: both forms are valid TypeScript that returns
 * `undefined` under a test runner, which resolves `import.meta.env` itself.
 * The defect exists only in a production bundle, so the assertion has to be
 * about the SHAPE of the source. `turnstileIdentity.spec.ts` guards the same
 * class for its own variable and is where this rule was first written down.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SRC = join(REPO_ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments are where this rule is EXPLAINED, so a scan that reads them finds
 * the prose describing the trap and reports it as the trap. Strings are
 * stripped for the same reason — a message may quote the broken form.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Strip a TypeScript cast wrapped around `import.meta` itself.
 *
 * `(import.meta as any).env?.VITE_X` IS replaced: esbuild removes the cast
 * before Vite's define runs, so what the substitution sees is a contiguous
 * `import.meta.env`. Verified by execution — that exact expression in
 * `AssetLibraryDialog.tsx` compiles to the project URL as a literal. A scan
 * that judged the written text would report a working read as broken, so the
 * cast is removed here for the same reason the compiler removes it.
 *
 * What the cast does NOT excuse is an optional chain after it:
 * `(import.meta as {...})?.env` leaves `import.meta?.env`, which is the form
 * that shipped and never resolved.
 */
export function stripImportMetaCasts(code: string): string {
  return code.replace(/\(\s*import\s*\.\s*meta\s+as\s+[^)]*\)/g, 'import.meta');
}

/**
 * Every use of `import.meta`, with the characters that follow it.
 *
 * The rule is about what comes IMMEDIATELY next, so the match deliberately
 * takes the raw tail rather than trying to parse the expression.
 */
export function importMetaUses(code: string): string[] {
  return [...stripImportMetaCasts(code).matchAll(/import\s*\.\s*meta([\s\S]{0,40})/g)].map(
    (m) => m[1],
  );
}

/**
 * The permitted shapes. `.env`, `.url` and `.glob` are the three Vite defines;
 * everything else — `?.env`, `)`, a bracket — is a read the bundler cannot see
 * through. A bracket anywhere in the tail after `.env` is refused too, because
 * `import.meta.env[name]` substitutes the object and then indexes it with a
 * name the build has no way to resolve to a literal.
 */
export function offendingTail(tail: string): string | null {
  const compact = tail.replace(/\s+/g, '');
  if (compact.startsWith('.url')) return null;
  if (compact.startsWith('.glob')) return null;
  if (!compact.startsWith('.env')) return `import.meta${tail.slice(0, 24)}`;
  const afterEnv = compact.slice('.env'.length);
  if (/^\??\.?\[/.test(afterEnv)) return `import.meta.env${afterEnv.slice(0, 20)}`;
  return null;
}

const FILES = walk(SRC);

describe('build-time environment reads', () => {
  it('scans a source tree that actually contains some', () => {
    const withUses = FILES.filter((f) =>
      importMetaUses(stripCommentsAndStrings(readFileSync(f, 'utf8'))).length > 0,
    );
    // Non-vacuity: a rule over an empty set passes for the wrong reason.
    expect(withUses.length).toBeGreaterThan(10);
  });

  it('reads every variable in the form the bundler replaces', () => {
    const offences: string[] = [];
    for (const file of FILES) {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const tail of importMetaUses(code)) {
        const offence = offendingTail(tail);
        if (offence) offences.push(`${relative(REPO_ROOT, file)}: ${offence}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('the rule recognises each broken form, and each permitted one', () => {
    // Broken — the reads that shipped.
    expect(offendingTail('?.env?.[key]')).not.toBeNull();
    expect(offendingTail('?.env?.VITE_TEMPLATE_LIBRARY')).not.toBeNull();
    expect(offendingTail(' as any)?.env?.VITE_SUPABASE_URL')).not.toBeNull();
    expect(offendingTail('.env[name]')).not.toBeNull();
    expect(offendingTail('.env?.[name]')).not.toBeNull();

    // Permitted — the reads that work.
    expect(offendingTail('.env.VITE_SUPABASE_URL')).toBeNull();
    expect(offendingTail('.env?.VITE_SUPABASE_URL')).toBeNull();
    expect(offendingTail('.env?.VITE_AURIXA_PRICING_MOCK')).toBeNull();
    expect(offendingTail('.env.DEV')).toBeNull();
    expect(offendingTail('.env ?? {}')).toBeNull();
    expect(offendingTail('.url)')).toBeNull();
    expect(offendingTail(".glob('../../assets/brands/*')")).toBeNull();
  });

  it('a TypeScript cast is stripped, and an optional chain after it is not', () => {
    // Both of these are live in the tree and both are replaced by the bundler.
    expect(importMetaUses('(import.meta as any).env?.VITE_SUPABASE_URL')).toEqual([
      '.env?.VITE_SUPABASE_URL',
    ]);
    expect(
      importMetaUses('(import.meta as { env?: Record<string, string> }).env ?? {}').map((t) =>
        offendingTail(t),
      ),
    ).toEqual([null]);

    // The form that shipped: the cast goes, the optional chain stays, and the
    // read is refused.
    const broken = '(import.meta as { env?: Record<string, string> })?.env?.[key]';
    expect(importMetaUses(broken).map((t) => offendingTail(t)).filter(Boolean)).toHaveLength(1);
  });

  it('does not read its own prose as code', () => {
    const stripped = stripCommentsAndStrings(
      "const a = 1; // import.meta?.env?.[k]\n/* import.meta?.env?.[k] */ const s = 'import.meta?.env?.[k]';",
    );
    expect(importMetaUses(stripped)).toEqual([]);
  });
});
