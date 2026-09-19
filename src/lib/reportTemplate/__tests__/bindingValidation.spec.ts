import { describe, it, expect } from 'vitest';
import { validateBindable, buildSuggestions, collectTemplateIssues } from '../bindingValidation';
import { type ReportTemplate } from '../templateSchema';

const tmpl = (overrides: any = {}): ReportTemplate =>
  ({ version: 1, tokens: { colors: {}, fonts: {}, spacing: {} }, pages: [], ...overrides } as unknown as ReportTemplate);

describe('validateBindable', () => {
  it('accepts known paths (incl. suffix matches) and known filters', () => {
    expect(validateBindable('{{property.address}}')).toEqual([]);
    expect(validateBindable('{{property.address.line1}}')).toEqual([]); // suffix
    expect(validateBindable('{{financials.weeklyRent | currency}}')).toEqual([]);
    expect(validateBindable('plain literal text')).toEqual([]);
    expect(validateBindable(null)).toEqual([]);
  });

  it('flags an unknown path', () => {
    const issues = validateBindable('{{property.adres}}');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Unknown path "property\.adres"/);
  });

  it('flags an unknown filter', () => {
    const issues = validateBindable('{{property.address | curency}}');
    expect(issues.some((i) => /Unknown filter "curency"/.test(i.message))).toBe(true);
  });

  it('flags an empty binding and unbalanced braces', () => {
    expect(validateBindable('{{ }}').some((i) => /Empty binding/.test(i.message))).toBe(true);
    expect(validateBindable('{{property.address').some((i) => /Unbalanced/.test(i.message))).toBe(true);
  });

  it('skips path validation for inline expressions (=) and computed refs (@)', () => {
    expect(validateBindable('{{=1 + 2}}')).toEqual([]);
    expect(validateBindable('{{@myComputed}}')).toEqual([]);
  });

  it('validates token: literals against the template tokens', () => {
    const t = tmpl({ tokens: { colors: { primary: '#000' }, fonts: {}, spacing: {} } });
    expect(validateBindable('token:primary', t)).toEqual([]);
    expect(validateBindable('token:nope', t)[0].message).toMatch(/Unknown token "nope"/);
  });
});

describe('buildSuggestions', () => {
  it('includes data paths, filters and template tokens', () => {
    const t = tmpl({ tokens: { colors: { primary: '#000' }, fonts: { heading: 'Georgia' }, spacing: {} } });
    const s = buildSuggestions(t);
    expect(s.some((x) => x.insert === '{{property.address}}' && x.group === 'Data')).toBe(true);
    expect(s.some((x) => x.group === 'Filters')).toBe(true);
    expect(s.some((x) => x.insert === 'token:primary' && x.group === 'Tokens')).toBe(true);
    expect(s.some((x) => x.insert === 'token:heading' && x.group === 'Tokens')).toBe(true);
  });
});

describe('collectTemplateIssues', () => {
  const withOverlayContent = (content: string): ReportTemplate =>
    tmpl({
      pages: [{
        id: 'p1', name: 'P', size: { width: 595, height: 842 }, background: {},
        blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [
          { id: 'o1', type: 'text', content, x: 0, y: 0, width: 10, height: 10 },
        ] }],
      }],
    });

  it('finds a bad binding and tags its location', () => {
    const issues = collectTemplateIssues(withOverlayContent('{{property.adres}}'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const issue = issues.find((i) => i.field === 'content')!;
    expect(issue.message).toMatch(/Unknown path/);
    expect(issue.overlayId).toBe('o1');
    expect(issue.pageIndex).toBe(0);
  });

  it('returns nothing for a clean template', () => {
    expect(collectTemplateIssues(withOverlayContent('{{property.address}}'))).toEqual([]);
  });
});
