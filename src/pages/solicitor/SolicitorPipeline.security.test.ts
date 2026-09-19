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

const pipelineSource = readFileSync(repoPath('src/pages/solicitor/SolicitorPipeline.tsx'), 'utf8');
const functionSource = readFileSync(
  repoPath('supabase/functions/solicitor-portal-intelligence/index.ts'),
  'utf8',
);

describe('solicitor pipeline matter status security', () => {
  it('prevents terminal matter cards from initiating a portal status move', () => {
    expect(pipelineSource).toContain(
      "const TERMINAL_STATUSES = new Set<LegalMatterStatus>(['settled', 'post_settlement', 'terminated'])",
    );
    expect(pipelineSource).toContain('draggable={!isTerminal}');
    expect(pipelineSource).toContain('TERMINAL_STATUSES.has(matter.status)');
  });

  it('enforces terminal-state and settlement bookkeeping in move_matter', () => {
    const moveMatterBranch = functionSource.match(
      /if \(operation === 'move_matter'\) \{([\s\S]*?)\n\s{4}\/\/ ─+ KPIs/,
    )?.[1];

    expect(moveMatterBranch).toBeDefined();
    expect(moveMatterBranch).toContain('TERMINAL_STATUSES.has(matter.status)');
    expect(moveMatterBranch).toContain(
      "error: 'This matter is closed. Contact NPC to reopen it.'",
    );
    expect(moveMatterBranch).toContain("status === 'settled'");
    expect(moveMatterBranch).toContain('patch.actual_settlement_date');
    expect(moveMatterBranch).toContain('patch.closed_at');
    expect(moveMatterBranch).toContain('.update(patch)');
  });
});
