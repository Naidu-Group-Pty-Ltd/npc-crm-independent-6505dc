import { describe, expect, it } from 'vitest';

import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate, type ReportTemplate } from '../templateSchema';

function templateWithTheme(theme: Record<string, unknown>, pageTheme = false): ReportTemplate {
  return parseTemplate({
    id: 'theme-security',
    name: 'Theme security',
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    themes: {
      hostile: { id: 'hostile', name: 'Hostile', tokens: theme },
    },
    activeThemeId: pageTheme ? undefined : 'hostile',
    pages: [{
      id: 'page-1',
      name: 'Page 1',
      themeId: pageTheme ? 'hostile' : undefined,
      size: { width: 595, height: 842 },
      background: {},
      blocks: [],
    }],
  }) as ReportTemplate;
}

describe('theme CSS security', () => {
  it.each([false, true])('omits breakout and resource-bearing values (page theme: %s)', (pageTheme) => {
    const { html, css } = renderTemplateToHtml(templateWithTheme({
      colors: { primary: '#000; background: url(http://127.0.0.1/private)' },
      shadows: { card: '#fff; }</style><img src="http://127.0.0.1/private"><style>' },
    }, pageTheme));

    expect(css).not.toContain('127.0.0.1');
    expect(html).not.toContain('127.0.0.1');
    expect(html).not.toContain('<img src=');
  });

  it('preserves safe active and per-page theme values', () => {
    const active = renderTemplateToHtml(templateWithTheme({
      colors: { primary: '#123456' },
      gradients: { hero: 'linear-gradient(90deg, #123456, rgb(1, 2, 3))' },
    }));
    const page = renderTemplateToHtml(templateWithTheme({ fonts: { body: 'Inter, sans-serif' } }, true));

    expect(active.css).toContain('--color-primary: #123456;');
    expect(active.css).toContain('--gradient-hero: linear-gradient(90deg, #123456, rgb(1, 2, 3));');
    expect(page.css).toContain('--font-body: Inter, sans-serif;');
  });
});
