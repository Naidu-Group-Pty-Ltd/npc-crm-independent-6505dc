import { describe, it, expect } from 'vitest';
import { buildFixes, applyFix, applyAllAutoFixes } from '../bindingFixer';
import { collectTemplateIssues, type TemplateIssue } from '../bindingValidation';
import { type ReportTemplate } from '../templateSchema';

const issue = (message: string, ctx: Partial<TemplateIssue> = {}): TemplateIssue =>
  ({ raw: '', start: 0, end: 0, message, where: '', ...ctx } as TemplateIssue);

const tmpl = (overrides: any = {}): ReportTemplate =>
  ({
    version: 1,
    tokens: { colors: { primary: '#000', accent: '#fff' }, fonts: {}, spacing: {} },
    pages: [],
    ...overrides,
  } as unknown as ReportTemplate);

const overlayTemplate = (content: string): ReportTemplate =>
  tmpl({
    pages: [{
      id: 'p1', name: 'P', size: { width: 595, height: 842 }, background: {},
      blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [
        { id: 'o1', type: 'text', content, x: 0, y: 0, width: 10, height: 10 },
      ] }],
    }],
  });

describe('buildFixes', () => {
  it('suggests the closest filter for a typo', () => {
    const fixes = buildFixes([issue('Unknown filter "curency"', { field: 'content' })], tmpl(), {});
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe('filter');
    expect(fixes[0].broken).toBe('curency');
    expect(fixes[0].suggestions[0].replacement).toBe('currency');
  });

  it('suggests the closest token for a typo', () => {
    const fixes = buildFixes([issue('Unknown token "primry"')], tmpl(), {});
    expect(fixes[0].kind).toBe('token');
    expect(fixes[0].suggestions[0].replacement).toBe('primary');
  });

  it('suggests a data path from sample data', () => {
    const fixes = buildFixes(
      [issue('Unknown path "propery.address"', { field: 'content' })],
      tmpl(),
      { property: { address: '12 Smith St' } },
    );
    expect(fixes[0].kind).toBe('path');
    expect(fixes[0].suggestions[0].replacement).toBe('property.address');
  });

  it('skips non-fixable issues (e.g. empty binding)', () => {
    expect(buildFixes([issue('Empty binding')], tmpl(), {})).toEqual([]);
  });
});

describe('applyFix', () => {
  it('replaces a broken filter while keeping the path intact', () => {
    const template = overlayTemplate('{{property.address | curency}}');
    const fix = {
      issue: issue('Unknown filter "curency"', { pageId: 'p1', blockId: 'b1', overlayId: 'o1', field: 'content' }),
      kind: 'filter' as const,
      broken: 'curency',
      suggestions: [],
    };
    const next = applyFix(template, fix, 'currency');
    expect((next.pages[0].blocks[0].overlays[0] as any).content).toBe('{{property.address | currency}}');
  });
});

describe('end-to-end: validate → build → auto-apply', () => {
  it('auto-applies a high-confidence filter fix', () => {
    const template = overlayTemplate('{{property.address | curency}}');
    const issues = collectTemplateIssues(template);
    const fixes = buildFixes(issues, template, { property: { address: '12 St' } });
    const res = applyAllAutoFixes(template, fixes);
    expect(res.applied).toBeGreaterThanOrEqual(1);
    expect((res.template.pages[0].blocks[0].overlays[0] as any).content).toBe('{{property.address | currency}}');
  });
});
