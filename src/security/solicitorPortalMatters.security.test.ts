import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/solicitor-portal-matters/index.ts'),
  'utf8',
);
const sharedSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/_shared/legalMatters.ts'),
  'utf8',
);

describe('solicitor portal matter list security contract', () => {
  /**
   * The scoping moved from client ids to matter ids.
   *
   * This asserted `.in('client_id', viewableClientIds)` twice. The function now
   * resolves `listAccessibleMatterIds(...)` — which reads
   * `solicitor_matter_access` under the matter-access-v1 flag and falls back to
   * the assigned-client set otherwise — and filters `.in('id',
   * accessibleMatterIds)`. Narrower, not looser: it is the matters the
   * solicitor may see rather than every matter of every client they touch.
   * `can(matrix, 'matters', 'view')` still gates the client-level path.
   */
  it('scopes list and stats queries to the matters this solicitor may view', () => {
    expect(functionSource).toContain("can(matrix, 'matters', 'view')");
    expect(functionSource).toContain('listAccessibleMatterIds(');
    expect(functionSource.match(/\.in\('id', accessibleMatterIds\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(1);
    // And the firm boundary is still applied alongside it.
    expect(functionSource).toContain(".eq('firm_id', me.firm_id)");
  });

  it('keeps the reduced list projection free of staff-only and detail fields', () => {
    const projection = sharedSource.match(
      /export const SOLICITOR_MATTER_LIST_SELECT = `([\s\S]*?)`;/,
    )?.[1];
    expect(projection).toBeTruthy();
    expect(projection).not.toMatch(
      /internal_notes|risk_notes|shared_summary|purchase_price|deposit_amount|title_reference|pexa_workspace_id/,
    );
  });

  /**
   * `list_matters` returns the minimal projection, and the wide one is gone
   * from this function.
   *
   * `SOLICITOR_MATTER_LIST_SELECT` — twelve columns — was referenced by nothing
   * but this file for as long as it existed: the constant and its test arrived
   * in the same merge (PR #2085) and it was never adopted, so `list_matters`
   * selected the 38-column shared contract and every page of every matter list
   * carried `purchase_price`, `deposit_amount`, `deposit_percent`,
   * `title_reference`, `pexa_workspace_id`, `risk_notes` and `shared_summary`.
   *
   * Adopting it needed one scoped read, not two. The blocker recorded here was
   * that `SolicitorDashboard` renders `risk_notes` and `SolicitorPipeline` sums
   * `purchase_price` — but the pipeline board is served by
   * `solicitor-portal-intelligence` (`pipeline_board`, `MATTER_SELECT`), a
   * different function this projection does not touch. Only the dashboard's
   * flagged strip was affected, and it now reads `list_flagged_matters`, which
   * returns `risk_notes` for `risk_flag = true` matters alone under the same
   * matter-access and firm scoping. Every field either surface renders is
   * asserted below against the two projections, so narrowing one of them
   * without moving the surface breaks here.
   */
  it('serves list_matters from the minimal projection and risk notes from a flagged-only read', () => {
    expect(functionSource).toContain('.select(SOLICITOR_MATTER_LIST_SELECT, { count: \'exact\' })');
    expect(functionSource).not.toContain('LEGAL_MATTER_SOLICITOR_LIST_SELECT,');

    // The flagged read is narrower in rows than the list it came out of.
    expect(functionSource).toContain("operation === 'list_flagged_matters'");
    expect(functionSource).toContain('.select(SOLICITOR_MATTER_RISK_SELECT)');
    expect(functionSource).toContain(".eq('risk_flag', true)");
    // …and no looser in which matters it will return.
    const flagged = functionSource.slice(functionSource.indexOf("operation === 'list_flagged_matters'"));
    expect(flagged).toContain(".in('id', accessibleMatterIds)");
    expect(flagged).toContain(".eq('firm_id', me.firm_id)");
  });

  it('keeps both list projections free of financial and conveyancing columns', () => {
    const forbidden = /purchase_price|deposit_amount|deposit_percent|title_reference|pexa_workspace_id|shared_summary|internal_notes/;
    for (const name of ['SOLICITOR_MATTER_LIST_SELECT', 'SOLICITOR_MATTER_RISK_SELECT']) {
      const projection = sharedSource.match(
        new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`),
      )?.[1];
      expect(projection, name).toBeTruthy();
      expect(projection, name).not.toMatch(forbidden);
    }
    // `risk_notes` is the one column that separates them, and it is only in the
    // flagged read.
    const list = sharedSource.match(/export const SOLICITOR_MATTER_LIST_SELECT = `([\s\S]*?)`;/)?.[1];
    const risk = sharedSource.match(/export const SOLICITOR_MATTER_RISK_SELECT = `([\s\S]*?)`;/)?.[1];
    expect(list).not.toMatch(/risk_notes/);
    expect(risk).toMatch(/risk_notes/);
  });

  /**
   * What the two surfaces render has to stay inside what the reads return.
   *
   * The minimal projection is an exact fit for the matters list today, which
   * makes it easy to break by adding one column to a page rather than to a
   * contract — an unselected column comes back `undefined`, which renders as an
   * empty cell rather than an error.
   */
  it('covers every matter field the list surfaces render', () => {
    const listPage = readFileSync(resolve(process.cwd(), 'src/pages/solicitor/SolicitorMatters.tsx'), 'utf8');
    const dashboard = readFileSync(resolve(process.cwd(), 'src/pages/solicitor/SolicitorDashboard.tsx'), 'utf8');
    const listProjection = sharedSource.match(/export const SOLICITOR_MATTER_LIST_SELECT = `([\s\S]*?)`;/)?.[1] ?? '';
    const riskProjection = sharedSource.match(/export const SOLICITOR_MATTER_RISK_SELECT = `([\s\S]*?)`;/)?.[1] ?? '';

    // `client_name` is joined onto the row by the function; the rest are columns.
    const rendered = new Set(
      [...listPage.matchAll(/\bm\.([a-z_]+)/g), ...dashboard.matchAll(/\bm\.([a-z_]+)/g)]
        .map((match) => match[1])
        .filter((field) => field !== 'client_name'),
    );
    // formatPropertyAddress(m) reads four columns without naming them here.
    for (const field of ['property_address', 'property_suburb', 'property_state', 'property_postcode']) {
      rendered.add(field);
    }
    expect(rendered.size).toBeGreaterThan(0);
    for (const field of rendered) {
      expect(`${listProjection} ${riskProjection}`, `${field} is rendered but not selected`)
        .toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
