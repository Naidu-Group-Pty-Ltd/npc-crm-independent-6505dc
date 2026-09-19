import { describe, expect, it } from 'vitest';
import { shouldRenderOverlay } from '../renderVisibility';

const ctx = { data: { include: true }, tokens: {} } as any;

describe('overlay export visibility', () => {
  it('suppresses hidden overlays before renderer-specific drawing', () => {
    expect(shouldRenderOverlay({ hidden: true } as any, ctx)).toBe(false);
  });

  it('preserves conditional visibility for non-hidden overlays', () => {
    expect(shouldRenderOverlay({ conditional: 'include' } as any, ctx)).toBe(true);
    expect(shouldRenderOverlay({ conditional: '!include' } as any, ctx)).toBe(false);
  });
});
