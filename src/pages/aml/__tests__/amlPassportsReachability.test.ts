/**
 * The Compliance Passport is a DEDICATED page, and must stay one.
 *
 * Two failures have already happened here and each is pinned below.
 *
 *  1. It shipped correct and unreachable — its only mount was a tab inside the
 *     case workspace, behind an unrelated cutover flag, so no navigation path
 *     led to it and a finished feature read as missing.
 *  2. It was then reachable but not integrated: the link was in the nav's
 *     `secondary` list and absent from the workspace's `paths`, so the page it
 *     opened rendered with no secondary nav at all.
 *
 * The architecture that answers both is a page of its own under the AML/CTF
 * Compliance navigation — NOT a section grafted onto the surfaces where
 * compliance work is done. These assertions hold that line in both directions:
 * the destination must exist, and the Passport must not creep back into the
 * case workspace, the case tabs or Compliance Home.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

const app = read('src/App.tsx');
const layout = read('src/components/aml/AmlLayout.tsx');

describe('Compliance Passport reachability', () => {
  it('has a Command Centre route under the AML module', () => {
    expect(app).toContain('path="passport"');
    expect(app).toContain('AmlPassports');
    // Guarded like every other AML page — visibility never bypasses access.
    expect(app).toMatch(/path="passport"[^\n]*AmlGuard capability="aml\.view"/);
  });

  it('has a client-portal booklet route', () => {
    expect(app).toContain('path="aml/passport"');
    expect(app).toContain('PortalPassport');
  });

  it('appears in BOTH AML navigation shells', () => {
    // Two nav configs exist (legacy + V3); a destination in only one of them
    // is invisible to whichever shell the tenant is actually running.
    const hits = layout.match(/to: "\/admin\/aml\/passport"/g) ?? [];
    expect(hits.length).toBe(2);
    expect(layout).toContain('"Compliance Passport"');
  });

  it('every secondary destination is also in its workspace `paths`', () => {
    // The shell resolves the ACTIVE workspace from `paths` and renders the
    // secondary strip from that workspace alone — so a destination absent from
    // `paths` opens a page with no secondary nav, highlighting Compliance Home
    // while you stand on another page.
    //
    // Asserted for the whole nav rather than for the Passport, because the
    // trap belongs to the shell, not to this page.
    const chunks = layout.split(/\bkey:\s*"/).slice(1);
    let checked = 0;
    for (const chunk of chunks) {
      const pathsBlock = chunk.match(/paths:\s*\[([\s\S]*?)\]/)?.[1];
      const secondaryBlock = chunk.match(/secondary:\s*\[([\s\S]*?)\]/)?.[1];
      if (!pathsBlock || !secondaryBlock) continue;
      const paths = [...pathsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const dests = [...secondaryBlock.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const dest of dests) {
        checked += 1;
        expect(paths, `${dest} is a secondary link but not in its workspace paths`)
          .toContain(dest);
      }
    }
    // Guard the guard: a regex that matched nothing would pass silently.
    expect(checked).toBeGreaterThan(8);
  });

  it('the page renders the dedicated Passport workspace', () => {
    const page = read('src/pages/aml/AmlPassports.tsx');
    expect(page).toContain('PassportWorkspace');
    // One projection call per opened customer, never preloaded for the whole
    // register — the page picks a customer, the workspace fetches.
    expect(page).not.toMatch(/getPassportView/);
  });

  it('is NOT embedded in the surfaces where compliance work is done', () => {
    // The Passport is the record that casework produces. Rendering it inside
    // the case workspace made it read as one more tab and is what this
    // architecture deliberately undid — re-adding it there would restore the
    // problem, not fix one.
    for (const file of [
      'src/pages/aml/AmlCaseWorkspace.tsx',
      'src/components/aml/CaseWorkspaceTabs.tsx',
      'src/pages/aml/AmlOverview.tsx',
      'src/pages/aml/AmlComplianceHomeV3.tsx',
    ]) {
      const source = read(file);
      expect(source, `${file} must not mount the Passport workspace`)
        .not.toMatch(/PassportWorkspace|CommandPassportSection/);
    }
  });

  it('the existing reliance and journey sections are left where they were', () => {
    // The revert must not take pre-existing AML functionality with it:
    // ReliancePassportSection and ComplianceJourneyMap predate the Passport
    // programme and stay in the case workspace.
    const workspace = read('src/pages/aml/AmlCaseWorkspace.tsx');
    expect(workspace).toContain('ReliancePassportSection');
    expect(workspace).toContain('ComplianceJourneyMap');
  });
});
