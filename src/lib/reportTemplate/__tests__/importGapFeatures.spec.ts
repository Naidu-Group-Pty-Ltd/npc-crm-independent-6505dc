/**
 * Advisor-plan gap features: image-as-background import, merge-text-boxes
 * cleanup, and semantic placeholder detection → dynamic bindings.
 */
import { describe, it, expect } from 'vitest';
import { buildImageBackgroundSchema } from '../ingestion/importOrchestrator';
import { mergeTextOverlays } from '../editorActions';
import { detectPlaceholderSuggestions, applyPlaceholderSuggestions } from '../ingestion/placeholderDetect';
import { parseTemplate, type Page, type ReportTemplate } from '../templateSchema';

const textOverlay = (id: string, content: string, props: Record<string, unknown> = {}) => ({
  id, type: 'text', x: 40, y: 40, width: 200, height: 20, rotation: 0, opacity: 1,
  content, fontFamily: 'Inter', fontSize: 12, fontWeight: 'normal', fontStyle: 'normal',
  color: '#111111', align: 'left', lineHeight: 1.3, letterSpacing: 0, ...props,
});

const makeTemplate = (overlays: any[]): ReportTemplate => parseTemplate({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'p1', name: 'Page 1', size: { width: 595, height: 842 }, background: {},
    blocks: [{ id: 'b1', type: 'free', props: {}, overlays }],
  }],
  slots: {},
});

describe('buildImageBackgroundSchema (import as background)', () => {
  it('sets the active page background + aspect-correct size, keeping other pages', () => {
    const base = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [
        { id: 'cover', name: 'Cover', size: { width: 595, height: 842 }, background: {}, blocks: [] },
        { id: 'p2', name: 'Two', size: { width: 595, height: 842 }, background: {}, blocks: [] },
      ],
      slots: {},
    });
    const out = buildImageBackgroundSchema({
      schema: base, activePageId: 'cover',
      dataUrl: 'data:image/png;base64,AAAA', imageWidth: 1000, imageHeight: 1414,
    });
    expect(out.pages[0].background.imageUrl).toBe('data:image/png;base64,AAAA');
    // A4-fit, aspect preserved (1000:1414 ≈ 595:841)
    const ratio = out.pages[0].size.width / out.pages[0].size.height;
    expect(ratio).toBeCloseTo(1000 / 1414, 1);
    expect(out.pages[1].background.imageUrl).toBeUndefined();
  });

  it('creates a fresh single-page template when no schema is supplied', () => {
    const out = buildImageBackgroundSchema({
      dataUrl: 'data:image/png;base64,BBBB', imageWidth: 800, imageHeight: 600, templateName: 'Brochure',
    });
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].background.imageUrl).toBe('data:image/png;base64,BBBB');
    expect(out.meta?.title).toBe('Brochure');
  });
});

describe('mergeTextOverlays (Phase 3 cleanup)', () => {
  const page = (overlays: any[]): Page => makeTemplate(overlays).pages[0];

  it('merges same-line fragments with spaces and stacked lines with newlines', () => {
    const p = page([
      textOverlay('a', 'Median', { x: 40, y: 100, width: 60 }),
      textOverlay('b', 'House Price', { x: 104, y: 100, width: 90 }),
      textOverlay('c', 'Kalkallo', { x: 40, y: 140 }),
    ]);
    const { page: out, mergedId } = mergeTextOverlays(p, ['a', 'b', 'c']);
    expect(mergedId).toBeTruthy();
    const merged: any = out.blocks[0].overlays.find((o) => o.id === mergedId);
    expect(merged.content).toBe('Median House Price\nKalkallo');
    expect(out.blocks[0].overlays).toHaveLength(1);
    // Union bbox
    expect(merged.x).toBe(40);
    expect(merged.width).toBeGreaterThanOrEqual(154);
    // Identical styles → no runs needed
    expect(merged.runs).toBeUndefined();
  });

  it('preserves mixed styling as rich-text runs and keeps the lowest confidence', () => {
    const p = page([
      textOverlay('a', 'Gross yield', { y: 100, color: '#111111', confidence: 0.9 }),
      textOverlay('b', '4.2%', { y: 100, x: 260, color: '#C8102E', fontWeightNumeric: 700, confidence: 0.6 }),
    ]);
    const { page: out, mergedId } = mergeTextOverlays(p, ['a', 'b']);
    const merged: any = out.blocks[0].overlays.find((o) => o.id === mergedId);
    expect(merged.runs).toHaveLength(2);
    expect(merged.runs[1].color).toBe('#C8102E');
    expect(merged.confidence).toBe(0.6);
  });

  it('ignores locked/hidden/non-text overlays and needs at least two text hits', () => {
    const p = page([
      textOverlay('a', 'One'),
      textOverlay('b', 'Two', { locked: true }),
    ]);
    const { page: out, mergedId } = mergeTextOverlays(p, ['a', 'b']);
    expect(mergedId).toBeNull();
    expect(out).toBe(p); // untouched
  });
});

describe('placeholder detection (Phase 4 semantic mapping)', () => {
  it('detects the NPC field candidates from a Cloverton-style cover', () => {
    const tpl = makeTemplate([
      textOverlay('addr', 'Lot 60941 Cloverton Estate, Kalkallo VIC 3064'),
      textOverlay('client', 'Prepared for [Client Name]'),
      textOverlay('rent', 'Expected rent $650/wk'),
      textOverlay('price', 'Total purchase price $1,850,000'),
      textOverlay('yield', 'Gross yield 4.2% per annum'),
      textOverlay('bound', 'Already dynamic {{property.suburb}}'),
    ]);
    const suggestions = detectPlaceholderSuggestions(tpl);
    const byPath = Object.fromEntries(suggestions.map((s) => [s.path, s]));
    expect(byPath['property.address'].matchText).toContain('Cloverton Estate');
    expect(byPath['client.name'].matchText).toBe('[Client Name]');
    expect(byPath['financials.weeklyRent'].matchText).toBe('650');
    expect(byPath['financials.purchasePrice'].matchText).toBe('1,850,000');
    expect(byPath['financials.purchasePrice'].confidence).toBeGreaterThanOrEqual(0.85);
    expect(byPath['financials.yield'].matchText).toBe('4.2');
    // Overlays that already contain bindings are skipped.
    expect(suggestions.some((s) => s.overlayId === 'bound')).toBe(false);
  });

  it('detects suburb-only location lines without claiming street addresses', () => {
    const tpl = makeTemplate([textOverlay('loc', 'Kalkallo, VIC 3064')]);
    const suggestions = detectPlaceholderSuggestions(tpl);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ path: 'property.suburb', matchText: 'Kalkallo' });
  });

  it('bounds address matching for long attacker-controlled near misses', () => {
    const crafted = `${'Alpha '.repeat(1_000)}Estate ${'Bravo '.repeat(1_000)}ZZ 1234`;
    const tpl = makeTemplate([textOverlay('crafted', crafted)]);
    expect(detectPlaceholderSuggestions(tpl)).toEqual([]);
  });

  it('does not flag plain percentages without yield context', () => {
    const tpl = makeTemplate([textOverlay('v', 'Vacancy sits at 1.2% this quarter')]);
    expect(detectPlaceholderSuggestions(tpl).some((s) => s.path === 'financials.yield')).toBe(false);
  });

  it('applies accepted suggestions as {{bindings}} in content and runs', () => {
    const tpl = makeTemplate([
      textOverlay('rent', 'Expected rent $650/wk', {
        runs: [
          { text: 'Expected rent ' },
          { text: '$650/wk', color: '#C8102E' },
        ],
      }),
    ]);
    const suggestions = detectPlaceholderSuggestions(tpl);
    expect(suggestions).toHaveLength(1);
    const { template: out, applied } = applyPlaceholderSuggestions(tpl, suggestions);
    expect(applied).toBe(1);
    const overlay: any = out.pages[0].blocks[0].overlays[0];
    expect(overlay.content).toBe('Expected rent ${{financials.weeklyRent}}/wk');
    expect(overlay.runs[1].text).toBe('${{financials.weeklyRent}}/wk');
    expect(overlay.runs[1].color).toBe('#C8102E'); // styling survives
  });
});
