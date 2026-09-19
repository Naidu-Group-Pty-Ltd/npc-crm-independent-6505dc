/**
 * ME-6 — the sample frame is structural, deterministic, and states its
 * differentiation tests before any data arrives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DIFFERENTIATION_PAIRS,
  SAMPLE_FRAME,
  SAMPLE_FRAME_VERSION,
  frameCallCount,
  subjectKeyOf,
} from '../market/evidenceSampleFrame.pure';

describe('the frame spans what the brief asked for', () => {
  it('covers all five named states', () => {
    const states = new Set(SAMPLE_FRAME.map((c) => c.state));
    for (const s of ['NSW', 'VIC', 'QLD', 'WA', 'SA']) expect(states.has(s)).toBe(true);
  });

  it('covers metro, outer metro and regional', () => {
    const r = new Set(SAMPLE_FRAME.map((c) => c.remoteness));
    expect(r.has('metro')).toBe(true);
    expect(r.has('inner_regional')).toBe(true);
    expect(r.has('outer_regional')).toBe(true);
  });

  it('covers houses and units', () => {
    const d = new Set(SAMPLE_FRAME.map((c) => c.dwelling));
    expect(d.has('house')).toBe(true);
    expect(d.has('attached')).toBe(true);
  });

  it('carries no duplicate cells', () => {
    const keys = SAMPLE_FRAME.map(subjectKeyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('costs one provider call per cell', () => {
    expect(frameCallCount()).toBe(SAMPLE_FRAME.length);
  });
});

describe('selection is structural — never on expected outcome', () => {
  it('no cell carries a performance label of any kind', () => {
    for (const cell of SAMPLE_FRAME) {
      expect(Object.keys(cell).sort()).toEqual(
        ['dwelling', 'postcode', 'properties', 'remoteness', 'state', 'suburb'],
      );
    }
  });

  it('the module never encodes strong/weak/declining as a selection axis', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/reports/market/evidenceSampleFrame.pure.ts'),
      'utf8',
    );
    // Strip the doc comments, which legitimately DISCUSS why the axis is absent.
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['strong', 'weak', 'declining', 'booming', 'growthTier']) {
      expect(code.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('includes low-count cells rather than only the biggest markets', () => {
    // Cherry-picking would show up as a frame made only of the busiest suburbs.
    expect(SAMPLE_FRAME.some((c) => c.properties === 1)).toBe(true);
    expect(SAMPLE_FRAME.some((c) => c.properties >= 15)).toBe(true);
  });
});

describe('the differentiation tests are named in advance', () => {
  it('states the WA, NSW and house-vs-unit questions', () => {
    const ids = DIFFERENTIATION_PAIRS.map((p) => p.id);
    expect(ids).toContain('wa_two_suburbs');
    expect(ids).toContain('nsw_two_suburbs');
    expect(ids).toContain('house_vs_unit_same_suburb');
  });

  it('every pair is genuinely two different subjects', () => {
    for (const p of DIFFERENTIATION_PAIRS) {
      expect(`${p.a.suburb}|${p.a.postcode}|${p.a.dwelling}`)
        .not.toBe(`${p.b.suburb}|${p.b.postcode}|${p.b.dwelling}`);
    }
  });

  it('every pair member exists in the frame — the test cannot reference a subject we never fetch', () => {
    const inFrame = new Set(SAMPLE_FRAME.map((c) => `${c.suburb}|${c.postcode}|${c.dwelling}`));
    for (const p of DIFFERENTIATION_PAIRS) {
      expect(inFrame.has(`${p.a.suburb}|${p.a.postcode}|${p.a.dwelling}`)).toBe(true);
      expect(inFrame.has(`${p.b.suburb}|${p.b.postcode}|${p.b.dwelling}`)).toBe(true);
    }
  });

  it('the house-vs-unit pairs hold suburb constant so only dwelling type varies', () => {
    for (const id of ['house_vs_unit_same_suburb', 'house_vs_unit_same_suburb_vic']) {
      const p = DIFFERENTIATION_PAIRS.find((x) => x.id === id)!;
      expect(p.a.suburb).toBe(p.b.suburb);
      expect(p.a.postcode).toBe(p.b.postcode);
      expect(p.a.dwelling).not.toBe(p.b.dwelling);
    }
  });

  it('is versioned so a snapshot can cite the frame it was drawn from', () => {
    expect(SAMPLE_FRAME_VERSION).toMatch(/^me6\./);
  });
});
