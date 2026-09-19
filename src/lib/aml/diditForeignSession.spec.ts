import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readForeignSession,
  caseIdFromVendorData,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';

/**
 * Telling a sibling deployment's routine verification from a genuinely
 * unrecognised session.
 *
 * One Didit application carries one set of webhook destinations, and those
 * destinations FAN OUT — every enabled destination receives every event for
 * the application, with no per-session routing. Under the fleet-wide key the
 * prime and every clone share one application, so each deployment receives
 * every sibling's `status.updated`.
 *
 * Before this, all of it landed in `unknown_session`: an alarm that fired on
 * the most ordinary traffic there is and therefore stopped meaning anything.
 */

const CASE = '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f';

describe('readForeignSession', () => {
  it("reads a sibling's session when the vendor_data is ours and the case is not held here", () => {
    expect(readForeignSession(`npc:${CASE}:primary`, false)).toBe('sibling_deployment');
    expect(readForeignSession(`npc:${CASE}:${CASE}:2`, false)).toBe('sibling_deployment');
  });

  it('keeps the louder name when the vendor_data is not a shape this platform mints', () => {
    for (const value of [undefined, null, '', 'not-ours', 'npc:', 'npc::primary', 42, {}]) {
      expect(readForeignSession(value, false)).toBe('unrecognised');
    }
  });

  it('does not call it a sibling when the case IS held here', () => {
    // Our shape, our case, but nothing correlated — that is genuinely odd and
    // keeps the reading that says so.
    expect(readForeignSession(`npc:${CASE}:primary`, true)).toBe('unrecognised');
  });

  it('a failed case lookup is never reported as a confident "somebody else\'s"', () => {
    // null = the caller could not establish it. Reporting `sibling_deployment`
    // here would turn a database fault into a reassuring log line.
    expect(readForeignSession(`npc:${CASE}:primary`, null)).toBe('unrecognised');
  });
});

describe('caseIdFromVendorData', () => {
  it('extracts the case id from both minted shapes', () => {
    expect(caseIdFromVendorData(`npc:${CASE}:primary`)).toBe(CASE);
    expect(caseIdFromVendorData(`npc:${CASE}:someparty:3`)).toBe(CASE);
  });

  it('yields null for anything this platform did not mint', () => {
    for (const value of [undefined, null, '', 'npc', 'other:x:y', 7]) {
      expect(caseIdFromVendorData(value)).toBeNull();
    }
  });
});

describe('the classification can never settle an outcome', () => {
  const handler = readFileSync(
    resolve(__dirname, '../../../supabase/functions/didit-webhook/index.ts'), 'utf8');

  it('both readings acknowledge and apply nothing', () => {
    // `vendor_data` is provider-supplied and attacker-influenced in principle.
    // The moment a classification derived from it could decide an outcome it
    // would be a door onto another tenant's case, so both branches must end in
    // the same inert shape.
    expect(handler).toMatch(/reason = reading === 'sibling_deployment'\s*\n?\s*\? 'foreign_tenant_session'/);
    expect(handler).toMatch(/return json\(\{ ok: true, processed: false, reason \}, 202\)/);
  });

  it('the foreign-session branch reads the case by id and nothing from it', () => {
    const branch = handler.slice(handler.indexOf('let caseHeldLocally'));
    const lookup = branch.slice(0, branch.indexOf('const reading'));
    expect(lookup).toContain(".select('id')");
    // Selecting anything else would pull a sibling tenant's data into this
    // deployment to decide a log label.
    expect(lookup).not.toMatch(/select\('(?!id')/);
  });

  it('a hosted event this deployment can never act on is acknowledged, not retried', () => {
    // 5xx tells Didit to retry. "No hosted workflow is configured here" is the
    // CORRECT standing state on a deployment that runs the standalone path, so
    // every retry reaches the same answer for ever — and on the prime that is
    // most of the endpoint's 64% delivery-failure rate.
    expect(handler).toMatch(/workflow_not_configured'[\s\S]{0,80}?processed_at/);
    expect(handler).toMatch(/reason: 'workflow_not_configured' \}, 202\)/);
  });

  it('a MISSING API KEY still answers 5xx, because that one is worth retrying', () => {
    // The distinction is the point, so it is pinned rather than left to
    // whoever reads the two branches next. An absent key is an operator fault
    // with a fix, and the retry after that fix is what delivers the outcome
    // the event carries. An absent workflow is not a fault and has no fix.
    const at = handler.indexOf("api_key_not_configured");
    expect(at, 'the missing-key branch').toBeGreaterThan(-1);
    // The FIRST status this branch answers with, rather than "500 appears
    // somewhere in the next N bytes" — the branch carries prose now, and a
    // byte window that has to grow with the wording is a guard that decays.
    const branch = handler.slice(at);
    const status = /\}, (\d{3})\)/.exec(branch)?.[1];
    expect(status, 'status the missing-key branch answers with').toBe('500');
    // And never the workflow branch's acceptance, which is the distinction.
    expect(status).not.toBe('202');
  });
});
