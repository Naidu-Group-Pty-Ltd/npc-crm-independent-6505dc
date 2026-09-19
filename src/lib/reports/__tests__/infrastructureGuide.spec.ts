/**
 * The Lot 20427 treatment for the infrastructure table — S5/S6 §4.
 *
 * *"Explain what each material table or finding means, its limitations and the
 * practical next action."* `planningControlGuide` does it for planning
 * controls; this does it for the outlook table, which carried the vocabulary
 * ("an approval is not funding") and the coverage ("what these registers do
 * not reach") and nothing a reader could act on.
 *
 * The rule that makes it safe is `planningControlGuide`'s own: **everything is
 * true of the KIND of entry, never of the property**, which is what lets every
 * word be written in advance and still be true everywhere. These assert it
 * rather than trust it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ABSENCE_GUIDE,
  FINDING_GUIDE,
  guidesForKinds,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/infrastructureGuide.pure';
import {
  buildInfrastructureEvidence,
  renderInfrastructureOutlook,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const ALL = [...Object.values(FINDING_GUIDE), ABSENCE_GUIDE];
const textOf = (g: typeof ABSENCE_GUIDE) => `${g.what} ${g.limits} ${g.next}`;

describe('every entry answers the three questions', () => {
  it('has a what, a limitation and a next action, each a real sentence', () => {
    for (const [kind, g] of Object.entries(FINDING_GUIDE)) {
      expect(g.what.length, `${kind}.what`).toBeGreaterThan(60);
      expect(g.limits.length, `${kind}.limits`).toBeGreaterThan(60);
      expect(g.next.length, `${kind}.next`).toBeGreaterThan(40);
      for (const part of [g.what, g.limits, g.next]) expect(part.trim()).toMatch(/[.!?]$/);
    }
  });

  it('the next action names something to obtain or somebody to ask', () => {
    for (const [kind, g] of Object.entries(FINDING_GUIDE)) {
      expect(g.next, kind).toMatch(/\b(ask|obtain|open|look|watch|publishes|published|tracker)\b/i);
    }
  });
});

describe('nothing here is about the property, and nothing is a number', () => {
  it('states no currency amount, percentage, measurement or year', () => {
    for (const g of ALL) {
      const t = textOf(g);
      expect(t).not.toMatch(/\$\s?\d/);
      expect(t).not.toMatch(/\d+\s?%/);
      expect(t).not.toMatch(/\b\d+(\.\d+)?\s?(m|km|ha|m2|m²|sqm)\b/i);
      expect(t).not.toMatch(/\b(19|20)\d{2}\b/);
      // Bare digits are the shape a fabricated control takes.
      expect(t).not.toMatch(/\b\d+\b/);
    }
  });

  it('never says anything about THIS property', () => {
    for (const g of ALL) {
      const t = textOf(g);
      expect(t).not.toMatch(/\bthis (property|site|lot|dwelling) (is|has|sits|will|would)\b/i);
      expect(t).not.toMatch(/\b(affects|applies to|does not apply to) this\b/i);
    }
  });

  it('rates nothing and quantifies no effect on value', () => {
    for (const g of ALL) {
      const t = textOf(g);
      expect(t).not.toMatch(/\b(low|moderate|high|minimal|negligible|favourable) (risk|impact|exposure)\b/i);
      expect(t).not.toMatch(/\b(uplift|increase|decrease) (in|to) (value|price)\b/i);
    }
  });
});

describe('the guide follows the table', () => {
  const evidence = (kinds: string[], notSearched = false) => ({
    items: kinds.map((kind, i) => ({
      name: `Entry ${'ABCDEFG'[i]}`, reference: null, kind, statedStatus: null, standing: null,
      dateLabel: null, date: null, where: null, address: null, statedCost: null, costBasis: null,
      statedCostRange: null, fundingPartners: [], statedDelivery: null, applications: null,
      source: 'a register', licence: null, retrievedAt: null,
    })),
    pipelineDwellings: null, pipelineInvestment: null, registerWalk: null,
    absences: [], programmeStatement: null,
    readings: notSearched
      ? [{ register: 'development instruments' as const, reading: 'not_searched' as const, note: 'n' }]
      : [],
    coverageLimits: [], retrievedAt: null, anyEvidenced: kinds.length > 0, enrichmentMissing: false,
  });

  it('draws only the kinds the table actually holds', () => {
    const out = renderInfrastructureOutlook(evidence(['Development application']));
    expect(out).toContain('*Development application.*');
    expect(out).not.toContain('*Coordinated project.*');
    expect(out).not.toContain('*Committed government investment.*');
  });

  it('draws each kind once however many rows carry it', () => {
    const out = renderInfrastructureOutlook(evidence(['Development application', 'Development application']));
    expect(out.split('*Development application.*')).toHaveLength(2);
  });

  it('reads the kind through an amendment suffix', () => {
    expect(guidesForKinds(['Development application · amended 3 times in this window']))
      .toHaveLength(1);
  });

  it('draws the absence entry only where a register was not searched', () => {
    expect(renderInfrastructureOutlook(evidence(['Development application'], true)))
      .toContain('*A register that was not searched.*');
    expect(renderInfrastructureOutlook(evidence(['Development application'], false)))
      .not.toContain('*A register that was not searched.*');
  });

  it('opens the section even when the absence is the only finding', () => {
    const out = renderInfrastructureOutlook(evidence([], true));
    expect(out).toContain('**What these findings mean, and what to do about them.**');
    expect(out).toContain('*A register that was not searched.*');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('draws nothing at all where there is neither a kind nor an absence', () => {
    expect(renderInfrastructureOutlook(evidence([], false)))
      .not.toContain('**What these findings mean');
  });
});

describe('every kind the evidence builder can write is explained', () => {
  it('names each `kind:` literal the builder sets', () => {
    const src = readFileSync('supabase/functions/_shared/planning/infrastructureEvidence.pure.ts', 'utf8');
    // The kinds the builder writes inline, plus the instrument labels it
    // resolves through `INSTRUMENT_LABEL` — read from that map alone, because
    // a looser scan picks up `DELIVERY_STANDING_LABEL`, whose values are
    // statuses rather than kinds.
    const literals = [...src.matchAll(/kind: (?:standing === 'funded' \? )?'([A-Z][^']+)'/g)]
      .map((m) => m[1]);
    const labelBlock = src.match(/const INSTRUMENT_LABEL[^{]*\{([^}]*)\}/)![1];
    const labels = [...labelBlock.matchAll(/'([A-Z][^']+)'/g)].map((m) => m[1]);
    const kinds = new Set([...literals, ...labels]);
    expect(kinds.size).toBeGreaterThan(3);
    for (const kind of kinds) {
      // `Instrument` is the builder's own last-resort fallback for a kind the
      // layer did not name; it is deliberately not explained, because a guide
      // to "we do not know what this is" would say nothing.
      if (kind === 'Instrument') continue;
      expect(FINDING_GUIDE, kind).toHaveProperty(kind);
    }
  });
});
