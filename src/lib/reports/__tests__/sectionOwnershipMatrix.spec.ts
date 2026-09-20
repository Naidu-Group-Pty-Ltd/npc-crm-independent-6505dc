/**
 * The committed matrix and the registry must not drift.
 *
 * `docs/reports/SECTION_OWNERSHIP_MATRIX.md` is the answer to §6's "record each
 * topic's authoritative producer, full-detail owner and permitted summary
 * placements". Written by hand it is wrong the first time a producer changes
 * and nothing says so — the same reason the registry itself exists — so it is
 * generated, and this fails when the committed file no longer matches.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'docs/reports/SECTION_OWNERSHIP_MATRIX.md';

describe('the five-format ownership matrix', () => {
  it('matches what the generator emits from the registry', () => {
    const before = readFileSync(PATH, 'utf8');
    execFileSync('npx', ['tsx', 'scripts/verify/section-ownership-matrix.mjs'], { stdio: 'pipe' });
    const after = readFileSync(PATH, 'utf8');
    expect(after).toBe(before);
  });

  it('every format has a column, and every topic a row', () => {
    const md = readFileSync(PATH, 'utf8');
    for (const t of ['Compass', 'Financial Analysis', 'Strategic / Due Diligence',
      'Executive Briefing', 'Snapshot']) {
      expect(md).toContain(t);
    }
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('|---'));
    // One header row plus one per section.
    expect(rows.length).toBeGreaterThan(30);
  });

  it('a spine topic has no single owner, because every format carries it', () => {
    // Naming one would invite somebody to remove it from the other four.
    const md = readFileSync(PATH, 'utf8');
    const spine = md.split('\n').filter((l) => l.startsWith('| ') && l.includes('| spine |'));
    expect(spine.length).toBeGreaterThan(0);
    for (const row of spine) expect(row).toContain('every format (spine)');
  });

  it('says it is generated, and names the command that regenerates it', () => {
    const md = readFileSync(PATH, 'utf8');
    expect(md).toContain('do not hand-edit');
    expect(md).toContain('scripts/verify/section-ownership-matrix.mjs');
  });

  it('a topic with no producer is listed rather than left to be noticed', () => {
    const md = readFileSync(PATH, 'utf8');
    expect(md).toContain('## Topics with no producer at all');
  });
});
