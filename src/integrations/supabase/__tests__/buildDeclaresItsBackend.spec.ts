/**
 * The build states which Supabase project it resolved, through the one rule
 * that decides it.
 *
 * ## Why a declaration at all
 *
 * The prime's project ref is compiled into every bundle as `FALLBACK_URL`. So
 * a CORRECTLY configured clone's JavaScript names both its own project and the
 * prime's, and reading the artefact for a project name cannot say which one
 * the client uses. Measured on a real build of this repository: the entry
 * chunk is 5,036,633 bytes and a scan of it can only answer "unproven", while
 * `/version.json` answers in 89 bytes.
 *
 * That matters because nothing outside the browser could otherwise check.
 * Measured 19 Sep 2026, three of the four live clones served a bundle pointed
 * at the PRIME's database while every signal the provisioner held was green —
 * the variables WERE set, the sync DID run, the build DID succeed. Mission
 * Control reads this field to assert, by effect, that a deployment talks to
 * its own backend.
 *
 * ## Why these are source contracts
 *
 * Both are absences. The manifest keeps emitting a perfectly valid
 * `{ buildId }` with the backend block deleted, and a second copy of "which
 * project is this" in the config keeps producing a plausible answer while
 * drifting from the one the client runs. Neither shows up in a type, a lint or
 * a build.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Comments are where these rules are EXPLAINED — the pure module's own header
 * says "nothing here reads `import.meta`" — so a scan that reads them finds
 * the prose describing the trap and reports it as the trap. Caught by this
 * very assertion on its first run.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROOT = join(__dirname, '..', '..', '..', '..');
const CONFIG = stripComments(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'));
const PURE = stripComments(
  readFileSync(join(ROOT, 'src', 'integrations', 'supabase', 'supabaseTarget.pure.ts'), 'utf8'),
);
const ENV = stripComments(
  readFileSync(join(ROOT, 'src', 'integrations', 'supabase', 'env.ts'), 'utf8'),
);

describe('the build declares its backend', () => {
  it('version.json carries the resolved project ref and where it came from', () => {
    expect(CONFIG).toMatch(/fileName:\s*"version\.json"/);
    expect(CONFIG).toMatch(/projectRef:\s*projectRefFromUrl\(/);
    expect(CONFIG).toMatch(/source:\s*target\.source/);
  });

  it("resolves from VITE's environment, never from process.env", () => {
    // Vite loads `.env`, `.env.local` and `.env.[mode]` into `import.meta.env`
    // and never copies them into `process.env`. A manifest resolved from
    // `process.env` therefore declares the PRIME on a clone whose variables
    // came from a dotenv file rather than from real shell variables — which is
    // the exact inversion this manifest exists to catch, served as a clean
    // declaration. `loadEnv` is Vite's own resolution, so the manifest and the
    // client read the same values under the same precedence.
    expect(CONFIG).toMatch(/buildVersionManifest\(\s*loadEnv\(/);
    expect(CONFIG).toMatch(/loadEnv\(mode, process\.cwd\(\), \["VITE_"\]\)/);

    const start = CONFIG.indexOf('function buildVersionManifest');
    const end = CONFIG.indexOf('export default defineConfig');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The plugin is handed an environment; it must not reach for another one.
    expect(CONFIG.slice(start, end)).not.toContain('process.env');
  });

  it('through the SAME resolver the running client uses, not a second copy', () => {
    // Two implementations of "which project is this" is how a manifest and a
    // client come to disagree, and a manifest that disagrees is worse than
    // none.
    expect(CONFIG).toMatch(/await\s+|resolveSupabaseTarget\(/);
    expect(CONFIG).toContain('supabaseTarget.pure');
    // And the config must not re-derive the pairing rule for itself.
    expect(CONFIG).not.toMatch(/projectRefFromAnonKey\s*\(/);
  });
});

describe('the pure half is loadable outside a bundler', () => {
  it('names no import.meta, which is the only reason a Vite config can import it', () => {
    expect(PURE).not.toContain('import.meta');
  });

  it('and keeps the fallback pair, so a build with no environment still resolves one', () => {
    expect(PURE).toContain('FALLBACK_URL');
    expect(PURE).toContain('FALLBACK_ANON_KEY');
  });

  it('while env.ts keeps the reads and re-exports rather than re-implementing', () => {
    expect(ENV).toContain("from './supabaseTarget.pure'");
    expect(ENV).toMatch(/export\s*\{[^}]*resolveSupabaseTarget/s);
    // The judgement moved; the reads did not.
    expect(ENV).toContain('import.meta.env.VITE_SUPABASE_URL');
    expect(PURE).not.toMatch(/function\s+readConfigured/);
  });
});
