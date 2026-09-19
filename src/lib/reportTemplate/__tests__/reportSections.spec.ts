import { describe, expect, it } from 'vitest';
import { chunkReportContent, markdownToPlainText, stripHeadingNumbering } from '../reportSections';
import {
  buildSampleSectionsData,
  canonicalSectionFieldPath,
  contractFromStructureTemplate,
  extractStructureHeadings,
  withSampleSectionData,
} from '../cascadeMap';

const REPORT_MD = `# 1. Executive Summary

This property at **12 Sample St** offers a *compelling* investment case [1].

- Strong rental yield of 4.8%
- Vacancy rate under 1% [2]

{{bars: Yield 7.4, Growth 8.1 | title=Investment Pillars | max=10}}

---

# 2. Financial Analysis

| Metric | Value |
|--------|-------|
| Weekly rent | $650 |
| Gross yield | 4.8% |

See [the full breakdown](https://example.com) for details.

## Loan structure

Principal & interest repayments dominate year one.

---

# 3. Risk & Recommendations

1. Diversify across suburbs
2. Review insurance annually
`;

describe('chunkReportContent', () => {
  it('passes structured object content through unchanged', () => {
    const obj = { executive_summary: { title: 'Exec', body: 'Body' } };
    expect(chunkReportContent(obj)).toEqual(obj);
  });

  it('returns empty for null/empty/non-string input', () => {
    expect(chunkReportContent(null)).toEqual({});
    expect(chunkReportContent('')).toEqual({});
    expect(chunkReportContent(undefined)).toEqual({});
  });

  it('chunks a combined markdown report at top-level headings', () => {
    const sections = chunkReportContent(REPORT_MD) as Record<string, any>;
    const ids = Object.keys(sections);
    expect(ids).toEqual(['1_executive_summary', '2_financial_analysis', '3_risk_and_recommendations']);
    expect(sections['1_executive_summary'].title).toBe('Executive Summary');
    expect(sections['1_executive_summary'].body).toContain('12 Sample St');
    expect(sections['1_executive_summary'].body).not.toContain('**');
    expect(sections['1_executive_summary'].body).not.toContain('{{bars');
    expect(sections['1_executive_summary'].body).not.toContain('[1]');
    expect(sections['1_executive_summary'].highlights).toEqual([
      'Strong rental yield of 4.8%',
      'Vacancy rate under 1%',
    ]);
  });

  it('keys chunks with the structure-template heading slugs when they alias-match', () => {
    const structureMd = '# Executive Summary\n\n# Financial Analysis\n\n# Risk and Recommendations\n';
    const structureHeadings = extractStructureHeadings(structureMd);
    const sections = chunkReportContent(REPORT_MD, { structureHeadings }) as Record<string, any>;
    // Report headings carry numbering ("# 1. Executive Summary") and "&", the
    // structure doesn't — ids must still land on the contract slugs.
    expect(Object.keys(sections)).toEqual(['executive_summary', 'financial_analysis', 'risk_and_recommendations']);
  });

  it('produces ids that line up with the Cascade contract for the same structure', () => {
    const structureMd = '# Executive Summary\n\n# Financial Analysis\n\n# Risk and Recommendations\n';
    const contract = contractFromStructureTemplate({ id: 't1', name: 'Guide', parsed_content: structureMd });
    const sections = chunkReportContent(REPORT_MD, { structureHeadings: extractStructureHeadings(structureMd) }) as Record<string, any>;
    for (const section of contract.sections) {
      expect(sections[section.id]).toBeDefined();
      expect(canonicalSectionFieldPath(section.id)).toBe(`sections.${section.id}.body`);
    }
  });

  it('renders tables and links as clean plain text in bodies', () => {
    const sections = chunkReportContent(REPORT_MD) as Record<string, any>;
    const body = sections['2_financial_analysis'].body;
    expect(body).toContain('Weekly rent · $650');
    expect(body).toContain('the full breakdown');
    expect(body).not.toContain('](');
    expect(body).not.toContain('|--');
  });

  it('keeps sub-headings inside the parent chunk', () => {
    const sections = chunkReportContent(REPORT_MD) as Record<string, any>;
    expect(sections['2_financial_analysis'].body).toContain('Loan structure');
    expect(Object.keys(sections)).not.toContain('loan_structure');
  });

  it('captures a meaningful preamble as an Overview section', () => {
    const md = `This report was prepared for a client evaluating a three-bedroom house purchase.\n\n# Detail\n\nBody text here.`;
    const sections = chunkReportContent(md) as Record<string, any>;
    expect(sections['overview']).toBeDefined();
    expect(sections['overview'].body).toContain('three-bedroom');
    expect(sections['detail']).toBeDefined();
  });

  it('handles headings duplicated in the report without dropping content', () => {
    const md = `# Summary\n\nFirst.\n\n# Summary\n\nSecond.`;
    const sections = chunkReportContent(md) as Record<string, any>;
    expect(sections['summary'].body).toBe('First.');
    expect(sections['summary_2'].body).toBe('Second.');
  });

  it('treats a report with no headings as a single chunk', () => {
    const sections = chunkReportContent('Just a paragraph of prose with no headings at all.') as Record<string, any>;
    const ids = Object.keys(sections);
    expect(ids).toHaveLength(1);
    expect(sections[ids[0]].body).toContain('prose');
  });
});

describe('markdownToPlainText', () => {
  it('converts list markers to bullets and strips emphasis', () => {
    expect(markdownToPlainText('- **Bold** item\n2. _second_ item')).toBe('• Bold item\n• second item');
  });

  it('drops horizontal rules, directives and citation markers', () => {
    expect(markdownToPlainText('Before [3]\n\n---\n\n{{timeline: a, b}}\n\nAfter')).toBe('Before\n\nAfter');
  });
});

describe('sample section data', () => {
  it('builds placeholder data for every contract section', () => {
    const contract = contractFromStructureTemplate({ id: 't', name: 'Guide', parsed_content: '# Alpha\n\n# Beta\n' });
    const sample = buildSampleSectionsData(contract);
    expect(Object.keys(sample)).toEqual(['alpha', 'beta']);
    expect(sample.alpha.title).toBe('Alpha');
    expect(sample.alpha.body).toContain('Alpha');
    expect(sample.alpha.highlights).toHaveLength(2);
  });

  it('merges placeholders without overriding user-typed sample sections', () => {
    const contract = contractFromStructureTemplate({ id: 't', name: 'Guide', parsed_content: '# Alpha\n\n# Beta\n' });
    const merged = withSampleSectionData({ property: { address: '1 Test St' }, sections: { alpha: { body: 'mine' } } }, contract);
    expect(merged.sections.alpha.body).toBe('mine');
    expect(merged.sections.beta.title).toBe('Beta');
    expect(merged.property.address).toBe('1 Test St');
  });

  it('is a no-op when the contract has no sections', () => {
    const data = { property: {} };
    expect(withSampleSectionData(data, { version: 1, sections: [] })).toBe(data);
  });
});

describe('stripHeadingNumbering', () => {
  it('strips common numbering prefixes', () => {
    expect(stripHeadingNumbering('5. Infrastructure & Amenities')).toBe('Infrastructure & Amenities');
    expect(stripHeadingNumbering('Section 2: Financials')).toBe('Financials');
    expect(stripHeadingNumbering('3) Overview')).toBe('Overview');
    expect(stripHeadingNumbering('7.2 Sub-market detail')).toBe('Sub-market detail');
    expect(stripHeadingNumbering('Plain Heading')).toBe('Plain Heading');
  });
});
