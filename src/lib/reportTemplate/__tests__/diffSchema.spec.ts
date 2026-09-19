import { describe, it, expect } from 'vitest';
import { diffTemplates, summariseDiff } from '../diffSchema';
import type { ReportTemplate } from '../templateSchema';

const mk = (pages: any[], tokens: any = {}): ReportTemplate =>
  ({ version: 1, tokens, pages } as any);

describe('diffTemplates', () => {
  it('detects added pages and blocks', () => {
    const a = mk([{ id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text' }] }]);
    const b = mk([
      { id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text' }, { id: 'b2', type: 'image' }] },
      { id: 'p2', title: 'B', blocks: [] },
    ]);
    const d = diffTemplates(a, b);
    expect(d.summary.pagesAdded).toBe(1);
    expect(d.summary.blocksAdded).toBe(1);
    expect(summariseDiff(d)).toContain('+1 pages');
  });

  it('detects modified block fields', () => {
    const a = mk([{ id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text', props: { content: 'old' } }] }]);
    const b = mk([{ id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text', props: { content: 'new' } }] }]);
    const d = diffTemplates(a, b);
    expect(d.summary.blocksModified).toBe(1);
    expect(d.pages[0].blocks[0].changes[0].path).toBe('props.content');
  });

  it('detects token changes', () => {
    const a = mk([], { colors: { primary: '#000' } });
    const b = mk([], { colors: { primary: '#fff' } });
    const d = diffTemplates(a, b);
    expect(d.summary.tokenChanges).toBe(1);
  });

  it('ignores reordered keys', () => {
    const a = mk([{ id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text', props: { a: 1, b: 2 } }] }]);
    const b = mk([{ id: 'p1', title: 'A', blocks: [{ id: 'b1', type: 'text', props: { b: 2, a: 1 } }] }]);
    const d = diffTemplates(a, b);
    expect(d.summary.blocksModified).toBe(0);
  });
});
