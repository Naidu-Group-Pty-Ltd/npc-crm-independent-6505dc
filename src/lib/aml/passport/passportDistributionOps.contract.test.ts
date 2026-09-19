/**
 * Distribution operations — source contract.
 *
 * The pure engine is tested behaviourally in `passportDistribution.test.ts`.
 * These assertions cover the half a pure test cannot reach: what the EDGE
 * FUNCTION does with the engine's answer. They read the source, because the
 * failure modes here are "the server trusted the body" and "the write ran
 * before the check" — neither produces a type error, and neither is visible
 * from a unit test of the module.
 *
 * Do not relax these to make a distribution feature ship.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(process.cwd(), 'supabase/functions/aml-reliance/index.ts'),
  'utf8',
);

/**
 * The distribution block only — assertions must not pass on a neighbour, and
 * this block must not leak into a neighbour's slice either. It sits between
 * `list_attestations` and `get_passport_view` precisely because every existing
 * contract suite that reads this file pins an op by its NEXT op's name; a
 * write-bearing block dropped into one of those spans silently redefines what
 * a read-only assertion is asserting about.
 */
const BLOCK = SOURCE.slice(
  SOURCE.indexOf('case "get_passport_distribution_readiness"'),
  SOURCE.indexOf('case "get_passport_view"'),
);

describe('distribution operations exist and are one code path', () => {
  it('declares all four operations', () => {
    for (const op of [
      'get_passport_distribution_readiness',
      'get_passport_distribution_status',
      'share_passport_to_partner',
      'share_passport_to_partners',
    ]) {
      expect(BLOCK).toContain(`case "${op}"`);
    }
  });

  it('routes them through the shared pure engine, not a local re-decision', () => {
    expect(BLOCK).toContain('evaluateDistribution(distCtx, candidate)');
    expect(SOURCE).toContain('passportDistribution.pure.ts');
  });
});

describe('authority is derived, never asserted by the caller', () => {
  it('requires MLRO and reads the flag from the server', () => {
    expect(BLOCK).toMatch(/if \(!isMlro\) return jr\(/);
    expect(BLOCK).toContain('flagEnabled(admin, "aml_passport_partner_distribution")');
  });

  it('never reads an eligibility claim off the request body', () => {
    // The exact shapes §8 forbids. A body that could state these would be
    // the authority instead of the database.
    for (const forbidden of [
      'body.partner_is_eligible', 'body.section_37a', 'body.agreement_current',
      'body.client_compliant', 'body.passport_current', 'body.legal_route',
      'body.attestation_id', 'body.consent_id', 'body.grant_id',
      'body.ready', 'body.blockers',
    ]) {
      expect(BLOCK).not.toContain(forbidden);
    }
  });

  it('reads the attestation, consent and route from the database', () => {
    expect(BLOCK).toContain('from("compliance_attestations")');
    expect(BLOCK).toContain('eq("kind", "compliance_sharing")');
    expect(BLOCK).toContain('from("partner_case_links")');
    // The route comes off the link row, never off the body.
    expect(BLOCK).toContain('legalRoute: primary?.legal_route ?? null');
  });

  it('a body may narrow the partner set but never widen it', () => {
    // Candidates start from the links on THIS case; a requested id filters
    // that set. Naming an unlinked organisation cannot introduce it.
    expect(BLOCK).toMatch(/requested\.length === 0 \|\| requested\.includes/);
  });
});

describe('the write path fails closed', () => {
  it('refuses writes with the flag off', () => {
    expect(BLOCK).toMatch(/if \(!distributionEnabled && isWrite\)/);
    expect(BLOCK).toContain('distribution_disabled');
  });

  it('never shares a partner the engine did not mark ready', () => {
    expect(BLOCK).toMatch(/if \(!r\.ready\)[\s\S]{0,200}shared: false/);
  });

  it('is idempotent — an existing current grant is a no-op', () => {
    expect(BLOCK).toContain('ALREADY_CURRENT');
    // Re-checked against the database immediately before insert, not only
    // against the evaluation, so two concurrent calls cannot both write.
    expect(BLOCK).toMatch(/eq\("attestation_id", att!\.id\)\.is\("revoked_at", null\)/);
  });

  it('pins the grant to the exact current attestation', () => {
    expect(BLOCK).toContain('attestation_id: att!.id');
  });
});

describe('the AML engine is never written by distribution', () => {
  it('writes only reliance-domain rows', () => {
    const inserts = [...BLOCK.matchAll(/from\("([a-z_]+)"\)\s*\.insert/g)].map((m) => m[1]);
    expect(new Set(inserts)).toEqual(new Set(['reliance_grants', 'disclosure_manifests']));
  });

  it('never updates, upserts or deletes anything at all', () => {
    // `service_gate_status` DOES appear in the block — as a column this reads
    // and hands to `derivePassportState`. Reading case state is how readiness
    // is derived; the invariant is that nothing here WRITES it. So the
    // assertion is on the verbs, not on the column names.
    expect([...BLOCK.matchAll(/\.update\(/g)]).toHaveLength(0);
    expect([...BLOCK.matchAll(/\.upsert\(/g)]).toHaveLength(0);
    expect([...BLOCK.matchAll(/\.delete\(/g)]).toHaveLength(0);
  });

  it('touches the AML core tables read-only', () => {
    // Every reference to a core table in this block must be a `.select`.
    for (const table of ['cases', 'verification_checks', 'documents', 'consents', 'transactions']) {
      const refs = [...BLOCK.matchAll(new RegExp(`from\\("${table}"\\)\\s*\\n?\\s*\\.(\\w+)`, 'g'))];
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(r[1]).toBe('select');
    }
  });

  it('audits through the canonical event writer, never ad-hoc SQL', () => {
    expect(BLOCK).toContain('appendCaseEvent(admin, caseId, "mlro_decision"');
    expect(BLOCK).not.toMatch(/from\("case_events"\)\s*\.insert/);
  });
});

describe('evidence and documents', () => {
  it('classifies evidence without copying bytes or exposing paths', () => {
    expect(BLOCK).toContain('evidence_classes');
    for (const forbidden of [
      'storage.from', 'createSignedUrl', 'storage_path', 'download(',
      'copy(', 'upload(',
    ]) {
      expect(BLOCK).not.toContain(forbidden);
    }
  });

  it('does not fabricate a records request from the origin', () => {
    expect(BLOCK).not.toMatch(/from\("partner_records_requests"\)\s*\.insert/);
  });
});
