/**
 * Read an Edge Function entrypoint *together with the handler it serves*.
 *
 * ## The problem this solves
 *
 * Most gates in this directory read `supabase/functions/<name>/index.ts` and
 * pattern-match it. That works while an entrypoint contains its own logic. It
 * stops working the moment one becomes a shim:
 *
 *     import { handleStaffLogin } from '../_shared/customAuth/login.ts';
 *     Deno.serve((req: Request) => handleStaffLogin(req, 'v1'));
 *
 * WP-28 introduced exactly that shape, to stop `custom-auth-login` and
 * `custom-auth-login-v2` from drifting apart again. It broke two gates in
 * opposite directions on the same commit, which is what makes the pattern worth
 * a helper rather than two patches:
 *
 *   * `check-auth-rate-limit-coverage` FAILED — it looked for an
 *     `enforceAuthRateLimit(` call in the entrypoint and the call had moved.
 *     Loud, and therefore harmless.
 *   * `check-public-validation` PASSED — it looks for a body read, found none
 *     in the shim, and skipped the function entirely. Silent, and therefore
 *     the dangerous one: an endpoint stopped being checked and nothing said so.
 *
 * A gate that a refactor can silently switch off is the failure this whole
 * suite exists to prevent.
 *
 * ## What it follows, and what it deliberately does not
 *
 * Only the modules whose bindings are **referenced inside `Deno.serve(...)`**,
 * one level deep.
 *
 * Not the transitive closure. `_shared/auth.ts` alone reaches most of the
 * shared tree, and several gates forbid expressions that legitimately appear
 * somewhere in it — `check-auth-rate-limit-coverage` forbids
 * `headers.get('x-forwarded-for')`, which `getTrustedClientIp` must contain to
 * do its job. A blanket closure would fail every endpoint in the repository and
 * teach everyone to widen the rule instead of narrowing the walk.
 *
 * One level reaches the handler a shim serves, which is the thing the gate was
 * always trying to read.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Strip comments so a quoted example is never read as a call site. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The `Deno.serve(...)` argument region, brace-balanced.
 *
 * Returns '' when the file does not call it — a module that is not an
 * entrypoint, which is not an error here.
 */
function serveRegion(src) {
  const at = src.search(/\bDeno\.serve\s*\(/);
  if (at < 0) return '';
  const open = src.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** `import { a, b as c } from './x.ts'` → [{ names: ['a','c'], spec: './x.ts' }] */
function relativeImports(src) {
  const out = [];
  for (const m of src.matchAll(/import\s+([^;'"]*?)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const clause = m[1];
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const bits = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        const local = (bits[1] ?? bits[0] ?? '').trim();
        if (local) names.push(local);
      }
    }
    const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.push(def);
    out.push({ names, spec: m[2] });
  }
  return out;
}

/**
 * Entrypoint source, plus the source of any module whose binding is used inside
 * `Deno.serve(...)`.
 *
 * The concatenation is what callers pattern-match. Order is entrypoint first so
 * an index-based assertion (`identifierAt < gateAt`) still reads the
 * entrypoint's own ordering when it has any.
 */
export function readEntrypointSource(root, name) {
  const entry = join(resolve(root), 'supabase', 'functions', name, 'index.ts');
  const src = readFileSync(entry, 'utf8');
  const region = serveRegion(stripComments(src));
  if (!region.trim()) return src;

  const parts = [src];
  for (const { names, spec } of relativeImports(src)) {
    if (!names.some((n) => new RegExp(`\\b${n}\\b`).test(region))) continue;
    try {
      parts.push(readFileSync(join(dirname(entry), spec), 'utf8'));
    } catch {
      // A specifier that does not resolve on disk is not this helper's problem;
      // `check-edge-functions.mjs` type-checks every entrypoint and will say so.
    }
  }
  return parts.join('\n');
}
