/**
 * Guard against the user guide falling behind the app again.
 *
 * The guide documented 32 areas while the app shipped 191 routes, and the gap
 * was not random — it was everything added after the guide was first written.
 * AML/CTF had zero coverage despite being a Launch-tier baseline feature and a
 * headline priced module.
 *
 * The cause was structural: three hand-maintained copies of the section list
 * (the guide page, this knowledge base, and a hardcoded link list in the
 * assistant's edge function). These tests assert the invariants that make the
 * drift visible the moment it happens rather than months later.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  userGuideKnowledge,
  formatKnowledgeBaseForAI,
  formatModuleAwarenessForAI,
  getAllSectionIds,
} from '../userGuideKnowledge';
import { GUIDE_SECTIONS } from '../userGuideContent';
import { MODULE_TIERS } from '../pricing/planEntitlements';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const readRepoFile = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Section ids the guide page renders. The page renders `GUIDE_SECTIONS`
 * verbatim (filtered only by entitlement), so the content module is the
 * page's section list — including the sections from `userGuideSections.ts`,
 * which it appends itself.
 */
function pageSectionIds(): string[] {
  return GUIDE_SECTIONS.map((s) => s.id);
}

describe('guide page and AI knowledge base agree', () => {
  it('documents every section the page renders', () => {
    const page = new Set(pageSectionIds());
    const kb = new Set(getAllSectionIds());
    const missing = [...page].filter((id) => !kb.has(id));
    expect(
      missing,
      `Sections on the page the assistant cannot see: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('does not claim sections the page will not render', () => {
    const page = new Set(pageSectionIds());
    const extra = getAllSectionIds().filter((id) => !page.has(id));
    // A link to a section that does not exist scrolls the user nowhere.
    expect(extra, `Knowledge base sections with no page anchor: ${extra.join(', ')}`).toEqual([]);
  });

  it('has no duplicate section ids', () => {
    const ids = getAllSectionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('priced module coverage', () => {
  /**
   * Modules deliberately documented inside a broader section rather than
   * getting one of their own. Listed explicitly so adding a NEW module still
   * fails this test until somebody decides where it belongs.
   */
  const DOCUMENTED_ELSEWHERE: Record<string, string> = {
    'opportunity-marketplace': 'property-management',
    'report-comparisons': 'reports-analytics',
    'cashflow-comparisons': 'cash-flow-analysis',
    'portfolio-analysis': 'reports-analytics',
    'send-portfolio': 'client-management',
    'client-forms': 'client-management',
    'client-ai': 'client-management',
    'intelligence-hub': 'report-qa',
    'aurixa-agent': 'ai-agent',
    'email-copilot': 'email-copilot',
    'call-logs': 'call-logs',
    'borrowing-capacity': 'borrowing-capacity',
    'deal-pipeline': 'deal-pipeline',
    agreements: 'agreements',
    marketing: 'marketing-analytics',
    integrations: 'integrations',
    'api-usage': 'api-usage',
    lenders: 'lender-intelligence',
  };

  it('every priced module is documented somewhere', () => {
    const ids = new Set(getAllSectionIds());
    const uncovered: string[] = [];

    for (const slug of Object.keys(MODULE_TIERS)) {
      if (ids.has(slug)) continue;
      const home = DOCUMENTED_ELSEWHERE[slug];
      if (home && ids.has(home)) continue;
      uncovered.push(slug);
    }

    expect(
      uncovered,
      `Priced modules a customer can buy with no guide coverage: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('the areas that were missing are now covered', () => {
    const ids = new Set(getAllSectionIds());
    for (const id of [
      'aml-ctf',
      'finance-portal',
      'solicitor-portal',
      'builder-portal',
      'commercial-industrial',
      'market-updates',
      'model-hub',
      'game-plan',
      'partner-network',
      'quantitative-reports',
      'pdf-import',
      'billing-usage',
      'lender-intelligence',
    ]) {
      expect(ids.has(id), `${id} missing from the guide`).toBe(true);
    }
  });
});

describe('formatKnowledgeBaseForAI', () => {
  it('emits every section id so the assistant can link without a hardcoded list', () => {
    // Unfiltered (plan unknown). With a known plan the context is deliberately
    // narrowed to what the workspace may see — covered in
    // userGuideEntitlements.test.ts.
    const ctx = formatKnowledgeBaseForAI(null);
    for (const id of getAllSectionIds()) {
      expect(ctx, `section id ${id} absent from AI context`).toContain(`Section ID: \`${id}\``);
    }
  });

  it('leads with the module catalogue, before any feature prose', () => {
    const ctx = formatKnowledgeBaseForAI('launch');
    expect(ctx.indexOf('MODULE CATALOGUE')).toBeLessThan(ctx.indexOf('FEATURE DOCUMENTATION'));
  });

  it('includes the documentation body', () => {
    const ctx = formatKnowledgeBaseForAI('scale', ['finance-portal']);
    expect(ctx).toContain('AML / CTF Compliance');
    expect(ctx).toContain('Finance Portal');
  });
});

describe('formatModuleAwarenessForAI', () => {
  it('separates included from upgrade-only for a known plan', () => {
    const launch = formatModuleAwarenessForAI('launch');
    expect(launch).toContain('Launch plan');
    expect(launch).toContain('Included in this plan');
    expect(launch).toContain('requires an upgrade');
    // Finance Portal is Scale-only; AML follows the purchased SKU, so with
    // no add-ons stated it sits in the add-on section, not "included".
    const included = launch.slice(
      launch.indexOf('### Included in this plan'),
      launch.indexOf('### Not included'),
    );
    expect(included).not.toContain('Finance Portal');
    expect(included).not.toContain('AML / CTF Compliance');
    const addonSection = launch.slice(launch.indexOf('### Available as a paid add-on'));
    expect(addonSection).toContain('AML / CTF Compliance');
    // A snapshot that carries the slug (every headline SKU) reports AML as
    // included — a paying customer is never told to buy it twice.
    const withAml = formatModuleAwarenessForAI('launch', ['aml-ctf']);
    const includedWithAml = withAml.slice(
      withAml.indexOf('### Included in this plan'),
      withAml.indexOf('### Not included'),
    );
    expect(includedWithAml).toContain('AML / CTF Compliance');
  });

  it('names the plan that unlocks something the current plan lacks', () => {
    const launch = formatModuleAwarenessForAI('launch');
    expect(launch).toMatch(/Finance Portal \(available on Scale\)/);
  });

  it('grows what is included as the plan goes up', () => {
    const count = (s: string) =>
      s.slice(s.indexOf('### Included in this plan'), s.indexOf('### Not included')).split('\n-')
        .length;
    expect(count(formatModuleAwarenessForAI('scale'))).toBeGreaterThan(
      count(formatModuleAwarenessForAI('launch')),
    );
  });

  it('asks rather than assumes when the plan is unknown', () => {
    for (const unknown of [null, undefined, 'enterprise']) {
      const ctx = formatModuleAwarenessForAI(unknown);
      expect(ctx).toContain('Plan unknown');
      expect(ctx).toContain('ask the user which plan');
    }
  });

  it('tells the assistant not to explain features the plan excludes', () => {
    expect(formatModuleAwarenessForAI('launch')).toContain(
      'Never walk someone through using something their plan does not include',
    );
  });

  it('lists sub-features both enabled and blocked for a plan', () => {
    const launch = formatModuleAwarenessForAI('launch');
    expect(launch).toContain('Sub-features enabled on this plan');
    expect(launch).toContain('Sub-features NOT enabled on this plan');
    // Borrowing Capacity is a Clients tab gated to Scale.
    expect(launch).toMatch(/Borrowing Capacity \(available on Scale\)/);
  });
});

describe('assistant edge function', () => {
  const edge = () => readRepoFile('supabase/functions/user-guide-assistant/index.ts');

  it('no longer hardcodes a section-link list', () => {
    // The hardcoded list was a third copy of the section index and went stale
    // whenever a section was added. Ids now travel in the knowledge base.
    const matches = edge().match(/Use \[\[section:[a-z-]+\|/g) ?? [];
    expect(matches).toEqual([]);
  });

  it('instructs the model to use only ids from the knowledge base', () => {
    expect(edge()).toContain('NEVER invent a section id');
  });

  it('instructs the model to check entitlements before explaining a feature', () => {
    const src = edge();
    expect(src).toContain('PLAN & MODULE AWARENESS');
    expect(src).toContain('does NOT mean this workspace has it');
  });
});

describe('section content quality', () => {
  it('every section has a description and at least one item', () => {
    for (const section of userGuideKnowledge) {
      expect(section.description.length, `${section.id} has no description`).toBeGreaterThan(10);
      expect(section.items.length, `${section.id} has no items`).toBeGreaterThan(0);
    }
  });

  it('every item has a description worth reading', () => {
    for (const section of userGuideKnowledge) {
      for (const item of section.items) {
        expect(item.description.length, `${section.id} → ${item.title}`).toBeGreaterThan(20);
      }
    }
  });
});
