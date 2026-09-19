/**
 * Who may edit a completed assessment, and what completion actually protects.
 *
 * The reported defect: every field on a completed assessment was locked, and
 * the server behind them answered *"An assessment with status \"completed\"
 * cannot be edited. Reopen it first"* — naming a reopen action that exists
 * nowhere in the product. A deal does not stop when an assessment is marked
 * complete; a valuation lands, a rate moves, a tenancy is re-signed.
 *
 * These read the edge function's source rather than running it: the rules are
 * three constants and three branches, and a drift in any of them is exactly
 * what put the product in that state. What they pin is the *shape* of the
 * rule — edits are open to everything but archived, while the statuses a
 * browser may assign stay narrow, because `completed` and `linked` have
 * server-side preconditions (a calculation run; a reachable client) that an
 * autosave must not be able to skip.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/manage-ci-assessments/index.ts'),
  'utf8',
);

function setMembers(name: string): string[] {
  const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`).exec(SOURCE);
  if (!match) throw new Error(`${name} not found`);
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((entry) => entry[1]);
}

describe('the editable statuses', () => {
  it('admits a completed and a linked assessment', () => {
    const editable = setMembers('EDITABLE_STATUSES');
    expect(editable).toContain('completed');
    expect(editable).toContain('linked');
  });

  it('still refuses an archived one — which has a way back', () => {
    expect(setMembers('EDITABLE_STATUSES')).not.toContain('archived');
    expect(SOURCE).toMatch(/cannot be edited\. Restore it first/);
  });

  it('does not let the browser assign completed or linked', () => {
    // Both are reached through operations that check their preconditions:
    // `complete` requires a calculation run, `link_client` a reachable client.
    const assignable = setMembers('ASSIGNABLE_STATUSES');
    expect(assignable).not.toContain('completed');
    expect(assignable).not.toContain('linked');
    expect(assignable).not.toContain('archived');
    expect(assignable).toContain('data_entry');
  });
});

describe('what an edit must not do', () => {
  it('leaves a completed or linked assessment where it is', () => {
    // Demoting on edit would revoke the report and strand the client link
    // because a figure moved — the opposite of what editing is for.
    expect(SOURCE).toMatch(/if \(!ASSIGNABLE_STATUSES\.has\(existing\.status\)\) delete update\.status;/);
  });

  it('keeps a re-run on a completed assessment completed', () => {
    expect(SOURCE).toMatch(/status: ASSIGNABLE_STATUSES\.has\(existing\.status\) \? nextStatus : existing\.status/);
  });

  it('leaves the stored run untouched by an edit', () => {
    // The run is the record a report is produced from, and it carries its own
    // inputs and policy. Nothing in the update path writes to it.
    const updateBlock = SOURCE.slice(
      SOURCE.indexOf("case 'autosave':"),
      SOURCE.indexOf("case 'rename':"),
    );
    expect(updateBlock).not.toMatch(/commercial_industrial_calculation_runs/);
    expect(updateBlock).not.toMatch(/current_calculation_id/);
  });
});
