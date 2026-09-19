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
const functionSource = readFileSync(
  repoPath('supabase/functions/ai-dashboard-agent/index.ts'),
  'utf8',
);

describe('Agent Quality authorization contract', () => {
  it('keeps the admin route behind the superadmin-only module guard', () => {
    expect(appSource).toContain(
      '<Route path="admin/agent-quality" element={<ModuleGuard moduleKey="__superadmin_only__"><AgentQuality /></ModuleGuard>} />',
    );
  });

  it('checks the persisted superadmin role before querying trace logs', () => {
    const traceAction = functionSource.slice(functionSource.indexOf("case 'get-trace-log':"));
    const roleCheck = traceAction.indexOf(".eq('role', 'superadmin')");
    const traceQuery = traceAction.indexOf(".from('agent_action_log')");

    expect(roleCheck).toBeGreaterThan(-1);
    expect(traceAction).toContain("status: 403");
    expect(traceQuery).toBeGreaterThan(roleCheck);
  });
});
