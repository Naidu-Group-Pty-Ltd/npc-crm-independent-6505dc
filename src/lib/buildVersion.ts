/**
 * Stale-bundle detection.
 *
 * A chunk that 404s is the loud failure mode of a cached `index.html` (see
 * `chunkReload.ts`). The quiet one is worse: every hashed asset from the old
 * deploy is still on the CDN, so the app loads perfectly and simply runs
 * yesterday's code. Nothing errors, and a fixed bug looks unfixed.
 *
 * The build stamps its id into the bundle and writes the same id to
 * `version.json`. Comparing the two tells us whether this tab is current.
 */

/** Injected by Vite at build time; `dev` when running the dev server. */
declare const __BUILD_ID__: string;

export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : 'dev';

export const VERSION_MANIFEST_PATH = '/version.json';

export interface VersionManifest {
  buildId: string;
  /**
   * Which Supabase project THIS BUILD resolved, and whether it came from the
   * environment or from the built-in fallback.
   *
   * Written by `vite.config.ts` from the same pure resolver the running client
   * uses, so the manifest and the client cannot disagree. It exists because
   * nothing outside the browser could otherwise tell them apart: the prime's
   * ref is compiled into every bundle as the fallback constant, so reading the
   * JavaScript for a project name finds it on a correctly-configured clone too.
   * Mission Control reads this to assert, by effect rather than by
   * configuration, that a clone's deployment talks to the clone's own backend —
   * the check that was missing when three of four clones served a bundle
   * pointed at the prime.
   *
   * Optional because a build made before this shipped has no such field, and
   * absent must read as "not declared" rather than as a pass.
   */
  supabase?: {
    projectRef: string | null;
    source: 'env' | 'fallback';
  };
}

export function parseVersionManifest(value: unknown): VersionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const buildId = (value as { buildId?: unknown }).buildId;
  if (typeof buildId !== 'string' || buildId.length === 0) return null;

  // The backend block is read leniently and dropped whole if it is not exactly
  // what it claims to be. A half-read manifest asserting a project ref it does
  // not have is worse than one that says nothing.
  const raw = (value as { supabase?: unknown }).supabase;
  let supabase: VersionManifest['supabase'];
  if (raw && typeof raw === 'object') {
    const ref = (raw as { projectRef?: unknown }).projectRef;
    const source = (raw as { source?: unknown }).source;
    if (
      (typeof ref === 'string' || ref === null) &&
      (source === 'env' || source === 'fallback')
    ) {
      supabase = { projectRef: typeof ref === 'string' ? ref : null, source };
    }
  }

  return supabase ? { buildId, supabase } : { buildId };
}

/**
 * A build is stale only when we can positively identify both sides and they
 * differ. An unreachable or malformed manifest must never trigger a reload
 * prompt — offline users would be nagged forever.
 */
export function isStaleBuild(runningId: string, manifest: VersionManifest | null): boolean {
  if (!manifest) return false;
  if (runningId === 'dev' || manifest.buildId === 'dev') return false;
  return runningId !== manifest.buildId;
}

/**
 * Fetches the deployed build id, bypassing every cache layer. The query string
 * defeats intermediaries that ignore `Cache-Control` on static files.
 */
export async function fetchDeployedBuildId(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<VersionManifest | null> {
  try {
    const response = await fetchImpl(`${VERSION_MANIFEST_PATH}?t=${now.toString(36)}`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return null;
    return parseVersionManifest(await response.json());
  } catch {
    // Offline, blocked, or the manifest is not deployed yet — treat as current.
    return null;
  }
}
