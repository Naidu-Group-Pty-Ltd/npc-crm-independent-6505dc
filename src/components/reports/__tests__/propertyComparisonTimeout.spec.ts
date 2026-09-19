/**
 * Audit 3 item 13 — "the comparison analysis doesn't work".
 *
 * It worked; the browser stopped waiting for it. The client aborted at 150s
 * while the function is declared at 180s, so an analysis running its permitted
 * budget was reported as a failure at the 83% mark — and the recovery path
 * then went looking for a completed row while the analysis was still running,
 * which is why it honestly said the result "may still be finishing".
 *
 * This is the second time this exact drift has been fixed (the CRM
 * conversation sync was the first), so it is pinned rather than trusted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const modal = readFileSync(
  join(root, 'src', 'components', 'reports', 'PropertyComparisonModal.tsx'),
  'utf8',
);
const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');

const declaredSeconds = Number(
  config.match(/\[functions\.compare-investment-reports\][\s\S]*?request_timeout\s*=\s*(\d+)/)![1],
);
const clientMs = Number(
  modal.match(/const COMPARISON_TIMEOUT_MS = ([\d_]+);/)![1].replace(/_/g, ''),
);

describe('the browser waits as long as the comparison is allowed to run', () => {
  it('reads a declared request_timeout from config.toml', () => {
    expect(declaredSeconds).toBeGreaterThan(0);
  });

  it('waits at least as long as the function is permitted', () => {
    // A client budget below the server's is a timeout the user is shown for
    // work that is still succeeding.
    expect(clientMs).toBeGreaterThanOrEqual(declaredSeconds * 1000);
  });

  it('passes the budget rather than relying on the 60s default', () => {
    expect(modal).toMatch(
      /invokeSecureFunction\('compare-investment-reports',[\s\S]{0,80}?\{ timeoutMs: COMPARISON_TIMEOUT_MS \}/,
    );
  });

  it('keeps no second, hardcoded budget beside the named one', () => {
    // The literal this replaced was the whole defect.
    expect(modal).not.toMatch(/timeoutMs:\s*150000/);
  });
});
