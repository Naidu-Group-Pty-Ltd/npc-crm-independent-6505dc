import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandProvider, useBrand } from '../BrandProvider';
import { defaultBrandConfig } from '../brand-defaults';
import {
  clearPersistedDraft,
  loadPersistedDraft,
  loadStoredBrandPresets,
  savePersistedDraft,
  saveStoredBrandPresets,
  type StoredBrandPreset,
} from '../brand-draft-storage';

const updateMock = vi.fn();
let databaseRow: Record<string, unknown> | null;

/**
 * Rows the UPDATE is allowed to return. PostgREST answers an RLS-denied write
 * with 200, no error and an EMPTY set — the exact shape that made a rejected
 * save look successful — so tests drive this directly.
 */
let updateReturnsRows: Array<{ id: string }> = [{ id: 'brand-row-1' }];
/** Whether the session has an RLS token. Without one, writes run as `anon`. */
const authState = { isAuthenticated: true };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== 'whitelabel_settings') {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select: vi.fn(() => ({
          limit: vi.fn(() => ({
            single: vi.fn(async () => ({ data: databaseRow, error: null })),
          })),
        })),
        update: updateMock,
      };
    }),
  },
}));

/**
 * The mediated edge-function write is the primary save path. Unmocked it makes
 * a real network call, which made these tests slow and non-deterministic — a
 * different one timed out on each run. Driving it explicitly keeps both routes
 * testable: `mediatedSave` decides what the edge function answers, and the
 * direct PostgREST fallback below is exercised by leaving it unavailable.
 */
const mediatedSave = { available: false, response: { data: { success: true }, error: null } as unknown };
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(async (fn: string) => {
    if (fn !== 'manage-branding') throw new Error(`Unexpected function ${fn}`);
    if (!mediatedSave.available) {
      return { data: null, error: { message: 'edge function unavailable', status: 503 } };
    }
    return mediatedSave.response;
  }),
}));

// Branding writes go through the JWT-bearing client, not the anon one.
vi.mock('@/hooks/useAuthenticatedSupabase', () => ({
  useAuthenticatedSupabase: () => ({
    supabase: {
      from: (table: string) => {
        if (table !== 'whitelabel_settings') throw new Error(`Unexpected table ${table}`);
        return { update: updateMock };
      },
    },
    isAuthenticated: authState.isAuthenticated,
    userId: 'staff-1',
  }),
}));

function BrandProbe() {
  const { settings, updateSettings, isLoading, currentTheme, themeMode, resolvedTokens } = useBrand();
  const [lastResult, setLastResult] = React.useState('');

  return (
    <div>
      <p data-testid="save-result">{lastResult}</p>
      <button
        type="button"
        onClick={async () => {
          const result = await updateSettings({ favicon: null, sidebarIcon: null });
          setLastResult(result.ok ? 'ok' : `failed:${result.reason}`);
        }}
      >
        Remove marks
      </button>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="company">{settings.companyName}</p>
      <p data-testid="primary">{settings.primaryColor}</p>
      <p data-testid="accent">{settings.accentColor}</p>
      <p data-testid="theme-mode">{themeMode}</p>
      <p data-testid="current-theme">{currentTheme}</p>
      <p data-testid="sidebar-logo">{settings.sidebarLogo}</p>
      <p data-testid="favicon">{settings.favicon}</p>
      <p data-testid="soft-token">{resolvedTokens.light['--dashboard-primary-soft']}</p>
      <button
        type="button"
        onClick={() =>
          updateSettings({
            companyName: 'Naidu Advisory',
            primaryColor: '285 90% 45%',
            accentColor: '205 95% 45%',
            darkModeDefault: 'dark',
            authLogo: 'https://cdn.example.com/auth.png',
            sidebarLogo: 'https://cdn.example.com/sidebar.png',
            sidebarIcon: 'https://cdn.example.com/sidebar-icon.png',
            favicon: 'https://cdn.example.com/favicon.png',
          })
        }
      >
        Save brand changes
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <BrandProvider>
      <BrandProbe />
    </BrandProvider>
  );
}

describe('BrandProvider persistence and theme application', () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateReturnsRows = [{ id: 'brand-row-1' }];
    authState.isAuthenticated = true;
    mediatedSave.available = false;
    updateMock.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(async () => ({ data: updateReturnsRows, error: null })),
      })),
    });
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.head.innerHTML = '';
    document.title = '';

    databaseRow = {
      id: 'brand-row-1',
      company_name: 'Loaded Brand',
      primary_color: '210 80% 50%',
      accent_color: '25 85% 52%',
      dark_mode_default: 'light',
      auth_logo: 'https://cdn.example.com/loaded-auth.png',
      sidebar_logo: 'https://cdn.example.com/loaded-sidebar.png',
      sidebar_icon: 'https://cdn.example.com/loaded-sidebar-icon.png',
      favicon: 'https://cdn.example.com/loaded-favicon.png',
      email_signature_name: 'Advisor',
      email_signature_title: 'Principal',
      email_signature_phone: '555',
      email_signature_email: 'advisor@example.com',
      email_signature_website: 'example.com',
      email_signature_address: '1 Main St',
      email_signature_disclaimer: 'Disclaimer',
      theme_version: 1,
    };
  });

  it('loads whitelabel_settings, resolves light tokens, and applies document identity', async () => {
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(screen.getByTestId('company')).toHaveTextContent('Loaded Brand');
    expect(screen.getByTestId('primary')).toHaveTextContent('210 80% 50%');
    expect(screen.getByTestId('accent')).toHaveTextContent('25 85% 52%');
    expect(screen.getByTestId('sidebar-logo')).toHaveTextContent('https://cdn.example.com/loaded-sidebar.png');
    expect(screen.getByTestId('favicon')).toHaveTextContent('https://cdn.example.com/loaded-favicon.png');

    await waitFor(() => expect(document.title).toBe('Loaded Brand Dashboard'));
    expect(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.href).toBe('https://cdn.example.com/loaded-favicon.png');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('42 54% 96%');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('210 80% 50%');
  });

  it('persists live brand changes with legacy columns and structured JSON configs', async () => {
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    screen.getByRole('button', { name: 'Save brand changes' }).click();

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const persisted = updateMock.mock.calls[0][0];

    expect(persisted).toMatchObject({
      company_name: 'Naidu Advisory',
      primary_color: '285 90% 45%',
      accent_color: '205 95% 45%',
      dark_mode_default: 'dark',
      auth_logo: 'https://cdn.example.com/auth.png',
      sidebar_logo: 'https://cdn.example.com/sidebar.png',
      sidebar_icon: 'https://cdn.example.com/sidebar-icon.png',
      favicon: 'https://cdn.example.com/favicon.png',
      theme_version: 1,
    });
    expect(persisted.theme_config).toMatchObject({
      primaryColor: '285 90% 45%',
      accentColor: '205 95% 45%',
      darkModeDefault: 'dark',
    });
    expect(persisted.logo_config).toMatchObject({
      auth: 'https://cdn.example.com/auth.png',
      sidebar: 'https://cdn.example.com/sidebar.png',
      sidebarIcon: 'https://cdn.example.com/sidebar-icon.png',
      favicon: 'https://cdn.example.com/favicon.png',
    });

    await waitFor(() => expect(document.title).toBe('Naidu Advisory Dashboard'));
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('0 0% 4%');
    expect(screen.getByTestId('soft-token')).toHaveTextContent('285 29% 90%');
  });
});

describe('Branding drafts and presets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves, restores, clears, and reapplies local brand drafts and presets', () => {
    const draftSettings = {
      ...defaultBrandConfig,
      companyName: 'Draft Brand',
      primaryColor: '285 90% 45%',
      accentColor: '205 95% 45%',
      authLogo: 'https://cdn.example.com/auth.png',
      sidebarLogo: 'https://cdn.example.com/sidebar.png',
      sidebarIcon: 'https://cdn.example.com/sidebar-icon.png',
      favicon: 'https://cdn.example.com/favicon.png',
    };

    const savedDraft = savePersistedDraft(draftSettings);
    expect(loadPersistedDraft()).toEqual(savedDraft);

    const preset: StoredBrandPreset = {
      ...savedDraft,
      id: 'preset-1',
      name: 'Luxury Draft',
    };
    saveStoredBrandPresets([preset]);
    expect(loadStoredBrandPresets()).toEqual([preset]);

    clearPersistedDraft();
    expect(loadPersistedDraft()).toBeNull();
  });
});

/**
 * Removing a logo on the Branding page toasted "Branding settings saved" and
 * changed nothing. `whitelabel_settings` is readable by everyone but writable
 * only by `authenticated`, so a client without an RLS token loaded the page
 * perfectly and then wrote nothing — PostgREST answering 200, no error, zero
 * rows. `.update()` with no `.select()` cannot see that, so the failure was
 * indistinguishable from success.
 */
describe('BrandProvider save outcomes', () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateReturnsRows = [{ id: 'brand-row-1' }];
    authState.isAuthenticated = true;
    mediatedSave.available = false;
    updateMock.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(async () => ({ data: updateReturnsRows, error: null })),
      })),
    });
    localStorage.clear();
    document.head.innerHTML = '';
    databaseRow = {
      id: 'brand-row-1',
      company_name: 'Loaded Brand',
      auth_logo: 'https://cdn.example.com/loaded-auth.png',
      sidebar_logo: 'https://cdn.example.com/loaded-sidebar.png',
      sidebar_icon: 'https://cdn.example.com/loaded-sidebar-icon.png',
      favicon: 'https://cdn.example.com/loaded-favicon.png',
      theme_version: 1,
    };
  });

  async function renderAndRemoveMarks() {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    screen.getByRole('button', { name: 'Remove marks' }).click();
  }

  it('clears a logo by writing an explicit null to the column AND the JSONB', async () => {
    await renderAndRemoveMarks();

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const persisted = updateMock.mock.calls[0][0] as Record<string, unknown>;

    // A removal that omits the key, or sends undefined, leaves the old logo in
    // place — the row has to be told the value is now empty.
    expect(persisted.favicon).toBeNull();
    expect(persisted.sidebar_icon).toBeNull();
    expect((persisted.logo_config as Record<string, unknown>).favicon).toBeNull();
    expect((persisted.logo_config as Record<string, unknown>).sidebarIcon).toBeNull();
    // Untouched marks survive.
    expect(persisted.auth_logo).toBe('https://cdn.example.com/loaded-auth.png');

    await waitFor(() => expect(screen.getByTestId('save-result')).toHaveTextContent('ok'));
    expect(screen.getByTestId('favicon')).toBeEmptyDOMElement();
  });

  it('reports failure when the write matches no rows instead of claiming success', async () => {
    updateReturnsRows = []; // what an RLS denial actually looks like
    await renderAndRemoveMarks();

    await waitFor(() =>
      expect(screen.getByTestId('save-result')).toHaveTextContent('failed:not-persisted'),
    );
    // Local state must not drift ahead of the database, or the editor shows a
    // change the server never accepted.
    expect(screen.getByTestId('favicon')).toHaveTextContent('https://cdn.example.com/loaded-favicon.png');
  });

  it('refuses to write at all when the session has no RLS token', async () => {
    authState.isAuthenticated = false;
    await renderAndRemoveMarks();

    await waitFor(() =>
      expect(screen.getByTestId('save-result')).toHaveTextContent('failed:unauthenticated'),
    );
    // An anonymous write would have silently no-opped, so it is never attempted.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('prefers the cookie-authenticated edge function when it is available', async () => {
    // The staff session cookie is the durable identity; the tab-scoped RLS
    // token is derived and can be absent while the session is perfectly valid.
    mediatedSave.available = true;
    authState.isAuthenticated = false;

    await renderAndRemoveMarks();

    await waitFor(() => expect(screen.getByTestId('save-result')).toHaveTextContent('ok'));
    // No direct PostgREST write is needed once the mediated path succeeds.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('surfaces a database error rather than swallowing it', async () => {
    updateMock.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(async () => ({ data: null, error: { message: 'permission denied' } })),
      })),
    });
    await renderAndRemoveMarks();

    await waitFor(() => expect(screen.getByTestId('save-result')).toHaveTextContent('failed:error'));
  });
});
