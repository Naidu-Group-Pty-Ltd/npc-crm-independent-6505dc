import { describe, expect, it } from 'vitest';
import {
  applySourceDiversity,
  assembleContext,
  authorityBoost,
  buildContextBlock,
  classifyDepth,
  DEPTH_PROFILES,
  normaliseInlineMarkers,
  remapCitedId,
  renderContextItem,
  rrfFuse,
  type MarketDoc,
} from '../../../supabase/functions/_shared/marketQaResearch';

const doc = (id: string, over: Partial<MarketDoc> = {}): MarketDoc => ({
  id,
  title: `Update ${id}`,
  source_name: 'ABC News Business',
  source_url: `https://example.test/${id}`,
  ...over,
});

describe('rrfFuse', () => {
  it('ranks a document found by several strategies above one found by a single strategy', () => {
    // `b` is only ever second, but three strategies agree on it. `a` is first
    // in one list and absent from the others.
    const fused = rrfFuse([
      { strategy: 'semantic', ids: ['a', 'b'] },
      { strategy: 'fulltext', ids: ['c', 'b'] },
      { strategy: 'lexical', ids: ['d', 'b'] },
    ]);
    expect(fused[0].id).toBe('b');
    expect(fused[0].strategies).toEqual(['semantic', 'fulltext', 'lexical']);
  });

  it('applies per-strategy weights', () => {
    const fused = rrfFuse([
      { strategy: 'semantic', weight: 1.4, ids: ['a'] },
      { strategy: 'recent', weight: 0.45, ids: ['b'] },
    ]);
    expect(fused[0].id).toBe('a');
  });

  it('records every strategy that surfaced a document exactly once', () => {
    const fused = rrfFuse([
      { strategy: 'semantic', ids: ['a'] },
      { strategy: 'semantic', ids: ['a'] },
    ]);
    expect(fused[0].strategies).toEqual(['semantic']);
  });

  it('ignores empty ids without shifting the ranks after them', () => {
    const fused = rrfFuse([{ strategy: 's', ids: ['', 'a'] }, { strategy: 't', ids: ['a'] }]);
    expect(fused.map(f => f.id)).toEqual(['a']);
  });
});

describe('applySourceDiversity', () => {
  it('demotes rather than discards items beyond the per-source cap', () => {
    const docs = [
      doc('1', { source_name: 'ABC' }), doc('2', { source_name: 'ABC' }),
      doc('3', { source_name: 'ABC' }), doc('4', { source_name: 'ABC' }),
      doc('5', { source_name: 'Domain' }),
    ];
    const ordered = applySourceDiversity(docs, 3);
    expect(ordered.map(d => d.id)).toEqual(['1', '2', '3', '5', '4']);
    // Nothing is lost — a thin corpus must still be able to fill the context.
    expect(ordered).toHaveLength(5);
  });
});

describe('assembleContext', () => {
  const byId = new Map<string, MarketDoc>([
    ['seed', doc('seed', { source_name: 'ABC' })],
    ['x', doc('x', { source_name: 'Domain' })],
    ['y', doc('y', { source_name: 'Reuters' })],
    ['z', doc('z', { source_name: 'MPA' })],
  ]);

  it('pins the focused update first and keeps it even when the limit is smaller', () => {
    const fused = rrfFuse([{ strategy: 'semantic', ids: ['x', 'y', 'z'] }]);
    const { docs } = assembleContext({ fused, byId, pinnedIds: ['seed'], limit: 1 });
    expect(docs[0].id).toBe('seed');
    expect(docs).toHaveLength(1);
  });

  it('surrounds the pinned update with fused neighbours rather than answering from it alone', () => {
    const fused = rrfFuse([{ strategy: 'semantic', ids: ['x', 'y', 'z'] }]);
    const { docs } = assembleContext({ fused, byId, pinnedIds: ['seed'], limit: 4 });
    expect(docs.map(d => d.id)).toEqual(['seed', 'x', 'y', 'z']);
  });

  it('never duplicates a pinned update that also came back from search', () => {
    const fused = rrfFuse([{ strategy: 'semantic', ids: ['seed', 'x'] }]);
    const { docs } = assembleContext({ fused, byId, pinnedIds: ['seed'], limit: 4 });
    expect(docs.filter(d => d.id === 'seed')).toHaveLength(1);
  });

  it('boosts sources cited earlier in the same conversation', () => {
    const fused = rrfFuse([{ strategy: 'semantic', ids: ['x', 'y', 'z'] }]);
    const { docs } = assembleContext({ fused, byId, anchorIds: ['z'], limit: 3 });
    expect(docs[0].id).toBe('z');
  });

  it('drops fused ids that could not be hydrated', () => {
    const fused = rrfFuse([{ strategy: 'semantic', ids: ['ghost', 'x'] }]);
    const { docs } = assembleContext({ fused, byId, limit: 5 });
    expect(docs.map(d => d.id)).toEqual(['x']);
  });
});

describe('renderContextItem', () => {
  it('passes the implication, excerpt and provenance columns the old prompt discarded', () => {
    const rendered = renderContextItem(doc('a', {
      ai_summary: 'Summary text',
      why_it_matters: 'Matters because',
      key_points: ['point one'],
      public_excerpt: 'Verbatim source language with $225 million in it.',
      property_implications: 'Property effect',
      finance_implications: 'Finance effect',
      policy_implications: 'Policy effect',
      risk_flags: ['cost_overrun'],
      lending_criteria_tags: ['serviceability'],
      source_authority: 'tier_1_media',
      legal_status: 'in_force',
      effective_date: '2026-07-01',
    }), 0);
    for (const expected of [
      'Property effect', 'Finance effect', 'Policy effect',
      '$225 million', 'cost_overrun', 'serviceability',
      'tier_1_media', 'in_force', 'effective 2026-07-01',
    ]) {
      expect(rendered).toContain(expected);
    }
  });

  it('numbers items from 1 so the [[N]] markers line up with the context order', () => {
    expect(renderContextItem(doc('a'), 0)).toContain('[[1]] id=a');
    expect(buildContextBlock([doc('a'), doc('b')])).toContain('[[2]] id=b');
  });

  it('omits empty fields rather than emitting blank labels', () => {
    const rendered = renderContextItem(doc('a'), 0);
    expect(rendered).not.toContain('Summary:');
    expect(rendered).not.toContain('Risk flags:');
  });
});

describe('citation handling', () => {
  const ordered = [doc('id-one'), doc('id-two')];
  const ids = new Set(ordered.map(d => d.id));

  it('accepts a raw id unchanged', () => {
    expect(remapCitedId('id-two', ids, ordered)).toBe('id-two');
  });

  it('recovers the display marker and bare index forms models return', () => {
    expect(remapCitedId('[[2]]', ids, ordered)).toBe('id-two');
    expect(remapCitedId('2', ids, ordered)).toBe('id-two');
  });

  it('leaves an unresolvable citation alone so validation can reject it', () => {
    expect(remapCitedId('invented', ids, ordered)).toBe('invented');
    expect(remapCitedId('[[9]]', ids, ordered)).toBe('[[9]]');
  });

  it('rewrites inline narrative markers to stable ids', () => {
    expect(normaliseInlineMarkers('Cost was $3.6b [[1]] and rising [[2]].', ordered))
      .toBe('Cost was $3.6b [[id-one]] and rising [[id-two]].');
  });

  it('leaves out-of-range inline markers untouched', () => {
    expect(normaliseInlineMarkers('claim [[7]]', ordered)).toBe('claim [[7]]');
  });
});

describe('depth selection', () => {
  it('treats a bare follow-up as brief', () => {
    expect(classifyDepth('what is the rate', 0)).toBe('brief');
  });

  it('escalates on analytical intent', () => {
    expect(classifyDepth('what are the implications for investors', 0)).toBe('deep');
    expect(classifyDepth('can you tell me more about this in depth', 0)).toBe('deep');
  });

  it('escalates as a conversation accumulates', () => {
    expect(classifyDepth('and rentals?', 6)).toBe('deep');
  });

  it('gives deeper modes a larger corpus and a larger answer budget', () => {
    expect(DEPTH_PROFILES.deep.contextSize).toBeGreaterThan(DEPTH_PROFILES.standard.contextSize);
    expect(DEPTH_PROFILES.standard.contextSize).toBeGreaterThan(DEPTH_PROFILES.brief.contextSize);
    expect(DEPTH_PROFILES.deep.wordBudget).toBeGreaterThan(DEPTH_PROFILES.brief.wordBudget);
  });
});

describe('authorityBoost', () => {
  it('ranks primary law and regulators above advocacy', () => {
    expect(authorityBoost('regulator')).toBeGreaterThan(authorityBoost('industry_advocacy'));
    expect(authorityBoost('primary_legal')).toBeGreaterThan(authorityBoost('tier_1_media'));
  });

  it('is neutral for an unknown or missing authority', () => {
    expect(authorityBoost(null)).toBe(0);
    expect(authorityBoost('something_new')).toBe(0);
  });
});
