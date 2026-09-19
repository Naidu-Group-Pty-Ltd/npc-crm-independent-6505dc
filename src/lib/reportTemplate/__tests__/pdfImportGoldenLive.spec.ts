/**
 * Tier 3 — live corpus runner (Path-to-100 v2 · C10).
 *
 * Gated behind `PDF_IMPORT_GOLDEN_LIVE=1` so it is SKIPPED in CI and in normal
 * local runs. When enabled by an operator, it reads a corpus of client PDFs from
 * a local, git-excluded directory (`PDF_IMPORT_GOLDEN_CORPUS_DIR`) and would
 * drive real imports against Supabase + Cloud Run. Client PDFs are never
 * committed — the manifest references local files only.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGoldenLiveEnabled,
  parseGoldenLiveCorpusManifest,
  PDF_IMPORT_GOLDEN_CORPUS_DIR_ENV,
} from '../ingestion/goldenCorpus';

const LIVE = isGoldenLiveEnabled(process.env as Record<string, string | undefined>);

describe('Tier 3 gate', () => {
  it('is inactive unless PDF_IMPORT_GOLDEN_LIVE is set (so CI never runs it)', () => {
    expect(isGoldenLiveEnabled({})).toBe(false);
  });
});

describe.skipIf(!LIVE)('Tier 3 — live corpus', () => {
  const dir = (process.env as Record<string, string | undefined>)[PDF_IMPORT_GOLDEN_CORPUS_DIR_ENV] ?? '';

  it('requires a corpus directory when the live tier is enabled', () => {
    expect(dir, `set ${PDF_IMPORT_GOLDEN_CORPUS_DIR_ENV} to a local (uncommitted) corpus directory`).not.toBe('');
  });

  it('loads a valid, file-referencing corpus manifest', () => {
    const manifestPath = join(dir, 'manifest.json');
    expect(existsSync(manifestPath), `missing ${manifestPath}`).toBe(true);
    const manifest = parseGoldenLiveCorpusManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), dir);
    expect(manifest.problems).toEqual([]);
    expect(manifest.entries.length).toBeGreaterThan(0);
    // Every referenced PDF must exist locally (never committed to the repo).
    for (const entry of manifest.entries) {
      expect(existsSync(join(dir, entry.file)), `missing corpus file ${entry.file}`).toBe(true);
    }
    // The real end-to-end import (Supabase + Cloud Run) runs from here,
    // operator-driven, when credentials are present.
  });
});
