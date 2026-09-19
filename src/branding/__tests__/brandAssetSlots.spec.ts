/**
 * The logo an admin previews must be the logo the client receives.
 *
 * There are now two resolvers for the report slots: `getBrandAssetSrc` in the
 * app, and `resolveReportAsset` in the render layer — which has to be separate
 * because Edge Functions cannot import from `src/`, and which additionally
 * enforces the inline policy. Two resolvers is one more than one, so the
 * fallback chains are asserted to agree here.
 *
 * The precedent for why: `compassSectionRegistry.ts` is mirrored by hand into
 * `src/lib/reports/` and `_shared/`, documented as "must stay in sync", and is
 * now 672 lines against 174.
 */
import { describe, expect, it } from 'vitest';
import { getBrandAssetSrc, type BrandAssetSlot } from '../brand-assets';
import { defaultBrandConfig, defaultBrandLogoConfig } from '../brand-defaults';
import { ASSET_FALLBACK, type BrandLogoKey } from '@/lib/reportDesign/assets.pure';

/** `logo_config` key → the flat `BrandConfig` field the app resolver reads. */
const KEY_TO_FIELD: Record<Exclude<BrandLogoKey, 'cover'>, keyof typeof defaultBrandConfig> = {
  report: 'reportLogo',
  reportMono: 'reportMonoLogo',
  sidebar: 'sidebarLogo',
  auth: 'authLogo',
  sidebarIcon: 'sidebarIcon',
};

const blank = () => ({ ...defaultBrandConfig });

describe('report slots exist end to end', () => {
  it('logo_config carries both report keys', () => {
    expect(defaultBrandLogoConfig).toHaveProperty('report');
    expect(defaultBrandLogoConfig).toHaveProperty('reportMono');
  });

  it('BrandConfig carries both flat fields', () => {
    expect(defaultBrandConfig).toHaveProperty('reportLogo');
    expect(defaultBrandConfig).toHaveProperty('reportMonoLogo');
  });

  it('every slot resolves to null on a blank config rather than throwing', () => {
    const slots: BrandAssetSlot[] = [
      'auth', 'sidebar', 'sidebar-icon', 'favicon', 'report', 'report-mono',
    ];
    for (const slot of slots) expect(getBrandAssetSrc(blank(), slot)).toBeNull();
  });
});

describe('the two resolvers agree on the report fallback chains', () => {
  describe.each([
    ['report', 'report'],
    ['report-mono', 'report-mono'],
  ] as const)('%s', (appSlot, renderSlot) => {
    const chain = ASSET_FALLBACK[renderSlot];

    it.each(chain.map((key, i) => [i, key]))(
      'position %i resolves to the %s asset when it is the only one set',
      (_i, key) => {
        const settings = blank();
        const field = KEY_TO_FIELD[key as Exclude<BrandLogoKey, 'cover'>];
        (settings as Record<string, unknown>)[field] = `data:image/png;base64,${key}`;
        expect(getBrandAssetSrc(settings, appSlot)).toBe(`data:image/png;base64,${key}`);
      },
    );

    it('prefers the earlier key when several are set', () => {
      const settings = blank();
      for (const key of chain) {
        const field = KEY_TO_FIELD[key as Exclude<BrandLogoKey, 'cover'>];
        (settings as Record<string, unknown>)[field] = `data:image/png;base64,${key}`;
      }
      expect(getBrandAssetSrc(settings, appSlot)).toBe(`data:image/png;base64,${chain[0]}`);
    });

    it('walks the chain in exactly the render layer\'s order', () => {
      // Drop keys one at a time from the front; each drop must reveal the next
      // key in the render layer's chain.
      for (let start = 0; start < chain.length; start += 1) {
        const settings = blank();
        for (const key of chain.slice(start)) {
          const field = KEY_TO_FIELD[key as Exclude<BrandLogoKey, 'cover'>];
          (settings as Record<string, unknown>)[field] = `data:image/png;base64,${key}`;
        }
        expect(getBrandAssetSrc(settings, appSlot)).toBe(`data:image/png;base64,${chain[start]}`);
      }
    });
  });

  it('never resolves a knockout mark onto paper', () => {
    // White-on-ivory is invisible; the reverse usually survives.
    const settings = blank();
    settings.reportMonoLogo = 'data:image/png;base64,mono';
    expect(getBrandAssetSrc(settings, 'report')).toBeNull();
  });
});

describe('existing slots are unchanged', () => {
  it('auth still falls back to sidebar then icon', () => {
    const settings = blank();
    settings.sidebarLogo = 'sidebar';
    expect(getBrandAssetSrc(settings, 'auth')).toBe('sidebar');
  });

  it('a report mark does not leak into a UI slot', () => {
    const settings = blank();
    settings.reportLogo = 'report';
    for (const slot of ['auth', 'sidebar', 'sidebar-icon', 'favicon'] as BrandAssetSlot[]) {
      expect(getBrandAssetSrc(settings, slot)).toBeNull();
    }
  });
});
