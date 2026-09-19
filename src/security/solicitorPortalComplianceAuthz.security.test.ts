import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyLegalAuditChain } from '../../supabase/functions/_shared/legalAudit';

const source = readFileSync('supabase/functions/solicitor-portal-compliance/index.ts', 'utf8');
const audit = readFileSync('supabase/functions/_shared/legalAudit.ts', 'utf8');
/** Where the walk, the recomputation and the trigger actually live. */
const chainSql = readFileSync(
  'supabase/migrations/20260730220000_field_ownership_outbox_projections_phase6.sql',
  'utf8',
);

describe('solicitor-portal-compliance authorization', () => {
  it('resolves a solicitor session before any operation', () => {
    expect(source).toContain('resolveSolicitorSession(supabase, req.headers, body)');
    expect(source).toContain("json({ error: session.error || 'Unauthorised' }, session.status || 401)");
  });

  it('scopes every matter to an exact non-null firm and explicit matter grant', () => {
    expect(source).toContain("!matter.firm_id || matter.firm_id !== me.firm_id");
    expect(source).toContain('resolveSolicitorMatterAccess(supabase, me.id, me.firm_id, matter.id)');
    expect(source).toContain('resolveMatterPermissions(supabase, access)');
    expect(source).not.toContain('assignedClientIds.includes(matter.client_id)');
  });

  it('gates the audit trail and export behind the audit permission key', () => {
    expect(source.match(/can\(loaded\.perms, 'audit', 'view'\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('gates conflict, closure and retention mutations behind matters edit', () => {
    expect(source.match(/can\(loaded\.perms, 'matters', 'edit'\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('limits conflict searches to assigned clients', () => {
    expect(source).toContain(".in('client_id', assignedClientIds)");
  });

  it('sanitizes conflict terms before enforcing the minimum length', () => {
    expect(source).toContain("String(v).replace(/[%_(),]/g, '').trim()");
    expect(source).toContain('body.terms.map(conflictTerm).filter((t: string) => t.length >= 3)');
    expect(source).not.toContain("t.replace(/[%,()]/g, '')");
  });

  it('never selects restricted financial or AML data into the compliance pack', () => {
    expect(source).not.toMatch(/borrowing_capacity|purchase_file_decisions|aml_/);
  });
});

describe('legal audit chain integrity', () => {
  /**
   * The chain is verified in the database now, not in TypeScript.
   *
   * This asserted the reason string `prev_hash does not match the preceding
   * entry` in `legalAudit.ts`, which used to walk the rows and recompute each
   * hash. `verifyLegalAuditChain` now calls the `verify_legal_audit_chain_strict`
   * RPC, so the walk, the recomputation and the reasons live in
   * `20260730220000_field_ownership_outbox_projections_phase6.sql` — beside the
   * `BEFORE INSERT` trigger that sets `prev_hash`/`row_hash`, where a caller
   * cannot bypass them.
   *
   * Stronger, so the assertions follow it down: the module must delegate and
   * fail CLOSED, and the SQL must still detect both a broken link and altered
   * content.
   */
  it('is append-only and hash chained', () => {
    expect(audit).toContain('legal_matter_audit_events');
    expect(audit).toContain('verifyLegalAuditChain');
    expect(audit).toContain("supabase.rpc('verify_legal_audit_chain_strict'");
    // An RPC error must not read as a verified chain.
    expect(audit).toContain("if (error || !data) return { verified: false");

    expect(chainSql).toContain('prev_hash_mismatch');
    expect(chainSql).toContain('row_hash_mismatch');
    expect(chainSql).toContain('compute_legal_audit_row_hash');
    // The hash is written by a trigger, not by the caller.
    expect(chainSql).toContain('NEW.prev_hash:=last_hash;');
  });

  it('never throws out of the recorder', () => {
    expect(audit).toContain("console.error('[legal-audit] insert failed:'");
    expect(audit).toContain("console.error('[legal-audit] insert threw:'");
  });

  /**
   * The stub speaks `rpc`, because that is what the module calls.
   *
   * This built a fake `from()` query returning one row with a deliberately
   * wrong `row_hash` and expected the TypeScript walk to catch it. There is no
   * walk any more, so the stub had no `rpc` and the call threw. What is left to
   * test on this side is the mapping and the fail-closed path — the detection
   * itself is asserted against the SQL above.
   */
  it('maps a broken chain through faithfully', async () => {
    const supabase = {
      rpc: async () => ({
        data: { verified: false, checked: 3, broken_at: 'event-1', reason: 'row_hash_mismatch' },
        error: null,
      }),
    };

    await expect(verifyLegalAuditChain(supabase, 'matter-1')).resolves.toMatchObject({
      verified: false,
      checked: 3,
      broken_at: 'event-1',
      broken_reason: 'row_hash_mismatch',
    });
  });

  it('reports unverified when the check itself fails', async () => {
    // A verifier that cannot run must never answer "verified".
    const supabase = { rpc: async () => ({ data: null, error: { message: 'permission denied' } }) };

    await expect(verifyLegalAuditChain(supabase, 'matter-1')).resolves.toMatchObject({
      verified: false,
      broken_reason: 'permission denied',
    });
  });
});
