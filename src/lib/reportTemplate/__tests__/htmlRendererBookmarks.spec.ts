import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';

const BOOKMARKED_TEMPLATE = {
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'page-1',
    name: 'Private page',
    size: { width: 595, height: 842 },
    blocks: [{
      id: 'heading-1',
      type: 'heading',
      props: { text: 'Private section' },
      bookmark: { name: 'private_section', label: 'Private Outline Label', level: 1 },
      overlays: [],
    }],
  }],
};

describe('HTML renderer bookmark output', () => {
  it('emits PDF outline metadata by default', () => {
    const { html } = renderTemplateToHtml(BOOKMARKED_TEMPLATE, { data: {} });

    expect(html).toContain('id="anc-private_section"');
    expect(html).toContain('bookmark-label:&#39;Private Outline Label&#39;');
    expect(html).toContain('bookmark-level:1');
  });

  it('omits PDF outline metadata when bookmarks are disabled while preserving the anchor', () => {
    const { html } = renderTemplateToHtml(BOOKMARKED_TEMPLATE, { data: {}, includeBookmarks: false });

    expect(html).toContain('id="anc-private_section"');
    expect(html).not.toContain('bookmark-label');
    expect(html).not.toContain('bookmark-level');
  });
});
