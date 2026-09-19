import { describe, expect, it } from 'vitest';
import { renderOverlay } from '../blocks/_shared.html';
import type { Overlay } from '../templateSchema';

const context = { data: {}, tokens: { colors: {}, fonts: {}, spacing: {} } } as any;

function shapeWithShadow(color: string): Overlay {
  return {
    id: 'shape-with-shadow',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    effects: {
      shadow: { x: 0, y: 2, blur: 8, spread: 0, color },
    },
  } as unknown as Overlay;
}

describe('overlay effect HTML rendering', () => {
  it('preserves valid shadow colours', () => {
    const html = renderOverlay(shapeWithShadow('rgba(0,0,0,0.25)'), context);

    expect(html).toContain('box-shadow:0pt 2pt 8pt 0pt rgba(0,0,0,0.25)');
  });

  it('encodes shadow colours before inserting them into a style attribute', () => {
    const html = renderOverlay(
      shapeWithShadow('red\"><script>window.__overlayXss = true</script>'),
      context,
    );
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(html).not.toContain('<script>');
    expect(html).toContain('red&quot;&gt;&lt;script&gt;');
    expect(document.scripts).toHaveLength(0);
    expect(document.body.children).toHaveLength(1);
  });
});
