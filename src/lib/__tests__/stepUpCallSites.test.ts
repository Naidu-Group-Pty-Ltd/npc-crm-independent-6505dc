/**
 * A step-up gate is only a control if somebody can satisfy it.
 *
 * `admin-user-management` has refused every role and permission mutation
 * without a recent step-up proof since WP-11C, and the page that sends them
 * never asked for one: `StepUpDialog` and `useStepUp` had zero call sites. So
 * "Save AML Roles" answered "Recent reauthentication required" with nothing on
 * screen able to provide it — measured 2 Oct 2026 on the CRM-independent
 * clone, every Save a 401 and `security-step-up` never called once.
 *
 * Two more faults sat behind it, each enough on its own:
 *
 *   - the transport read the gate's 401 as a dead SESSION, refreshed, retried
 *     the same refusal and counted both toward the five-failure circuit
 *     breaker, so the third click signed the administrator out;
 *   - under enforce mode the gate accepts nothing below assurance 2, and a
 *     password alone mints assurance 1 — so an account with no authenticator
 *     could reauthenticate successfully and be refused again, forever.
 *
 * These tests pin all three, and pin the first by DERIVING the gated actions
 * from the server rather than listing them, because a hand-list cannot see the
 * action it does not mention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const invokeMock = vi.fn();
vi.mock('@/lib/secureInvoke', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/secureInvoke')>();
  return { ...actual, invokeSecureFunction: (...args: unknown[]) => invokeMock(...args) };
});

import { isElevationRefusal } from '@/lib/secureInvoke';
import {
  invokeWithStepUp,
  isStepUpRequired,
  stepUpFailureMessage,
  storeStepUpToken,
  getStepUpToken,
} from '@/lib/security/stepUp';

const refusal = (reason = 'missing') => ({
  data: { success: false, error: 'Recent reauthentication required', code: 'step_up_required', capability: 'aml.role.set', reason },
  error: { message: 'Recent reauthentication required', status: 401, code: 'step_up_required' },
});

describe('a step-up refusal is not a failed session', () => {
  it('recognises the gate and the reauthentication endpoint answers', () => {
    expect(isElevationRefusal('admin-user-management', { code: 'step_up_required' })).toBe(true);
    expect(isElevationRefusal('security-step-up', { error: 'mfa_enrollment_required', code: 'mfa_enrollment_required' })).toBe(true);
    expect(isElevationRefusal('security-step-up', { error: 'invalid_mfa_code', code: 'mfa_verification_required' })).toBe(true);
    // A wrong password typed into the reauth dialog is about the password.
    expect(isElevationRefusal('security-step-up', { success: false, error: 'invalid_credentials' })).toBe(true);
  });

  it('still treats a genuinely dead session as one', () => {
    expect(isElevationRefusal('admin-user-management', { error: 'Authentication required' })).toBe(false);
    expect(isElevationRefusal('security-step-up', { error: 'staff_session_required', code: 'staff_session_required' })).toBe(false);
    // `invalid_credentials` means a dead session anywhere but the reauth endpoint.
    expect(isElevationRefusal('admin-user-management', { error: 'invalid_credentials' })).toBe(false);
  });

  it('is applied where the transport decides to refresh and trip the breaker', () => {
    const src = read('src/lib/secureInvoke.ts');
    expect(src).toMatch(/isAuthFailureResponse\(response\.status, message\)\s*&& !isElevationRefusal\(functionName, data\)/);
  });
});

describe('invokeWithStepUp', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it('asks once, then retries with the new proof', async () => {
    invokeMock.mockResolvedValueOnce(refusal()).mockResolvedValueOnce({ data: { success: true }, error: null });
    const guard = vi.fn().mockResolvedValue(true);
    const result = await invokeWithStepUp('admin-user-management', { action: 'set_aml_roles' }, 'aml.role.set', guard);
    expect(guard).toHaveBeenCalledWith('aml.role.set');
    expect(invokeMock).toHaveBeenCalledTimes(2);
    for (const call of invokeMock.mock.calls) expect(call[2]).toEqual({ stepUpCapability: 'aml.role.set' });
    expect(result.data).toEqual({ success: true });
  });

  it('drops a held proof the gate refused, so the dialog actually opens', async () => {
    storeStepUpToken('role.change', 'x'.repeat(64), new Date(Date.now() + 600_000).toISOString());
    invokeMock.mockResolvedValueOnce(refusal('expired')).mockResolvedValueOnce({ data: { success: true }, error: null });
    const guard = vi.fn(async () => {
      expect(getStepUpToken('role.change')).toBeNull();
      return true;
    });
    await invokeWithStepUp('admin-user-management', { action: 'promote_to_superadmin' }, 'role.change', guard);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('reports a cancelled dialog as cancelled, not as a failure', async () => {
    invokeMock.mockResolvedValueOnce(refusal());
    const result = await invokeWithStepUp('admin-user-management', {}, 'aml.role.set', async () => false);
    expect(result.cancelled).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('never prompts when the gate did not refuse', async () => {
    invokeMock.mockResolvedValueOnce({ data: { success: false, error: 'Cannot remove your own MLRO role' }, error: null });
    const guard = vi.fn();
    const result = await invokeWithStepUp('admin-user-management', {}, 'aml.role.set', guard);
    expect(guard).not.toHaveBeenCalled();
    expect(stepUpFailureMessage(result, 'fallback')).toBe('Cannot remove your own MLRO role');
  });

  it('names the missing authenticator rather than repeating the refusal', () => {
    const r = refusal('insufficient_assurance');
    expect(isStepUpRequired(r)).toBe(true);
    expect(stepUpFailureMessage(r, 'fallback')).toMatch(/authenticator/i);
    expect(stepUpFailureMessage(r, 'fallback')).not.toMatch(/Recent reauthentication required/);
  });
});

/** The actions the server gates, read from the server, never restated. */
function gatedActions(): string[] {
  const src = read('supabase/functions/admin-user-management/index.ts');
  const m = src.match(/const ROLE_MUTATION_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error('ROLE_MUTATION_ACTIONS not found in admin-user-management');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('every step-up-gated action is sent the way the gate expects', () => {
  const actions = gatedActions();

  it('reads a non-empty gated set that includes set_aml_roles', () => {
    expect(actions).toContain('set_aml_roles');
    expect(actions.length).toBeGreaterThanOrEqual(5);
  });

  it('no call site sends a gated action through plain invokeSecureFunction', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const action of actions) {
        const re = new RegExp(`action:\\s*['"]${action}['"]`, 'g');
        for (const hit of text.matchAll(re)) {
          seen++;
          // The call that carries this action opens on one of the few lines above it.
          const before = text.slice(Math.max(0, (hit.index ?? 0) - 400), hit.index);
          const lastPlain = before.lastIndexOf('invokeSecureFunction(');
          const lastGated = Math.max(before.lastIndexOf('invokeGated('), before.lastIndexOf('invokeWithStepUp('));
          if (lastGated < 0 || lastPlain > lastGated) offenders.push(`${relative(REPO_ROOT, file)}: ${action}`);
        }
      }
    }
    // Not vacuous: the page that was reported does send these actions.
    expect(seen).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
  });

  it('the step-up dialog is mounted where the gated calls are made', () => {
    for (const rel of ['src/pages/admin/UserManagement.tsx', 'src/components/admin/ClonePermissionsDialog.tsx']) {
      const src = read(rel);
      expect(src, rel).toMatch(/useStepUp\(\)/);
      expect(src, rel).toMatch(/\{stepUpDialog\}/);
    }
  });
});

describe('the reauthentication endpoint mints only a proof the gate can accept', () => {
  it('refuses an account with no authenticator under enforce mode, before minting', () => {
    const src = read('supabase/functions/security-step-up/index.ts');
    const refuse = src.indexOf("if (!userRow.mfa_enrolled_at && enforcementModeFor(capability) === 'enforce')");
    const mint = src.indexOf("admin.from('step_up_sessions').insert(");
    expect(refuse).toBeGreaterThan(0);
    expect(mint).toBeGreaterThan(refuse);
    expect(src.slice(refuse, refuse + 800)).toMatch(/mfa_enrollment_required/);
  });

  it('reads the same enforcement rule the gate applies', () => {
    expect(read('supabase/functions/_shared/stepUp.ts')).toMatch(/export function enforcementModeFor\(/);
  });
});
