import { describe, expect, it } from 'vitest';
import { renderOverlay } from '../blocks/_shared.html';

const context = {
  data: {},
  tokens: { colors: {}, fonts: {}, spacing: {} },
  page: { width: 595, height: 842 },
  pageIndex: 0,
};

function renderWithRule(rule: Record<string, unknown>): string {
  return renderOverlay({
    id: 'security-table',
    type: 'table',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    columns: [{ key: 'name', label: 'Name' }],
    rows: [['Example']],
    cellRules: [{ column: 'name', op: 'nonempty', ...rule }],
  } as any, context);
}

describe('table conditional cell rule security', () => {
  it('normalises valid conditional colours', () => {
    const html = renderWithRule({ bg: 'rgb(20, 40, 60)', color: 'white' });

    expect(html).toContain('background:#14283c;color:#ffffff');
  });

  it('rejects attribute-breaking conditional colours', () => {
    const payload = `red;\"><img src=x onerror=\"document.body.dataset.xss='executed'\">`;
    const html = renderWithRule({ bg: payload, color: payload });

    expect(html).toContain('background:transparent;color:#111');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain(payload);
  });
});
