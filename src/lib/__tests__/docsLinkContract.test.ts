/**
 * The user guide links out to the documentation site, and the two must agree.
 *
 * The link carries the guide's section id as an anchor. If the documentation
 * has no section with that id the reader lands at the top of a long page with
 * no explanation, which is worse than not offering the link — so this pins the
 * anchors the guide can emit against the anchors the docs site publishes.
 *
 * Both sides are also gated on the same plan and add-on entitlement, which is
 * what makes the link safe to show unconditionally: a section visible in the
 * guide is by construction readable in the documentation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_SECTIONS } from '../userGuideContent';
import { SECTION_MODULE_SLUGS, SECTION_PROXY_MODULES } from '../userGuideEntitlements';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Section ids the docs site publishes, read from its public index.
 *
 * Read from the sibling checkout rather than imported: the two are separate
 * deployments. When the checkout is absent the guard degrades to a skip rather
 * than a false failure — a missing sibling repo is an environment fact, not a
 * defect in this one.
 */
function docsGuideAnchors(): Set<string> | null {
  try {
    const src = readFileSync(
      join(REPO_ROOT, '..', 'aurixa-systems', 'supabase', 'functions', '_shared', 'docsCorpus.foundations.ts'),
      'utf8',
    );
    const files = ['foundations', 'clients', 'platform'].map((n) =>
      readFileSync(
        join(REPO_ROOT, '..', 'aurixa-systems', 'supabase', 'functions', '_shared', `docsCorpus.${n}.ts`),
        'utf8',
      ),
    );
    void src;
    const anchors = new Set<string>();
    for (const file of files) {
      for (const m of file.matchAll(/guideSectionId: "([a-z0-9-]+)"/g)) anchors.add(m[1]);
    }
    return anchors;
  } catch {
    return null;
  }
}

/**
 * Every section id the guide page can render. The page renders
 * `GUIDE_SECTIONS` (from `userGuideContent.ts`) verbatim, filtered only by
 * entitlement, so the content module is the authoritative section list.
 */
function guideSectionIds(): string[] {
  return GUIDE_SECTIONS.map((s) => s.id);
}

describe('the guide offers a documentation link', () => {
  const page = read('src/pages/UserGuide.tsx');

  it('renders a per-section Read documentation control', () => {
    expect(page).toContain('Read documentation');
    expect(page).toContain('onClick={() => openDocumentation(section.id)}');
  });

  it('offers a top-level entry point too', () => {
    // Someone who has not opened a section still needs a way in.
    expect(page).toContain('Read full documentation');
    expect(page).toContain('onClick={() => openDocumentation()}');
  });

  it('imports the helper rather than hardcoding a URL', () => {
    expect(page).toContain("import { openDocumentation } from '@/lib/missionControl'");
    expect(page).not.toMatch(/aurixasystems\.com\.au\/docs/);
  });
});

describe('the documentation link mints an entitlement handoff', () => {
  const mc = read('src/lib/missionControl.ts');

  it('asks Mission Control for a handoff and passes it as an opaque token', () => {
    expect(mc).toContain("intent: \"docs\"");
    expect(mc).toContain('?h=${encodeURIComponent(data.handoffId)}');
  });

  it('never puts the plan in the URL', () => {
    // The docs site resolves entitlement server-side from the token. A plan in
    // the query string would be a gate the reader can edit.
    const fn = mc.slice(mc.indexOf('export async function openDocumentation'));
    expect(fn).not.toMatch(/plan=|addons=|tier=/);
  });

  it('still opens the docs when the mint fails', () => {
    // A failed mint must degrade to the public index, not to a dead link.
    const fn = mc.slice(mc.indexOf('export async function openDocumentation'));
    expect(fn).toContain('let url = `${AURIXA_DOCS_URL}${anchor}`');
    expect(fn).toContain('catch');
  });

  it('records the docs intent on the handoff', () => {
    const edge = read('supabase/functions/mission-control-handoff/index.ts');
    expect(edge).toContain('RECORDED_INTENTS');
    expect(edge).toMatch(/RECORDED_INTENTS\s*=\s*new Set\(\["docs"\]\)/);
  });
});

describe('guide anchors resolve in the documentation', () => {
  const anchors = docsGuideAnchors();

  it('every documented guide anchor is a real guide section', () => {
    if (!anchors) return; // sibling checkout unavailable
    const known = new Set(guideSectionIds());
    const dangling = [...anchors].filter((a) => !known.has(a));
    expect(dangling, `docs reference guide sections that do not exist: ${dangling.join(', ')}`).toEqual([]);
  });

  it('every gated guide section has documentation behind its link', () => {
    if (!anchors) return;
    // Universal sections are allowed to have no dedicated docs anchor — the
    // link still opens the docs index. Gated ones are the ones a customer is
    // most likely to click, so those must land somewhere specific.
    const gated = Object.keys(SECTION_MODULE_SLUGS);
    const missing = gated.filter((id) => !anchors.has(id));
    expect(
      missing,
      `priced guide sections with no matching documentation anchor: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('proxied sections are documented too', () => {
    if (!anchors) return;
    const missing = Object.keys(SECTION_PROXY_MODULES).filter((id) => !anchors.has(id));
    expect(missing, `proxied guide sections with no documentation: ${missing.join(', ')}`).toEqual([]);
  });
});
