#!/usr/bin/env node
/**
 * No vendor API secret may live in the browser bundle.
 *
 * `src/hooks/useGoogleFonts.ts` shipped a live Google API key as a string
 * literal, under a comment claiming the endpoint needed no key. Vite inlines
 * `src/` into the bundle, so that key was served to every visitor of the app and
 * is in the history of every build. It is also billable — and per
 * `docs/integrations/API_USAGE_METERING.md` a Mission Control workspace runs on
 * the PRIME's vendor keys, so a leaked key spends someone else's money.
 *
 * A key in frontend source is not a secret, however it is spelled. The rule is
 * that it belongs in a Supabase function secret behind an edge function; the
 * Google Fonts catalogue now comes from `google-fonts-catalog`.
 *
 * `VITE_`-prefixed variables are equally public — Vite substitutes them at build
 * time — so this also refuses a `VITE_` name that reads like a secret. The
 * Supabase URL and publishable/anon key are exempt: they are designed to be
 * public and are protected by RLS, not by obscurity.
 *
 * Run: node scripts/security/check-client-bundle-secrets.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const srcDir = join(root, 'src');

const failures = [];

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Literal shapes that are unambiguously credentials. Deliberately anchored to
 * vendor prefixes rather than entropy: a generic "long random string" matcher
 * fires on minified data, hashes and test fixtures, and a gate that cries wolf
 * gets disabled.
 */
const SECRET_LITERALS = [
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'OpenAI/Anthropic-style secret key', re: /\bsk-[A-Za-z0-9]{24,}/ },
  { name: 'Stripe live secret key', re: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: 'Stripe test secret key', re: /\bsk_test_[A-Za-z0-9]{16,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{24,}/ },
  { name: 'Slack bot token', re: /\bxoxb-[A-Za-z0-9-]{20,}/ },
  { name: 'GitHub personal access token', re: /\bghp_[A-Za-z0-9]{30,}/ },
  { name: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

/** `VITE_` names that would be public but read as secret. */
const VITE_SECRET_NAME = /\bimport\.meta\.env\.(VITE_[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|_API_KEY|_TOKEN)[A-Z0-9_]*)/g;
const VITE_ALLOWED = new Set(['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let scanned = 0;
for (const file of walk(srcDir)) {
  const rel = relative(root, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  // Test fixtures deliberately contain fake credentials to prove redaction works.
  const isTest = /\.(test|spec)\.tsx?$/.test(rel) || rel.includes('__tests__');
  const code = stripComments(raw);
  scanned += 1;

  if (!isTest) {
    for (const { name, re } of SECRET_LITERALS) {
      const match = code.match(re);
      if (match) {
        failures.push(
          `${rel}: contains what looks like a ${name} (${match[0].slice(0, 8)}…). ` +
            `Everything under src/ is inlined into the browser bundle. Move it to a ` +
            `Supabase function secret and reach it through an edge function.`,
        );
      }
    }
  }

  for (const match of code.matchAll(VITE_SECRET_NAME)) {
    const name = match[1];
    if (VITE_ALLOWED.has(name)) continue;
    failures.push(
      `${rel}: reads ${name}. VITE_ variables are substituted at build time and ship to ` +
        `the browser, so this cannot hold a secret. Use an edge function instead.`,
    );
  }
}

// The font catalogue specifically must go through the server proxy.
const fonts = readFileSync(join(srcDir, 'hooks', 'useGoogleFonts.ts'), 'utf8');
if (fonts.includes('googleapis.com/webfonts')) {
  failures.push(
    'src/hooks/useGoogleFonts.ts: calls the Google Fonts API directly. It must go through ' +
      'the google-fonts-catalog edge function, which holds GOOGLE_FONTS_API_KEY server-side.',
  );
}

if (failures.length > 0) {
  console.error('Client-bundle secret scan FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Client-bundle secret scan passed (${scanned} source files, no vendor secrets shipped).`);
