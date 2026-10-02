import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { Json } from '@/integrations/supabase/types';
import {
  BRAND_THEME_STORAGE_KEY,
  defaultBrandConfig,
  defaultEmailSignature,
  defaultBrandLogoConfig,
  defaultBrandThemeConfig,
} from './brand-defaults';
import { getBrandAssetSrc } from './brand-assets';
import { appleTouchIconFor, faviconFor } from './platformBrand';
import { setBrandNotificationIcon } from '@/lib/desktopMessageAlerts';
import { applyBrandTokenMap, resolveBrandFontVars, resolveBrandTokens } from './token-resolver';
import type { BrandContextValue, BrandLogoConfig, BrandSaveResult, BrandThemeConfig, EmailSignatureSettings, ThemeMode, WhiteLabelSettings } from './brand-types';

const BrandContext = createContext<BrandContextValue | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * `localStorage` is not always readable: Safari's private mode, "block all
 * cookies", enterprise policy and some extensions make the *property access*
 * itself throw. This one is read from a `useState` initialiser (i.e. during
 * render) and written from an effect, so an unguarded throw here took down the
 * entire application — including the sign-in page, which nothing else on it
 * needs storage for. A remembered theme is a preference; losing it is not worth
 * a blank page.
 */
function readStoredTheme(): ThemeMode | null {
  try {
    return localStorage.getItem(BRAND_THEME_STORAGE_KEY) as ThemeMode | null;
  } catch {
    return null;
  }
}

function writeStoredTheme(themeMode: ThemeMode): void {
  try {
    localStorage.setItem(BRAND_THEME_STORAGE_KEY, themeMode);
  } catch { /* preference not persisted — not fatal */ }
}

function getInitialThemeMode(defaultTheme: ThemeMode): ThemeMode {
  if (typeof window === 'undefined') return defaultTheme;
  return readStoredTheme() || defaultTheme;
}

function mergeThemeConfig(themeConfig: Partial<BrandThemeConfig> | null | undefined): BrandThemeConfig {
  return {
    ...defaultBrandThemeConfig,
    ...themeConfig,
    emailSignature: {
      ...defaultEmailSignature,
      ...(themeConfig?.emailSignature || {}),
    },
  };
}

function mergeLogoConfig(logoConfig: Partial<BrandLogoConfig> | null | undefined): BrandLogoConfig {
  return {
    ...defaultBrandLogoConfig,
    ...logoConfig,
  };
}

function buildStructuredConfig(settings: WhiteLabelSettings) {
  const themeConfig: BrandThemeConfig = mergeThemeConfig({
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    brandColor: settings.brandColor,
    fontFamily: settings.fontFamily,
    headingFontFamily: settings.headingFontFamily,
    fontScale: settings.fontScale,
    darkModeDefault: settings.darkModeDefault,
    emailSignature: settings.emailSignature,
  });

  const logoConfig: BrandLogoConfig = mergeLogoConfig({
    auth: settings.authLogo,
    sidebar: settings.sidebarLogo,
    sidebarIcon: settings.sidebarIcon,
    favicon: settings.favicon,
    report: settings.reportLogo,
    reportMono: settings.reportMonoLogo,
  });

  return {
    themeConfig,
    logoConfig,
    themeVersion: settings.themeVersion ?? 1,
  };
}

function mapDatabaseSettings(data: Record<string, unknown>): WhiteLabelSettings {
  const rawThemeConfig = (data.theme_config as Partial<BrandThemeConfig> | null | undefined) ?? null;
  const rawLogoConfig = (data.logo_config as Partial<BrandLogoConfig> | null | undefined) ?? null;

  // Backward compatibility: prefer raw structured values, otherwise fall back to legacy
  // flat columns. This guarantees presets saved before theme_version=2 keep rendering
  // exactly as they did before the JSONB columns existed.
  const rawSig = (rawThemeConfig?.emailSignature ?? {}) as Partial<EmailSignatureSettings>;
  const emailSignature: EmailSignatureSettings = {
    banner: rawSig.banner ?? (data.email_signature_banner as string) ?? null,
    name: rawSig.name ?? (data.email_signature_name as string) ?? defaultEmailSignature.name,
    title: rawSig.title ?? (data.email_signature_title as string) ?? defaultEmailSignature.title,
    phone: rawSig.phone ?? (data.email_signature_phone as string) ?? '',
    email: rawSig.email ?? (data.email_signature_email as string) ?? '',
    website: rawSig.website ?? (data.email_signature_website as string) ?? '',
    address: rawSig.address ?? (data.email_signature_address as string) ?? '',
    disclaimer: rawSig.disclaimer ?? (data.email_signature_disclaimer as string) ?? defaultEmailSignature.disclaimer,
  };

  const themeConfig: BrandThemeConfig = {
    primaryColor: rawThemeConfig?.primaryColor ?? (data.primary_color as string) ?? null,
    accentColor: rawThemeConfig?.accentColor ?? (data.accent_color as string) ?? null,
    // New brand + typography inputs live only in the theme_config JSONB (no
    // legacy columns), so read them straight from the structured config.
    brandColor: rawThemeConfig?.brandColor ?? null,
    fontFamily: rawThemeConfig?.fontFamily ?? null,
    headingFontFamily: rawThemeConfig?.headingFontFamily ?? null,
    fontScale: rawThemeConfig?.fontScale ?? null,
    darkModeDefault:
      (rawThemeConfig?.darkModeDefault as ThemeMode | undefined) ??
      (data.dark_mode_default as ThemeMode) ??
      defaultBrandThemeConfig.darkModeDefault,
    emailSignature,
  };

  const logoConfig: BrandLogoConfig = {
    auth: rawLogoConfig?.auth ?? (data.auth_logo as string) ?? null,
    sidebar: rawLogoConfig?.sidebar ?? (data.sidebar_logo as string) ?? null,
    sidebarIcon: rawLogoConfig?.sidebarIcon ?? (data.sidebar_icon as string) ?? null,
    favicon: rawLogoConfig?.favicon ?? (data.favicon as string) ?? null,
    // Report marks live only in the JSONB — there is no legacy flat column, and
    // no `theme_version` gate: they are additive, so a tenant on version 1 keeps
    // saving without being forced to upload one.
    report: rawLogoConfig?.report ?? null,
    reportMono: rawLogoConfig?.reportMono ?? null,
  };

  return {
    id: data.id as string,
    authLogo: logoConfig.auth,
    sidebarLogo: logoConfig.sidebar,
    sidebarIcon: logoConfig.sidebarIcon,
    favicon: logoConfig.favicon,
    reportLogo: logoConfig.report,
    reportMonoLogo: logoConfig.reportMono,
    companyName: (data.company_name as string) || defaultBrandConfig.companyName,
    primaryColor: themeConfig.primaryColor,
    accentColor: themeConfig.accentColor,
    brandColor: themeConfig.brandColor,
    fontFamily: themeConfig.fontFamily,
    headingFontFamily: themeConfig.headingFontFamily,
    fontScale: themeConfig.fontScale,
    darkModeDefault: themeConfig.darkModeDefault,
    emailSignature,
    themeConfig,
    logoConfig,
    themeVersion: (data.theme_version as number) || 1,
  };
}

function applyResolvedTheme(themeMode: ThemeMode, resolvedTokens: ReturnType<typeof resolveBrandTokens>) {
  const resolvedTheme = themeMode === 'system' ? getSystemTheme() : themeMode;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  applyBrandTokenMap(resolvedTheme === 'dark' ? resolvedTokens.dark : resolvedTokens.light);
  return resolvedTheme;
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  // Branding is READ anonymously (login/portal pages before auth), but WRITES
  // must carry the staff JWT so the deny-by-default RLS (Phase 7) can gate
  // them to admins. Reads stay on the anon client below.
  const { supabase: authedSupabase, isAuthenticated } = useAuthenticatedSupabase();
  const [settings, setSettings] = useState<WhiteLabelSettings>(defaultBrandConfig);
  const [isLoading, setIsLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode(defaultBrandConfig.darkModeDefault));
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() =>
    themeMode === 'system' ? getSystemTheme() : themeMode
  );

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('whitelabel_settings')
          .select('*')
          .limit(1)
          .single();

        if (error) {
          console.error('Failed to fetch whitelabel settings:', error);
          return;
        }

        if (data) {
          const mapped = mapDatabaseSettings(data as Record<string, unknown>);
          setSettings(mapped);
          setThemeMode((prevTheme) => {
            if (typeof window === 'undefined') return mapped.darkModeDefault;
            const storedTheme = readStoredTheme();
            return storedTheme || prevTheme || mapped.darkModeDefault;
          });
        }
      } catch (error) {
        console.error('Failed to load whitelabel settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const resolvedTokens = useMemo(() => resolveBrandTokens(settings), [settings]);
  const resolvedFontVars = useMemo(() => resolveBrandFontVars(settings), [settings]);

  // Typography tokens are theme-agnostic, so apply them independently of the
  // light/dark colour cascade. This makes the White-Label font selection cascade
  // to every text component (body + headings + base size).
  useEffect(() => {
    applyBrandTokenMap(resolvedFontVars);
  }, [resolvedFontVars]);

  useEffect(() => {
    const applyTheme = (nextTheme: ThemeMode) => {
      const resolvedTheme = applyResolvedTheme(nextTheme, resolvedTokens);
      setCurrentTheme(resolvedTheme);
    };

    applyTheme(themeMode);
    writeStoredTheme(themeMode);

    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [resolvedTokens, themeMode]);

  /**
   * Desktop notifications carry a logo too, and it is the one place a stock
   * scaffold icon would surface outside the app — in the OS notification shade,
   * next to the browser's own name. Publish the tenant's mark (the same square
   * chain the favicon uses) so alerts are branded; passing `null` when nothing
   * is configured is what reverts them to the Aurixa Systems mark.
   */
  useEffect(() => {
    setBrandNotificationIcon(getBrandAssetSrc(settings, 'favicon'));
  }, [settings]);

  /**
   * The tab icon, and the one place a clone with no branding shows whose
   * platform it is.
   *
   * This used to `return` early when the tenant had no favicon, on the
   * reasoning that `index.html` already declares the platform mark. True on a
   * first load, and wrong the moment a tenant CLEARS their favicon: the href
   * written by the previous render stays on the element, so the tab kept
   * showing a mark the workspace no longer had until a full reload. Resolving
   * through `faviconFor` means an empty brand always paints the Aurixa mark
   * rather than whatever was there before.
   */
  useEffect(() => {
    const favicon = faviconFor(getBrandAssetSrc(settings, 'favicon'));
    const appleIcon = appleTouchIconFor(getBrandAssetSrc(settings, 'favicon'));

    // <link rel="icon">
    const iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (iconLink) {
      iconLink.href = favicon;
    } else {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = favicon;
      document.head.appendChild(newLink);
    }

    // <link rel="apple-touch-icon">
    const appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
    if (appleLink) {
      appleLink.href = appleIcon;
    } else {
      const newApple = document.createElement('link');
      newApple.rel = 'apple-touch-icon';
      newApple.href = appleIcon;
      document.head.appendChild(newApple);
    }
  }, [settings]);

  useEffect(() => {
    const company = settings.companyName?.trim();
    if (!company) return;

    const titleStr = `${company} Dashboard`;
    document.title = titleStr;

    const setMeta = (selector: string, attr: 'content' | 'href', value: string) => {
      const el = document.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
      if (el) el.setAttribute(attr, value);
    };

    const description = `${company} - Property investment management dashboard`;

    setMeta("meta[name='apple-mobile-web-app-title']", 'content', company);
    setMeta("meta[name='application-name']", 'content', company);
    setMeta("meta[name='description']", 'content', description);
    setMeta("meta[name='author']", 'content', company);
    setMeta("meta[property='og:title']", 'content', titleStr);
    setMeta("meta[property='og:description']", 'content', description);
    setMeta("meta[name='twitter:title']", 'content', company);

    const favicon = getBrandAssetSrc(settings, 'favicon');
    if (favicon) {
      setMeta("meta[property='og:image']", 'content', favicon);
      setMeta("meta[name='twitter:image']", 'content', favicon);
    }
  }, [settings]);

  /**
   * Read the live settings without making them a dependency of the save
   * callback. `updateSettings` must re-create whenever the Supabase client
   * changes (see below) but must NOT re-create on every settings edit.
   */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /**
   * Column payload shared by both write paths.
   * `null` is a meaningful value throughout: it is how "remove this asset" is
   * expressed, so nothing here may be pruned for falsiness.
   */
  const buildColumnPayload = useCallback((updated: WhiteLabelSettings) => {
    const structured = buildStructuredConfig(updated);
    return {
      auth_logo: updated.authLogo,
      sidebar_logo: updated.sidebarLogo,
      sidebar_icon: updated.sidebarIcon,
      favicon: updated.favicon,
      company_name: updated.companyName,
      primary_color: updated.primaryColor,
      accent_color: updated.accentColor,
      dark_mode_default: updated.darkModeDefault,
      email_signature_banner: updated.emailSignature.banner,
      email_signature_name: updated.emailSignature.name,
      email_signature_title: updated.emailSignature.title,
      email_signature_phone: updated.emailSignature.phone,
      email_signature_email: updated.emailSignature.email,
      email_signature_website: updated.emailSignature.website,
      email_signature_address: updated.emailSignature.address,
      email_signature_disclaimer: updated.emailSignature.disclaimer,
      theme_config: structured.themeConfig as unknown as Json,
      logo_config: structured.logoConfig as unknown as Json,
      theme_version: structured.themeVersion,
    };
  }, []);

  const persistSettings = useCallback(
    async (updated: WhiteLabelSettings): Promise<BrandSaveResult> => {
      const payload = buildColumnPayload(updated);

      /**
       * PRIMARY PATH — service-role mediated write authenticated by the HttpOnly
       * staff session cookie.
       *
       * The direct PostgREST write below depends on the tab-scoped RLS access
       * token, which is a *derived* artefact: it expires (or was never minted in
       * this tab) while the staff session cookie is still perfectly valid. That
       * is what produced "your sign-in session has no database token" on a
       * signed-in admin — the save was refused client-side before it ever
       * reached the database. The cookie is the durable identity, so it leads.
       */
      try {
        const { data, error } = await invokeSecureFunction('manage-branding', {
          operation: 'update',
          id: updated.id ?? undefined,
          data: payload,
        });

        if (!error && data?.success) {
          return { ok: true };
        }

        // A 403 is a real answer, not a transport problem: this account may read
        // branding but not change it. Surface it instead of retrying blindly.
        if (error?.status === 403) {
          return {
            ok: false,
            reason: 'not-persisted',
            message:
              error.message ||
              'This account does not have edit access to White Label branding.',
          };
        }

        console.warn('[branding] Mediated save unavailable, falling back to direct write:', error || data);
      } catch (mediatedError) {
        console.warn('[branding] Mediated save threw, falling back to direct write:', mediatedError);
      }

      /**
       * FALLBACK PATH — direct RLS write. Kept so branding stays editable if the
       * edge function is unreachable (not yet deployed, network blocked).
       */
      if (!updated.id) {
        return {
          ok: false,
          reason: 'error',
          message: 'Branding has not finished loading yet — try again in a moment.',
        };
      }

      if (!isAuthenticated) {
        return {
          ok: false,
          reason: 'unauthenticated',
          message:
            'Branding could not be saved because the secure save service did not respond and this tab has no database token. Reload the page and sign in again.',
        };
      }

      try {
        // `.select()` is what makes an RLS denial observable: without it,
        // PostgREST returns 200 and no rows, and `error` stays null.
        const { data, error } = await authedSupabase
          .from('whitelabel_settings')
          .update(payload)
          .eq('id', updated.id)
          .select('id');

        if (error) {
          console.error('Failed to save whitelabel settings:', error);
          return { ok: false, reason: 'error', message: error.message };
        }

        if (!data || data.length === 0) {
          console.error('Whitelabel settings update matched no rows — RLS denied the write.');
          return {
            ok: false,
            reason: 'not-persisted',
            message:
              'The database rejected the change. This account may not have edit access to White Label, or the session has expired — reload and sign in again.',
          };
        }

        return { ok: true };
      } catch (error) {
        console.error('Failed to save whitelabel settings:', error);
        return {
          ok: false,
          reason: 'error',
          message: error instanceof Error ? error.message : 'Unknown error saving branding.',
        };
      }
    },
    // The authenticated client is rebuilt when the RLS token arrives. Capturing
    // it once (the original `[]`) pinned an anonymous client for the life of the
    // page whenever the token had not yet been minted — every save after that
    // silently no-opped.
    [authedSupabase, buildColumnPayload, isAuthenticated],
  );

  const updateSettings = useCallback(
    async (newSettings: Partial<WhiteLabelSettings>): Promise<BrandSaveResult> => {
      const prev = settingsRef.current;
      const updated: WhiteLabelSettings = {
        ...prev,
        ...newSettings,
        emailSignature: {
          ...prev.emailSignature,
          ...(newSettings.emailSignature || {}),
        },
      };
      const structured = buildStructuredConfig(updated);
      updated.themeConfig = structured.themeConfig;
      updated.logoConfig = structured.logoConfig;
      updated.themeVersion = structured.themeVersion;

      const result = await persistSettings(updated);
      // Local state follows the database, not the other way round: a rejected
      // write must leave the editor showing unsaved changes rather than a
      // clean slate the server never received.
      if (!result.ok) return result;

      setSettings(updated);
      if (newSettings.darkModeDefault) {
        setThemeMode(newSettings.darkModeDefault);
      }
      return result;
    },
    [persistSettings],
  );

  const value = useMemo<BrandContextValue>(
    () => ({
      settings,
      updateSettings,
      isLoading,
      currentTheme,
      themeMode,
      theme: themeMode,
      isDark: currentTheme === 'dark',
      setThemeMode,
      setTheme: setThemeMode,
      resolvedTokens,
    }),
    [currentTheme, isLoading, resolvedTokens, settings, themeMode, updateSettings]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return context;
}