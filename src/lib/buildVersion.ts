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
}

export function parseVersionManifest(value: unknown): VersionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const buildId = (value as { buildId?: unknown }).buildId;
  if (typeof buildId !== 'string' || buildId.length === 0) return null;
  return { buildId };
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
