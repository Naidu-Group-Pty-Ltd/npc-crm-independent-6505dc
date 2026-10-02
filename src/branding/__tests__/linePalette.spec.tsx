/**
 * The dashboard draws the NPC property dashboard's palette (`linePalette.ts`).
 *
 * Everything here is something a cascade can undo without anything failing:
 * `BrandProvider.tsx` and `WhiteLabel.tsx` are the prime's files too, and the
 * prime's copies resolve the theme from the stored row alone. This
 * deployment's row is empty, so their copies draw the platform gold.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandProvider, useBrand } from '../BrandProvider';
import { defaultBrandConfig } from '../brand-defaults';
import { LINE_PALETTE, withLinePalette } from '../linePalette';
import { resolveBrandTokens } from '../token-resolver';
import type { BrandConfig } from '../brand-types';

/** What `.single()` reads back: no row, as on this deployment, or a stored one. */
const table = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (name: string) => {
      if (name !== 'whitelabel_settings') throw new Error(`Unexpected table ${name}`);
      return {
        select: () => ({
          limit: () => ({
            // PostgREST's answer to `.single()` over an empty table.
            single: async () =>
              table.row
                ? { data: table.row, error: null }
                : {
                    data: null,
                    error: {
                      code: 'PGRST116',
                      details: 'The result contains 0 rows',
                      hint: null,
                      message: 'JSON object requested, multiple (or no) rows returned',
                    },
                  },
          }),
        }),
      };
    },
  },
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async () => ({ data: null, error: { message: 'not used here', status: 503 } }),
}));

vi.mock('@/hooks/useAuthenticatedSupabase', () => ({
  useAuthenticatedSupabase: () => ({ supabase: {}, isAuthenticated: false, userId: null }),
}));

const UNSET: unknown[] = [null, undefined, '', '   ', 'not a colour', 42, {}];

describe('withLinePalette', () => {
  it('is the palette the prime stores', () => {
    expect(LINE_PALETTE).toEqual({
      primaryColor: '228 94% 45%',
      accentColor: '296 100% 44%',
      brandColor: '258 98% 48%',
    });
  });

  it('fills every colour the deployment has not stored', () => {
    for (const unset of UNSET) {
      const config = {
        ...defaultBrandConfig,
        primaryColor: unset,
        accentColor: unset,
        brandColor: unset,
      } as unknown as BrandConfig;

      expect(withLinePalette(config)).toMatchObject(LINE_PALETTE);
    }
  });

  it('never overrides a colour the deployment stored, and fills field by field', () => {
    const drawn = withLinePalette({ ...defaultBrandConfig, primaryColor: '210.4 80% 50%' });

    expect(drawn.primaryColor).toBe('210.4 80% 50%');
    expect(drawn.accentColor).toBe(LINE_PALETTE.accentColor);
    expect(drawn.brandColor).toBe(LINE_PALETTE.brandColor);
  });

  it('returns a copy and leaves everything else as it was', () => {
    const stored: BrandConfig = { ...defaultBrandConfig, companyName: 'Stored Name', sidebarLogo: 'logo.png' };
    const before = structuredClone(stored);
    const drawn = withLinePalette(stored);

    expect(stored).toEqual(before);
    expect(drawn).not.toBe(stored);
    expect(drawn).toEqual({ ...stored, ...LINE_PALETTE });
  });

  it("resolves the prime's tokens, and moves no surface or semantic colour", () => {
    const tokens = resolveBrandTokens(withLinePalette(defaultBrandConfig));
    const platform = resolveBrandTokens(defaultBrandConfig);

    for (const theme of ['light', 'dark'] as const) {
      expect(tokens[theme]['--primary']).toBe('228 94% 45%');
      expect(tokens[theme]['--sidebar-primary']).toBe('228 94% 45%');
      expect(tokens[theme]['--dashboard-primary-strong']).toBe('228 94% 45%');
      expect(tokens[theme]['--accent']).toBe('296 100% 44%');
      expect(tokens[theme]['--brand']).toBe('258 98% 48%');
      // The gold the prime still draws (group labels, the start of the active
      // item) is the warning token, which no brand moves.
      expect(tokens[theme]['--warning']).toBe(platform[theme]['--warning']);
      expect(tokens[theme]['--background']).toBe(platform[theme]['--background']);
      expect(tokens[theme]['--card']).toBe(platform[theme]['--card']);
    }
    expect(tokens.dark['--dashboard-primary-soft']).toBe('228 94% 10%');
  });
});

function Probe() {
  const { settings, isLoading } = useBrand();
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="stored-primary">{String(settings.primaryColor)}</p>
      <p data-testid="stored-brand">{String(settings.brandColor)}</p>
    </div>
  );
}

async function renderProvider(theme: 'light' | 'dark') {
  localStorage.setItem('theme', theme);
  render(
    <BrandProvider>
      <Probe />
    </BrandProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  return document.documentElement.style;
}

describe('BrandProvider on this deployment', () => {
  beforeEach(() => {
    table.row = null;
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.head.innerHTML = '';
  });

  it('draws the line palette over an empty white-label table, in the dark theme', async () => {
    const style = await renderProvider('dark');

    expect(document.documentElement).toHaveClass('dark');
    expect(style.getPropertyValue('--primary')).toBe('228 94% 45%');
    expect(style.getPropertyValue('--sidebar-primary')).toBe('228 94% 45%');
    expect(style.getPropertyValue('--accent')).toBe('296 100% 44%');
    expect(style.getPropertyValue('--brand')).toBe('258 98% 48%');
    expect(style.getPropertyValue('--background')).toBe('0 0% 4%');
  });

  it('draws it in the light theme too', async () => {
    const style = await renderProvider('light');

    expect(document.documentElement).not.toHaveClass('dark');
    expect(style.getPropertyValue('--primary')).toBe('228 94% 45%');
    expect(style.getPropertyValue('--accent')).toBe('296 100% 44%');
    expect(style.getPropertyValue('--background')).toBe('42 54% 96%');
  });

  it('leaves settings as stored, because documents read them', async () => {
    await renderProvider('dark');

    expect(screen.getByTestId('stored-primary')).toHaveTextContent('null');
    expect(screen.getByTestId('stored-brand')).toHaveTextContent('null');
  });

  it('lets a colour saved on the White Label page win', async () => {
    table.row = { id: 'row-1', primary_color: '0 84% 60%', theme_version: 1 };
    const style = await renderProvider('dark');

    await waitFor(() => expect(style.getPropertyValue('--primary')).toBe('0 84% 60%'));
    expect(style.getPropertyValue('--accent')).toBe('296 100% 44%');
    expect(style.getPropertyValue('--brand')).toBe('258 98% 48%');
  });
});

describe('the White Label page shows what the dashboard draws', () => {
  const source = readFileSync(resolve(__dirname, '../../pages/WhiteLabel.tsx'), 'utf8');

  it('previews and checks the draft through the line palette', () => {
    expect(source).toContain('withLinePalette(draftSettings)');
    expect(source).toContain('<BrandPreviewShowcase settings={effectiveDraft} />');
    expect(source).toContain('getBrandAccessibilityChecks(effectiveDraft)');
  });

  it('never offers the platform gold as the colour of an unset field', () => {
    expect(source).not.toMatch(/#D4A017|43 74% 49%/i);
  });
});
