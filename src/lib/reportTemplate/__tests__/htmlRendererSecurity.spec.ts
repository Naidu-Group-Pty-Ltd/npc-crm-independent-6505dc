import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

function renderShape(fill: string): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1',
      name: 'Page 1',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [{
        id: 'b1',
        type: 'free',
        props: {},
        overlays: [{
          id: 's1',
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill,
        }],
      }],
    }],
  });

  return renderTemplateToHtml(template, { data: {}, editorMode: false }).html;
}

function renderLinkedBlock(link: Record<string, unknown>, bookmark?: Record<string, unknown>): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      {
        id: 'p1', name: 'Page 1', size: { width: 595, height: 842 }, background: {},
        blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [], link, bookmark }],
      },
      { id: 'p2', name: 'Page 2', size: { width: 595, height: 842 }, background: {}, blocks: [] },
    ],
  });

  return renderTemplateToHtml(template, { data: {}, editorMode: false }).html;
}

describe('HTML renderer security', () => {
  it('excludes bookmarks from blocks that are not rendered', () => {
    const template = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p1', name: 'Page 1', size: { width: 595, height: 842 }, background: {},
        blocks: [
          { id: 'toc', type: 'auto-toc', props: {} },
          {
            id: 'hidden', type: 'text', props: { text: 'hidden body' }, hidden: true,
            bookmark: { name: 'hidden', label: 'AML review: {{aml.status}}' },
          },
          {
            id: 'conditional', type: 'text', props: { text: 'conditional body' }, conditional: 'showInternal',
            bookmark: { name: 'conditional', label: 'Risk flag: {{client.riskFlag}}' },
          },
          {
            id: 'visibility', type: 'text', props: { text: 'visibility body' },
            visibility: { mode: 'when', expr: 'showStaffNotes' },
            bookmark: { name: 'visibility', label: 'Staff note: {{client.staffNote}}' },
          },
          {
            id: 'visible', type: 'text', props: { text: 'visible body' },
            bookmark: { name: 'visible', label: 'Visible section' },
          },
        ],
      }],
    });

    const html = renderTemplateToHtml(template, {
      data: {
        aml: { status: 'PEP_REVIEW_REQUIRED' },
        client: { riskFlag: 'SUSPICIOUS_ACTIVITY', staffNote: 'DECLINE_CLIENT' },
        showInternal: false,
        showStaffNotes: false,
      },
    }).html;

    expect(html).toContain('Visible section');
    expect(html).not.toContain('PEP_REVIEW_REQUIRED');
    expect(html).not.toContain('SUSPICIOUS_ACTIVITY');
    expect(html).not.toContain('DECLINE_CLIENT');
  });

  it('preserves valid CSS gradient fills', () => {
    const gradient = 'linear-gradient(135deg, #0A2540 0%, #1A3A5A 100%)';

    expect(renderShape(gradient)).toContain(`background:${gradient}`);
  });

  it('escapes gradient fills before embedding them in a style attribute', () => {
    const html = renderShape('linear-gradient(red, blue)";><script>globalThis.pwned=true</script><div style="');

    expect(html).not.toContain('<script>globalThis.pwned=true</script>');
    expect(html).toContain('&quot;;&gt;&lt;script&gt;globalThis.pwned=true&lt;/script&gt;&lt;div style=&quot;');
  });

  it('rejects HTML and resource injection in baseline grid colors', () => {
    const payload = 'red\"><img src="http://127.0.0.1/internal">';
    const template = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p1',
        name: 'Page 1',
        size: { width: 595, height: 842 },
        background: {},
        baselineGrid: { size: 12, color: payload, show: true, offset: 0 },
        blocks: [],
      }],
    });

    const html = renderTemplateToHtml(template, { data: {}, editorMode: false }).html;

    expect(html).not.toContain(payload);
    expect(html).not.toContain('http://127.0.0.1/internal');
    expect(html).toContain('#BF9B5033 11pt, #BF9B5033 12pt');
  });
});
