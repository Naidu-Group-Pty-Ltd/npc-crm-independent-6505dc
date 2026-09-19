import { describe, expect, it } from 'vitest';
import { getInlineGlyph, OpenAIGlyph } from '@/components/integrations/brandGlyphs';
import { getBrandProfile, getLocalBrandAsset, isFullColorLocalAsset } from './brandProfiles';

describe('brand registry lookups', () => {
  it('returns registered brand assets', () => {
    expect(getBrandProfile('openai')).toMatchObject({ slug: 'openai', color: '10A37F' });
    expect(getInlineGlyph('openai')).toBe(OpenAIGlyph);
  });

  it.each(['gamma', 'landchecker', 'clicksend', 'cloudconvert', 'greenid'])(
    'renders the recovered %s SVG as an image rather than a solid mask',
    (id) => {
      expect(getLocalBrandAsset(id)).toBeTruthy();
      expect(isFullColorLocalAsset(id)).toBe(true);
    },
  );

  it('uses the fallback icon library for Postmark', () => {
    expect(getBrandProfile('postmark')).toMatchObject({ svgOrgSlug: 'postmark' });
    expect(getLocalBrandAsset('postmark')).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'rejects inherited object property %s',
    (id) => {
      expect(getBrandProfile(id)).toBeUndefined();
      expect(getInlineGlyph(id)).toBeUndefined();
    },
  );
});
