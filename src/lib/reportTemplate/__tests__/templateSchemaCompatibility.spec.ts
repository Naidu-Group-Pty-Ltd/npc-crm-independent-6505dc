import { describe, expect, it } from 'vitest';

import { parseTemplate } from '../templateSchema';

const makeTemplate = (tokenExtension: Record<string, unknown>) => ({
  version: 1,
  tokens: {
    colors: { primary: '#123456' },
    fonts: {},
    spacing: {},
    ...tokenExtension,
  },
  pages: [{ id: 'cover', name: 'Cover', blocks: [] }],
  slots: {},
});

describe('template token extension compatibility', () => {
  it.each([
    ['radii with CSS units', { radii: { sm: '4px' } }, 'radii'],
    ['an empty brand kit ID', { brandKitId: '' }, 'brandKitId'],
    ['an unknown active theme', { activeTheme: 'sepia' }, 'activeTheme'],
  ])('preserves the template while ignoring %s', (_label, extension, key) => {
    const parsed = parseTemplate(makeTemplate(extension));

    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0].id).toBe('cover');
    expect(parsed.tokens.colors.primary).toBe('#123456');
    expect(parsed.tokens).not.toHaveProperty(key);
  });

  it('continues to preserve valid token extensions', () => {
    const parsed = parseTemplate(makeTemplate({
      radii: { sm: 4 },
      brandKitId: 'a03f3f3e-7780-4f6f-9327-bb127a4f7012',
      activeTheme: 'dark',
    }));

    expect(parsed.tokens.radii).toEqual({ sm: 4 });
    expect(parsed.tokens.brandKitId).toBe('a03f3f3e-7780-4f6f-9327-bb127a4f7012');
    expect(parsed.tokens.activeTheme).toBe('dark');
  });
});
