import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

const INJECTED_COLOR = '#f00"/><image href="http://127.0.0.1/ssrf-probe.png"/><rect fill="#0f0';

function renderChart(type: 'chart-bar' | 'chart-donut' | 'chart-stacked-bar' | 'legend', props: Record<string, unknown>): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1',
      name: 'Page 1',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [{ id: 'chart', type, props }],
    }],
  });

  return renderTemplateToHtml(template, { data: {}, editorMode: false }).html;
}

describe('chart HTML renderer security', () => {
  it.each(['chart-bar', 'chart-donut', 'legend'] as const)(
    'rejects injected item colors in %s',
    (type) => {
      const dataProp = type === 'legend' ? 'items' : 'data';
      const html = renderChart(type, {
        [dataProp]: [{ label: 'Safe label', value: 10, color: INJECTED_COLOR }],
      });

      expect(html).not.toContain('<image');
      expect(html).not.toContain('ssrf-probe.png');
      expect(html).toContain('#BF9B50');
    },
  );

  it.each(['chart-bar', 'chart-donut', 'chart-stacked-bar', 'legend'] as const)(
    'rejects injected palette colors in %s',
    (type) => {
      const props = type === 'chart-stacked-bar'
        ? { data: [{ label: 'Safe label', amount: 10 }], stackKeys: ['amount'], palette: [INJECTED_COLOR] }
        : type === 'legend'
          ? { items: [{ label: 'Safe label' }], palette: [INJECTED_COLOR] }
          : { data: [{ label: 'Safe label', value: 10 }], palette: [INJECTED_COLOR] };
      const html = renderChart(type, props);

      expect(html).not.toContain('<image');
      expect(html).not.toContain('ssrf-probe.png');
      expect(html).toContain('#BF9B50');
    },
  );

  it('preserves valid item and palette colors', () => {
    expect(renderChart('chart-bar', {
      data: [{ label: 'Item', value: 10, color: 'rgb(20, 40, 60)' }],
    })).toContain('fill="#14283c"');
    expect(renderChart('chart-stacked-bar', {
      data: [{ label: 'Item', amount: 10 }],
      stackKeys: ['amount'],
      palette: ['hsl(210, 50%, 40%)'],
    })).toContain('fill="#336699"');
  });
});
