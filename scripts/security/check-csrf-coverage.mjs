#!/usr/bin/env node
// SEC5-CSRF coverage gate.
//
// Every staff-facing edge function (one that authenticates a cookie-carried
// session via the shared verifyAuth) must invoke enforceCsrf so a cross-site
// cookie-authenticated mutation is rejected. enforceCsrf is safe-by-default
// (GET/HEAD/OPTIONS and no-cookie callers pass through), so this can be applied
// universally. New functions that use verifyAuth without the guard fail here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FUNC_DIR = 'supabase/functions';

// Functions intentionally exempt (documented). Keep this list tiny and justified.
const EXEMPT = new Set([
  // none currently — every verifyAuth function is wired.
]);

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '_shared') walk(p); continue; }
    if (name !== 'index.ts') continue;
    const rel = p.replace(`${FUNC_DIR}/`, '');
    const slug = rel.replace(/\/index\.ts$/, '');
    if (EXEMPT.has(slug)) continue;
    const src = readFileSync(p, 'utf8');
    // Staff cookie-auth surface = uses the shared verifyAuth (static or dynamic import).
    //
    // `\w*` rather than `\b`, and the difference was not cosmetic. `\bverifyAuth\b`
    // requires a NON-word character after "verifyAuth", so it could not match
    // `verifyAuthOrNativeUser` — the wrapper twelve functions authenticate
    // through. Every one of them reads the `__Host-session_token` cookie (it
    // delegates straight to `verifyAuth`), that cookie is `SameSite=None`, and
    // none of them ran `enforceCsrf`. This gate printed "CSRF coverage check
    // passed" the whole time, which is worse than not existing: it was read as
    // evidence that the surface was covered.
    //
    // Reported by the render-boundary audit, August 2026. The offenders were the
    // nine `render-*-pdf` routes plus convert-template-document,
    // generate-brand-design-system and pdf-import-ssim-score.
    const usesVerifyAuth = /\bverifyAuth\w*\b/.test(src) && /_shared\/auth\.ts/.test(src);
    if (!usesVerifyAuth) continue;
    if (!/\benforceCsrf\b/.test(src)) offenders.push(slug);
  }
}
walk(FUNC_DIR);

if (offenders.length) {
  console.error('CSRF coverage check FAILED — these verifyAuth (cookie-auth) functions do not invoke enforceCsrf:');
  for (const o of offenders.sort()) console.error(`  - ${o}`);
  console.error('\nAdd `enforceCsrf(req)` right after the OPTIONS handler (see _shared/csrfGuard.ts),');
  console.error('or add a justified entry to EXEMPT in scripts/security/check-csrf-coverage.mjs.');
  process.exit(1);
}
console.log('CSRF coverage check passed (all verifyAuth cookie-auth functions invoke enforceCsrf).');
