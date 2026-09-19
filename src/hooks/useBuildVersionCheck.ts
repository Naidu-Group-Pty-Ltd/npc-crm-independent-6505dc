import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  BUILD_ID,
  fetchDeployedBuildId,
  isStaleBuild,
  type VersionManifest,
} from '@/lib/buildVersion';
import { cleanReloadMarkerFromUrl, reloadForFreshBuild } from '@/lib/chunkReload';

/** Don't re-check more often than this, however often the tab regains focus. */
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Watches for the tab running an outdated build and offers a reload.
 *
 * Deliberately never reloads on its own: the user may be mid-form. It prompts
 * once per detected build so a long-lived tab is not nagged.
 */
export function useBuildVersionCheck(): void {
  const lastCheckedAt = useRef(0);
  const promptedFor = useRef<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    // Tidy the `?_v=` marker a recovery reload may have left behind.
    cleanReloadMarkerFromUrl();

    if (BUILD_ID === 'dev') return;

    let cancelled = false;

    const check = async () => {
      if (checking.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastCheckedAt.current < MIN_CHECK_INTERVAL_MS) return;

      checking.current = true;
      lastCheckedAt.current = now;
      let manifest: VersionManifest | null = null;
      try {
        manifest = await fetchDeployedBuildId();
      } finally {
        checking.current = false;
      }

      if (cancelled || !isStaleBuild(BUILD_ID, manifest) || !manifest) return;
      if (promptedFor.current === manifest.buildId) return;
      promptedFor.current = manifest.buildId;

      toast.info('A newer version of the dashboard is available', {
        description: 'This tab is running an older build. Reload to pick up the latest fixes.',
        duration: Infinity,
        action: { label: 'Reload', onClick: () => reloadForFreshBuild() },
      });
    };

    void check();
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
}
