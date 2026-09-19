import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

/*
 * Paths are resolved from the repo root, not from `import.meta.url`.
 *
 * These read their own subject's source, and did so through
 * `new URL('./x', import.meta.url)`. Under this Vitest the transformed module's
 * `import.meta.url` is not a `file:` URL, so `readFileSync` threw
 * `TypeError: The URL must be of scheme file` while the file was being
 * COLLECTED — which fails the file before a single assertion runs. A security
 * contract test that cannot be collected protects nothing, and says nothing
 * about what it was watching; it is the same shape as the unread checks this
 * repo keeps finding.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..');
const repoPath = (rel: string) => join(REPO_ROOT, rel);

const appSource = readFileSync(repoPath('src/App.tsx'), 'utf8');
const pageSource = readFileSync(repoPath('src/pages/admin/BcSegmentEngineAdmin.tsx'), 'utf8');
const migrationSource = readFileSync(
  repoPath('supabase/migrations/20260725000000_restrict_api_health_log_select.sql'),
  'utf8',
);

describe('BC Segment Engine admin authorization contract', () => {
  it('keeps the route behind the superadmin-only module guard', () => {
    expect(appSource).toContain(
      '<Route path="admin/bc-segment-engine" element={<ModuleGuard moduleKey="__superadmin_only__"><BcSegmentEngineAdmin /></ModuleGuard>} />',
    );
  });

  it('does not load admin data for non-superadmins if the page is mounted directly', () => {
    const effectSource = pageSource.slice(pageSource.indexOf('useEffect(() => {'));
    const roleCheck = effectSource.indexOf('if (!isSuperadmin) return;');
    const healthLoad = effectSource.indexOf('loadHealth();');

    expect(roleCheck).toBeGreaterThan(-1);
    expect(healthLoad).toBeGreaterThan(roleCheck);
  });

  it('removes the legacy public health-log read policy', () => {
    expect(migrationSource).toContain(
      'DROP POLICY IF EXISTS "Anyone can view API health logs" ON public.api_health_log;',
    );
  });
});
