import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

const templateWithGradient = (color: string) => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'page-1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {
      gradient: {
        type: 'linear',
        angle: 180,
        stops: [{ color, position: 0 }, { color: 'transparent', position: 100 }],
      },
    },
    blocks: [],
  }],
});

describe('gradient rendering security', () => {
  it('preserves supported hex and transparent gradient stops', () => {
    const template = parseTemplate(templateWithGradient('#00000080'));
    const { html } = renderTemplateToHtml(template, { data: {} });

    expect(html).toContain('linear-gradient(180deg, #00000080 0%, transparent 100%)');
  });

  it('rejects gradient stop colors that could break out of the style attribute', () => {
    const payload = '#000\"><img src=x onerror=\"globalThis.__gradientXss=1\">';

    expect(() => parseTemplate(templateWithGradient(payload))).toThrow(
      'Gradient stops must be a hex color or transparent',
    );
    expect(() => renderTemplateToHtml(templateWithGradient(payload) as never, { data: {} })).toThrow();
  });
});
