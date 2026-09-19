/**
 * Passport server ops — source contracts.
 *
 * Reads the edge-function sources the way the existing AML contract suites
 * do, and pins the properties that make the Passport additive and safe:
 * flag-gating before any case read, the client op's structural boundary,
 * and read-only behaviour (no writes, no event-chain appends from views).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../../../..');
const relianceSource = readFileSync(
  join(repo, 'supabase/functions/aml-reliance/index.ts'), 'utf8');
const portalSource = readFileSync(
  join(repo, 'supabase/functions/aml-client-portal/index.ts'), 'utf8');

function opBlock(source: string, op: string, nextOp: string): string {
  const start = source.indexOf(`case "${op}"`) >= 0
    ? source.indexOf(`case "${op}"`)
    : source.indexOf(`case '${op}'`);
  const end = source.indexOf(`case "${nextOp}"`) >= 0
    ? source.indexOf(`case "${nextOp}"`)
    : source.indexOf(`case '${nextOp}'`);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('get_passport_view (Command, aml-reliance)', () => {
  const block = opBlock(relianceSource, 'get_passport_view', 'grant_access');

  it('is flag-gated before any case data is read', () => {
    // The gathering moved into `buildCasePassportView` so the partner
    // audience reads the SAME records rather than a second assembly. The
    // property is unchanged and is asserted the same way: nothing may touch
    // the case before the flag, and the op reads no case of its own.
    const flagAt = block.indexOf('aml_passport_command_view');
    const buildAt = block.indexOf('buildCasePassportView(');
    expect(flagAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(flagAt);
    expect(block).not.toContain('.from("cases")');
    expect(block).toContain('passport_disabled');
  });

  it('builds through the shared pure assembler — no ad-hoc view shaping', () => {
    expect(block).toContain('buildCasePassportView(admin, caseId, "command")');
    // And that helper is the one place the assembler is called from.
    const helper = relianceSource.slice(
      relianceSource.indexOf('async function buildCasePassportView'));
    expect(helper.slice(0, 12_000)).toContain('buildPassportView(audience, {');
    expect(relianceSource.match(/buildPassportView\(/g) ?? []).toHaveLength(1);
  });

  it('serves the partner audience from that same assembly', () => {
    // Two assemblies of one document eventually disagree about it — these
    // did, and a partner held a booklet with different pages and titles.
    const redeem = relianceSource.slice(
      relianceSource.indexOf('if (op === "redeem_attestation")'));
    expect(redeem.slice(0, 6_000))
      .toContain('buildCasePassportView(admin, grant.case_id, "partner")');
  });

  it('is read-only: no inserts, updates or event appends', () => {
    expect(block).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(block).not.toContain('appendCaseEvent');
  });

  it('sits in the staff section (after verifyAuth + AML role gate)', () => {
    const staffGate = relianceSource.indexOf('has_any_aml_role');
    const op = relianceSource.indexOf('case "get_passport_view"');
    expect(staffGate).toBeGreaterThan(-1);
    expect(op).toBeGreaterThan(staffGate);
  });
});

describe('get_passport (client, aml-client-portal)', () => {
  const block = opBlock(portalSource, 'get_passport', 'get_questionnaire');

  it('is flag-gated before the case is resolved', () => {
    const flagAt = block.indexOf('aml_passport_client_view');
    const caseAt = block.indexOf('resolveCase(');
    expect(flagAt).toBeGreaterThan(-1);
    expect(caseAt).toBeGreaterThan(flagAt);
    expect(block).toContain('passport_disabled');
  });

  it('builds the client audience through the shared assembler and helper', () => {
    expect(block).toContain("buildPassportView('client'");
    expect(block).toContain('buildClientStampInput(');
  });

  it('is read-only: no inserts, updates or event appends', () => {
    expect(block).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it('never fetches command-only families — restricted sections are absent by construction', () => {
    // The wider portal contracts ban these table names file-wide; this pins
    // the same guarantee to the op block so a future refactor of those
    // suites cannot silently orphan it.
    for (const banned of [
      'party_screening_subjects', 'pep_determinations', 'screening_checks',
      'beneficial_owners', 'entity_case_links', 'source_of_funds',
      'source_of_wealth', 'edd_cases', 'case_events', 'risk_assessments',
      'service_gate_decisions', 'disclosure_manifests',
    ]) {
      expect(block).not.toContain(banned);
    }
  });

  it('post-issuance milestone facts come from the issued attestation payload', () => {
    expect(block).toContain('attestation_payload: currentAtt?.payload ?? null');
  });
});
