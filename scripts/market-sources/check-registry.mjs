/**
 * The shipped source catalogue still matches the migrations that define it.
 *
 * `canonicalRegistry.generated.ts` is what a deployment seeds itself from when
 * its registry is empty. If it drifts from the migrations, a clone gets a
 * different marketplace from the prime — and nothing else would notice,
 * because both are internally consistent.
 *
 * The same shape as `investmentCompassSource.spec.ts`: re-run the extraction
 * and compare, rather than trusting that somebody re-ran the generator.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(
  process.cwd(), 'supabase', 'functions', '_shared', 'marketSources',
  'canonicalRegistry.generated.ts',
);

const committed = readFileSync(OUT, 'utf8');
const backup = mkdtempSync(join(tmpdir(), 'market-registry-'));
writeFileSync(join(backup, 'committed.ts'), committed);

execFileSync('node', ['scripts/market-sources/extract-registry.mjs'], { stdio: 'pipe' });
const regenerated = readFileSync(OUT, 'utf8');

if (regenerated !== committed) {
  // Put the committed file back: a check must not leave the tree changed.
  writeFileSync(OUT, committed);
  console.error('Market source registry check FAILED.');
  console.error('');
  console.error('  The generated catalogue does not match the migrations that define it.');
  console.error('  Run `npm run market:registry:generate` and commit the result.');
  console.error('');
  console.error('  This matters because a deployment with an empty registry seeds itself');
  console.error('  from that file. Drift means a clone gets a different marketplace from');
  console.error('  the prime, and nothing else in the system would notice.');
  process.exit(1);
}

const count = /CANONICAL_MARKET_SOURCE_COUNT = (\d+)/.exec(committed)?.[1] ?? '0';
if (Number(count) === 0) {
  console.error('Market source registry check FAILED: the catalogue is empty.');
  process.exit(1);
}
console.log(`Market source registry check passed (${count} sources, generated file matches the migrations).`);
