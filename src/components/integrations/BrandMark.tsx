import { useEffect, useState, type ReactNode } from 'react';
import {
  brandLogoUrl,
  getBrandMonogram,
  getBrandProfile,
  getLocalBrandAsset,
  isFullColorLocalAsset,
  resolveBrandMarkHex,
  svgOrgLogoUrl,
} from '@/lib/integrations/brandProfiles';
import { getInlineGlyph } from './brandGlyphs';



/**
 * Reads dark mode straight off the `dark` class the theme provider toggles on
 * <html>, so brand marks stay provider-independent (and safe to render in
 * isolated tests/previews).
 */
function useIsDarkSurface(): boolean {
  const read = () =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const [isDark, setIsDark] = useState(read);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const target = document.documentElement;
    const sync = () => setIsDark(target.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface BrandMarkProps {
  integrationId: string;
  /** Fallback lucide (or arbitrary) node when no brand asset is available */
  fallback: ReactNode;
  /** Rendered SVG size in px */
  size?: number;
  className?: string;
}

/**
 * Renders the brand's mark in its official color.
 * Priority: inline SVG (for brands Simple Icons dropped for trademark reasons)
 *   → Simple Icons CDN (tinted server-side via the colored CDN path)
 *   → locally vendored mark harvested from the vendor's own site (tinted via
 *     CSS mask, for brands neither icon library carries)
 *   → thesvg.org CDN (fallback brand library, tinted client-side via CSS mask
 *     so it matches the Simple Icons treatment)
 *   → provided lucide fallback.
 *
 * Near-black marks resolve to a light tint in dark mode (every source).
 */
export function BrandMark({ integrationId, fallback, size = 24, className }: BrandMarkProps) {
  const profile = getBrandProfile(integrationId);
  const isDark = useIsDarkSurface();
  const [simpleIconsFailed, setSimpleIconsFailed] = useState(false);
  const [svgOrgFailed, setSvgOrgFailed] = useState(false);

  const markHex = profile ? resolveBrandMarkHex(profile.color, isDark) : undefined;

  const Inline = getInlineGlyph(integrationId);

  const useSimpleIcons = !Inline && Boolean(profile?.slug) && !simpleIconsFailed;
  const localSrc = !Inline && !useSimpleIcons && profile ? getLocalBrandAsset(integrationId) : undefined;
  const useSvgOrg = !Inline && !useSimpleIcons && !localSrc && Boolean(profile?.svgOrgSlug) && !svgOrgFailed;
  const svgOrgSrc = useSvgOrg ? svgOrgLogoUrl(profile!.svgOrgSlug!) : null;

  // The masked render can't surface a load error, so probe the remote fallback
  // asset before painting it and drop to the lucide fallback when it 404s.
  const [svgOrgReady, setSvgOrgReady] = useState(false);
  useEffect(() => {
    if (!svgOrgSrc) {
      setSvgOrgReady(false);
      return;
    }
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => !cancelled && setSvgOrgReady(true);
    probe.onerror = () => !cancelled && setSvgOrgFailed(true);
    probe.src = svgOrgSrc;
    return () => {
      cancelled = true;
    };
  }, [svgOrgSrc]);

  // CSS mask keeps the glyph shape while forcing the resolved brand hex,
  // matching how Simple Icons marks are tinted.
  const maskedMark = (src: string) => (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: `#${markHex}`,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  );

  if (Inline) {
    return <Inline size={size} color={markHex ? `#${markHex}` : undefined} className={className} />;
  }

  if (useSimpleIcons) {
    const src = brandLogoUrl(profile!.slug!, markHex!);
    return (
      <img
        key={src}
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setSimpleIconsFailed(true)}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }

  if (localSrc) {
    // Full-colour badges (filled tiles / multi-tone marks) must not be masked —
    // masking would flatten them into a solid brand-coloured square.
    if (isFullColorLocalAsset(integrationId)) {
      return (
        <img
          src={localSrc}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className={className}
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      );
    }
    return maskedMark(localSrc);
  }

  if (svgOrgSrc && svgOrgReady) {
    return maskedMark(svgOrgSrc);
  }

  const monogram = getBrandMonogram(integrationId);
  if (monogram && markHex) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: Math.max(4, size * 0.22),
          backgroundColor: `#${markHex}1F`,
          color: `#${markHex}`,
          fontSize: size * 0.46,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {monogram}
      </span>
    );
  }

  return <>{fallback}</>;

}

