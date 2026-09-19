/**
 * Feature flag for the Template Library (see
 * `docs/template-library/README.md`).
 *
 * Default **ON**: the library is released, so every authenticated user of this
 * deployment with `templates` access sees the Library tab. The flag remains as
 * a one-flip kill-switch — turning it off restores the Template Management page
 * to its previous eight tabs with no deploy.
 *
 * Precedence mirrors `src/lib/reportTemplate/editorV2Flag.ts` so operators only
 * have one mental model for template feature flags:
 *   `?templateLibrary=1` per visit  →  localStorage per browser  →
 *   `VITE_TEMPLATE_LIBRARY` per build  →  default (off).
 *
 * `resolveTemplateLibraryFlag` is pure so the precedence is unit-testable;
 * `isTemplateLibraryEnabled` wires it to the live browser environment.
 *
 * Consumed by `src/pages/Templates.tsx` to gate the Library tab, and nothing
 * else — the flag controls visibility, never data access. The edge function
 * enforces permissions independently of it.
 */
const STORAGE_KEY = 'template-library';

export function resolveTemplateLibraryFlag(input: {
  /** e.g. `window.location.search` */
  searchParams?: string;
  /** e.g. `localStorage.getItem(STORAGE_KEY)` */
  storageValue?: string | null;
  /** e.g. `import.meta.env.VITE_TEMPLATE_LIBRARY` */
  envValue?: string | boolean | undefined;
}): boolean {
  const { searchParams, storageValue, envValue } = input;

  // URL param wins, so a single visit can be flipped either way without a
  // deploy or a stored preference getting in the way.
  if (searchParams) {
    const p = new URLSearchParams(searchParams).get('templateLibrary');
    if (p === '1' || p === 'true') return true;
    if (p === '0' || p === 'false') return false;
  }
  // Then a sticky per-browser preference.
  if (storageValue === '1' || storageValue === 'true') return true;
  if (storageValue === '0' || storageValue === 'false') return false;
  // Then the build-time override (can force on OR off).
  if (envValue === true || envValue === '1' || envValue === 'true') return true;
  if (envValue === false || envValue === '0' || envValue === 'false') return false;

  return true; // default ON — the library is released (kill-switch above)
}

export function isTemplateLibraryEnabled(): boolean {
  try {
    return resolveTemplateLibraryFlag({
      searchParams: typeof window !== 'undefined' ? window.location.search : '',
      storageValue: typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null,
      envValue: (import.meta as any)?.env?.VITE_TEMPLATE_LIBRARY,
    });
  } catch {
    // A browser environment we cannot read is one we do not enable in: the tab
    // is additive, so failing closed costs nothing and failing open could
    // render a surface whose data layer is equally unreachable.
    return false;
  }
}

export function setTemplateLibraryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore — flag is a convenience, never critical */
  }
}
