#!/usr/bin/env node
/**
 * A signed storage URL is minted by the SERVER, never by the browser.
 *
 * ## The defect this gate exists for
 *
 * `Agreements.tsx` opened "Prepare for Signing" by calling
 * `supabase.storage.from('agency-agreements').createSignedUrl(...)` directly
 * from the browser. This app's identity is a custom HttpOnly cookie, so that
 * client is **anon**: it holds no authority over a private bucket. The request
 * was refused, and Supabase Storage answers a refusal with the SAME message as
 * a genuine absence — `Object not found` — because confirming that an object
 * exists would itself leak. So the operator saw
 *
 *     Failed to load PDF: Object not found
 *
 * on a row the page had just labelled GENERATED · READY, while "View
 * Agreement" on that very row worked — because View goes through
 * `manage-agency-agreements`, which mints the URL with the service role.
 *
 * That is the worst shape a permission failure can take: it reads as missing
 * data, so it sends whoever investigates to look for a document that is
 * sitting right there.
 *
 * ## The rule
 *
 * `createSignedUrl` is the one storage operation that exists ONLY for private
 * objects. Calling it from the browser is therefore always wrong here — it
 * cannot succeed, and when it fails it lies about why. Signing belongs to a
 * server that has verified the session: `secure-storage`'s `signedUrl`
 * operation for a bucket on its allow-list, or the feature's own Edge
 * Function.
 *
 * There is no baseline file. The count reached zero, so it stays there.
 *
 * Deliberately NOT flagged: `getPublicUrl` (a public bucket needs no
 * authority), and `download`/`upload`/`remove`, which are legitimate against
 * the buckets that grant them and would need a per-bucket judgement this gate
 * cannot make from source alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** `.storage.from('bucket').createSignedUrl(` — with any whitespace. */
const PATTERN = /\.storage\s*\.\s*from\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.\s*createSignedUrl\s*\(/g;

/** Source files only; specs may legitimately describe the shape they forbid. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('createSignedUrl')) continue;
  PATTERN.lastIndex = 0;
  let match;
  while ((match = PATTERN.exec(source)) !== null) {
    violations.push({
      file: relative(ROOT, file),
      line: source.slice(0, match.index).split('\n').length,
      bucket: match[1],
    });
  }
}

if (violations.length === 0) {
  console.log('Browser signed-URL gate passed (no client-side createSignedUrl).');
  process.exit(0);
}

console.error(
  `\nA signed storage URL must be minted by the server, not the browser.\n`
  + `This client runs as anon (the session is an HttpOnly cookie), so a private\n`
  + `bucket refuses it — and the refusal is reported as "Object not found",\n`
  + `which reads as missing data rather than as a permission failure.\n\n`
  + `Route it through secure-storage's signedUrl operation, or the feature's\n`
  + `own Edge Function, as "View Agreement" already does.\n`,
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  bucket "${v.bucket}"`);
}
console.error(`\n${violations.length} violation(s).`);
process.exit(1);
