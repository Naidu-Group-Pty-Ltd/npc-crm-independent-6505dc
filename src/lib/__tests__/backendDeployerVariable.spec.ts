/**
 * Who deploys this repository's Supabase project, and the literal that says so.
 *
 * The deploy workflow stands down — green, with an explanation, instead of a
 * hard failure — only when the repository variable `BACKEND_DEPLOYED_BY` says
 * `mission-control`. Mission Control writes that variable at provisioning
 * (`github-variables.server.ts`), and neither repository can read the other's
 * source, so the value is a literal at each end. This is the half that lives
 * here: change the workflow's accepted value and this fails, rather than every
 * clone's deploy check quietly going red again with no explanation.
 *
 * The stand-down is deliberately a POSITIVE assertion. "No token is set" and
 * "something else deploys this" look identical from inside a workflow, and
 * only one of them is safe to be quiet about — this workflow's own header
 * records what the quiet version cost: two debug cycles on a green check over
 * code that had never shipped.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/deploy-supabase-functions.yml'),
  'utf8'
);

describe('the deploy workflow names its alternative deployer', () => {
  it('accepts exactly the value Mission Control writes', () => {
    expect(workflow).toContain('DEPLOYER: ${{ vars.BACKEND_DEPLOYED_BY }}');
    expect(workflow).toContain('if [ "${DEPLOYER:-}" = "mission-control" ]; then');
  });

  it('still fails when nothing says who deploys', () => {
    // The gate this file is about must never become "no token, therefore
    // fine". An unset variable, and an unrecognised one, both leave the job
    // red — which is the state that tells somebody the functions did not ship.
    expect(workflow).toContain("steps.gate.outputs.elsewhere != 'true'");
    expect(workflow).toContain('Fail when there is something to deploy and no credential');
  });

  it('never carries a Supabase access token of its own', () => {
    /*
      A Supabase personal access token carries every permission on every
      project the account can reach, including projects created later. Sealing
      one into each clone repository — the obvious fix for "CI cannot deploy" —
      would put fleet-wide database administration in every clone. The workflow
      may READ a token a tenant chose to set; it must never ship one.
    */
    expect(workflow).not.toMatch(/SUPABASE_ACCESS_TOKEN:\s*sbp_/);
    expect(workflow).toContain('${{ secrets.SUPABASE_ACCESS_TOKEN }}');
  });
});
