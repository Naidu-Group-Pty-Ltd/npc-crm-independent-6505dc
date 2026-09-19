import { describe, expect, it } from 'vitest';
import { renderOverlay } from '../blocks/_shared.html';
import type { Overlay } from '../templateSchema';

const context = { data: {}, tokens: { colors: {}, fonts: {}, spacing: {} } };

function textOverlay(effects: unknown): Overlay {
  return {
    id: 'effect-overlay',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    content: 'Safe visible text',
    effects,
  } as Overlay;
}

describe('renderOverlay effect HTML safety', () => {
  it.each([
    {
      name: 'shadow color',
      effects: { shadow: { color: 'red\"><script>globalThis.__NPC_POC=1</script><div style="' } },
    },
    {
      name: 'outline color',
      effects: {
        outline: {
          width: 1,
          style: 'solid',
          color: '#fff\"><img src=x onerror="globalThis.__NPC_POC=1"><div style="',
        },
      },
    },
  ])('keeps a malicious $name inside the style attribute', ({ effects }) => {
    const html = renderOverlay(textOverlay(effects), context);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;');
    expect(html).toContain('Safe visible text');
  });

  it('preserves valid overlay effect CSS', () => {
    const html = renderOverlay(textOverlay({
      shadow: { x: 1, y: 2, blur: 3, spread: 4, color: 'rgba(0,0,0,0.25)' },
      outline: { width: 2, style: 'dashed', color: '#BF9B50', offset: 1 },
    }), context);

    expect(html).toContain('box-shadow:1pt 2pt 3pt 4pt rgba(0,0,0,0.25);');
    expect(html).toContain('outline:2pt dashed #BF9B50;outline-offset:1pt;');
  });
});
