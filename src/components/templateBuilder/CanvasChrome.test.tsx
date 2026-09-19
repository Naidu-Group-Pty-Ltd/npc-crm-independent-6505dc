import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CanvasChrome } from './CanvasChrome';
import type { Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

const canvas: NonNullable<ReportTemplate['canvas']> = {
  gridSize: 8,
  showGrid: false,
  showRulers: false,
  snapToGrid: false,
  showBleed: false,
  showSafeArea: false,
  showBaselineGrid: true,
};

function renderWithBaselineColor(color: string): string {
  const page = {
    id: 'page-1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [],
    baselineGrid: { size: 12, color, show: true, offset: 0 },
  } as Page;

  return renderToStaticMarkup(
    <CanvasChrome page={page} canvas={canvas} onChangeCanvas={vi.fn()} />,
  );
}

describe('CanvasChrome baseline grid', () => {
  it('normalises valid colors before placing them in the gradient', () => {
    const html = renderWithBaselineColor('rgba(191, 155, 80, 0.2)');

    expect(html).toContain('#BF9B5033');
  });

  it('replaces CSS image injection payloads with the safe default color', () => {
    const payload = 'red 11px), url("https://attacker.example/pixel")/*';
    const html = renderWithBaselineColor(payload);

    expect(html).not.toContain('attacker.example');
    expect(html).toContain('#BF9B504D');
  });
});
