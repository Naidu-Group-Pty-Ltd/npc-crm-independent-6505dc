/**
 * The private-artifact rule exists twice, and this is what stops them drifting.
 *
 * ## The round trip that produced it
 *
 * `scanPdfImportPrivateArtifacts` (TypeScript, under `src/`) is the copy the
 * unit tests exercise. `classifyArtifact` (`.mjs`, under `scripts/regression/`)
 * is the copy `pdf-import-release-gate` actually runs in CI.
 *
 * On 30 Aug 2026 a brand asset repair was failing the gate, so the
 * classification was narrowed — in the TypeScript copy. Four new specs passed,
 * lint and build were clean, the change merged, it cascaded to the downstream
 * clone, and `pdf-import-release-gate` failed on exactly the same file. The
 * copy that decides had never moved, and nothing anywhere could have said so.
 *
 * The script runs under plain `node` with no build step, and nothing in
 * `scripts/` imports from `src/`, so a single shared module is not available
 * across that boundary. What is available is this: both sides are real modules
 * now, and this spec loads both and asserts they answer identically. Two
 * implementations that cannot disagree without a red test is the honest version
 * of one implementation.
 *
 * A path added to one rule and not the other fails here — including one added
 * to neither, since the table below is the specification both are held to.
 */
import { describe, expect, it } from 'vitest';
import { scanPdfImportPrivateArtifacts } from '../ingestion/releaseGate/releaseGateSafetyScanner';
// A plain `.mjs` sibling of the gate script, deliberately outside `src/` so
// `node` can run it with no build step. TypeScript resolves it through
// `allowJs`; the casts below are because it carries no type annotations.
import {
  classifyArtifact,
  isCommittedAsset,
} from '../../../../scripts/regression/pdfImportArtifactClass.mjs';

/**
 * Every shape either rule has an opinion about, plus the ones that made this
 * spec necessary. `code` is what BOTH must answer; `null` means "ordinary
 * file, no finding".
 */
const CASES: Array<{ path: string; code: string | null; why: string }> = [
  // The file that cost the round trip.
  { path: 'public/brand/aurixa-emblem-240.png', code: null, why: 'brand asset, shipped' },
  { path: 'public/icons/icon-512.png', code: null, why: 'app icon, shipped' },
  { path: 'public/templates/npc-qa-content.jpg', code: null, why: 'template cover, shipped' },
  { path: 'src/assets/brands/logo.webp', code: null, why: 'bundled asset' },

  // Rasters outside the asset trees stay critical.
  { path: 'final.png', code: 'private_image', why: 'stray at the repository root' },
  { path: 'reports/page-3.png', code: 'private_image', why: 'rendered page' },
  { path: 'tmp/render.jpeg', code: 'private_image', why: 'scratch render' },
  { path: 'docs/diagram.JPG', code: 'private_image', why: 'case-insensitive extension' },

  // A PDF is never exempted, wherever it sits.
  { path: 'public/brand/client-report.pdf', code: 'private_pdf', why: 'published to the internet' },
  { path: 'reports/client.pdf', code: 'private_pdf', why: 'private document' },

  // The exemption is on the TREE, not the extension.
  { path: 'public/debug.log', code: 'private_log_or_env', why: 'a log is a log anywhere' },
  { path: 'src/assets/.env', code: 'private_log_or_env', why: 'secrets are never assets' },
  { path: '.env', code: 'private_log_or_env', why: 'dotenv at the root' },
  { path: '.env.local', code: 'private_log_or_env', why: 'where .gitignore says secrets live' },
  { path: 'apps/web/.env.production', code: 'private_log_or_env', why: 'dotenv in a subdirectory' },
  { path: '.env.example', code: null, why: 'committed on purpose — the one ! in .gitignore' },
  { path: '.env.sample', code: null, why: 'conventional template name' },
  { path: 'src/environment.ts', code: null, why: 'not a dotenv file at all' },

  // The remaining codes, so neither copy loses one quietly.
  { path: 'notes/signed-url-dump.txt', code: 'signed_url_or_log_dump', why: 'signed URL dump' },
  { path: 'notes/signed_url.txt', code: 'signed_url_or_log_dump', why: 'underscore spelling' },
  { path: 'ops/cloud-run-logs.txt', code: 'signed_url_or_log_dump', why: 'Cloud Run log' },
  { path: 'ops/supabase-log.txt', code: 'signed_url_or_log_dump', why: 'Supabase log' },
  { path: 'audit-output/scan.txt', code: 'private_log_or_env', why: 'audit output' },
  { path: 'supabase/config.toml.before-migration', code: 'private_log_or_env', why: 'config backup' },

  // Ordinary source is ordinary.
  { path: 'src/lib/aml/caseSearch.pure.ts', code: null, why: 'source' },
  { path: 'README.md', code: null, why: 'documentation' },
];

const tsCode = (path: string): string | null =>
  scanPdfImportPrivateArtifacts([path])[0]?.code ?? null;
const mjsCode = (path: string): string | null =>
  (classifyArtifact as (p: string) => [string | null, string | null])(path)[0] ?? null;

describe('the two copies of the private-artifact rule agree', () => {
  for (const { path, code, why } of CASES) {
    it(`${path} → ${code ?? 'no finding'} (${why})`, () => {
      expect(tsCode(path), 'releaseGateSafetyScanner.ts').toBe(code);
      expect(mjsCode(path), 'pdfImportArtifactClass.mjs — the copy CI runs').toBe(code);
    });
  }

  it('answers identically across the whole table, not just case by case', () => {
    /* Stated once more as a whole, because the per-case assertions above would
       still pass if both copies were wrong in the same NEW way — this is the
       shape a future divergence takes. */
    const ts = CASES.map((c) => tsCode(c.path));
    const mjs = CASES.map((c) => mjsCode(c.path));
    expect(mjs).toEqual(ts);
  });
});

describe('the asset-tree exemption itself', () => {
  it('covers public/ and src/assets/ and nothing else', () => {
    expect((isCommittedAsset as (p: string) => boolean)('public/anything.png')).toBe(true);
    expect((isCommittedAsset as (p: string) => boolean)('src/assets/anything.png')).toBe(true);
    expect((isCommittedAsset as (p: string) => boolean)('src/components/anything.png')).toBe(false);
    expect((isCommittedAsset as (p: string) => boolean)('assets/anything.png')).toBe(false);
    /* Not a prefix match on a longer segment name: `publications/` is not
       `public/`. */
    expect((isCommittedAsset as (p: string) => boolean)('publications/x.png')).toBe(false);
  });
});
