/**
 * The open-data sales register is wired into the grade — pinned at the
 * source, because the generator runs only against Perplexity, the cadastre
 * and the database.
 *
 * What is pinned is the rule, not a number: the register is consulted beside
 * Domain (after it, so Domain's suburb series is the incumbent a coarser
 * point has to beat), asked only for the cadastre's council or the boundary
 * service's postcode, merged per measure with the finer point winning, and
 * named in the growth gap so an operator reading "grade withheld" is sent to
 * the loader rather than only to Domain's portal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const GENERATOR = read('supabase', 'functions', 'generate-investment-report', 'index.ts');
const SCORING = read('supabase', 'functions', '_shared', 'reports', 'market', 'scoringV2Production.pure.ts');
const LOADER = read('supabase', 'functions', 'market-sales-ingest', 'index.ts');
const CONFIG = read('supabase', 'config.toml');
const MIGRATION_2 = readFileSync(join(ROOT, 'supabase/migrations/20261126090000_market_sales_medians_national.sql'), 'utf8');
const MIGRATION = read('supabase', 'migrations', '20261125090000_market_sales_medians.sql');
const EVIDENCE = read('supabase', 'functions', '_shared', 'reports', 'market', 'marketEvidence.pure.ts');

describe('the generator consults the register beside Domain', () => {
  const block = GENERATOR.slice(GENERATOR.indexOf('const registerSources = salesRegisterSourcesFor(marketState);'));
  const registerBlock = block.slice(0, block.indexOf('// Population growth'));

  it('asks after Domain and before the population driver, inside the market-evidence block', () => {
    const domainAt = GENERATOR.indexOf("providersConsulted.push('domain');");
    const registerAt = GENERATOR.indexOf('const registerSources = salesRegisterSourcesFor(marketState);');
    const populationAt = GENERATOR.indexOf('populationGrowthPoint(erpSeries');
    expect(domainAt).toBeGreaterThan(0);
    expect(registerAt).toBeGreaterThan(domainAt);
    expect(populationAt).toBeGreaterThan(registerAt);
  });

  it('asks finest grain first — the trusted suburb, the cadastre\'s council, the trusted postcode, then the state floor — never a typed suburb or a parsed token', () => {
    expect(registerBlock).toContain("enhancedData.planningData?.parcel?.status === 'ok'");
    expect(registerBlock).toContain("registerSource.areaKind === 'suburb' ? marketSuburb");
    expect(registerBlock).toContain("registerSource.areaKind === 'lga' ? cadastreLga");
    expect(registerBlock).toContain("registerSource.areaKind === 'postcode' ? marketPostcode");
    expect(registerBlock).toContain(': marketState;');
    // the floor is read only where nothing finer answered
    expect(registerBlock).toContain('if (registerAnswered) break;');
    expect(registerBlock).not.toMatch(/area:\s*suburb\b/);
    expect(registerBlock).not.toContain('propertyAddress.match');
    expect(registerBlock).not.toContain('propertyDetails.suburb');
  });

  it('records the provider as consulted, and as unavailable with the reason when nothing answers', () => {
    expect(registerBlock).toContain('providersConsulted.push(registerSource.provider);');
    expect(registerBlock).toContain('providersUnavailable.push({ provider: registerSource.provider, reason: registerNotes.join');
    expect(registerBlock).toContain("the geography resolved to no suburb");
    expect(registerBlock).toContain('load it with market-sales-ingest');
  });

  it('merges per measure so a finer, dwelling-matched point wins whichever provider it came from', () => {
    expect(registerBlock).toContain('mergeEvidence(registerSubject, [held, offered])');
    expect(registerBlock).toContain('for (const key of EVIDENCE_KEYS)');
    expect(registerBlock).not.toContain('Object.assign(marketPoints, answer.points)');
  });

  it('reads the register through the one read helper and the one adapter', () => {
    expect(GENERATOR).toContain("import { readSalesRegister } from '../_shared/reports/market/salesRegisterRead.ts';");
    expect(GENERATOR).toContain("import { openDataSalesPoints, salesRegisterSourcesFor } from '../_shared/reports/market/openDataSalesEvidence.pure.ts';");
  });
});

describe('the growth gap names the register', () => {
  it('sends an operator to the loader as well as to Domain', () => {
    const remedy = SCORING.slice(SCORING.indexOf("case 'growth':"), SCORING.indexOf("case 'demand':"));
    expect(remedy).toContain('market-sales-ingest');
    expect(remedy).toContain('OPEN_DATA_GROWTH_EVIDENCE.md');
    expect(remedy).toContain('DOMAIN_ACTIVATION_REQUEST.md');
  });
});

describe('the loader and its declarations', () => {
  it('is declared to the gateway and the security registry', () => {
    expect(CONFIG).toMatch(/\[functions\.market-sales-ingest\]\s*\nverify_jwt = true/);
    const registry = JSON.parse(read('supabase', 'functions-registry', 'SECURITY_REGISTRY.json'));
    expect(registry.functions['market-sales-ingest']).toMatchObject({ verify_jwt: true, exposure_class: 'internal-service', reviewed: true });
  });

  it('authorises through verifyAuth and discovers the workbooks from the publishers\' pages, never a pinned dated file', () => {
    expect(LOADER).toContain('verifyAuth(supabase, req.headers, body)');
    expect(LOADER).toContain('discoverQgsoRldaSpreadsheet(page)');
    expect(LOADER).toContain('dcjSalesLinks(current + previous)');
    expect(LOADER).not.toMatch(/all-monitored-regions-\d{8}\.xlsx/);
    expect(LOADER).not.toMatch(/sales-tables-[a-z]+-\d{4}/);
    // the archived series are discovered from the archive's index, never a pinned capture
    expect(LOADER).toContain('archiveIndex(VIC_VPSR_ARCHIVE_PATTERN');
    expect(LOADER).toContain('archiveIndex(SA_LSG_ARCHIVE_PATTERN, SA_LSG_ARCHIVE_FLOOR)');
    expect(LOADER).not.toMatch(/web\.archive\.org\/web\/\d{14}/);
    expect(LOADER).toContain("stage === 'abs'");
    expect(LOADER).toContain("stage === 'vic'");
    expect(LOADER).toContain("stage === 'sa'");
    // one heavy workbook per invocation
    expect(LOADER).toContain('choice.chosen.slice(0, 1)');
  });

  it('refuses rather than stores, and writes only its registers and its log', () => {
    expect(LOADER).toContain('parseQgsoRldaSales(sheets); // throws → nothing written');
    expect(LOADER).toMatch(/\.from\('market_sales_medians'\)/);
    expect(LOADER).toMatch(/\.from\('market_sales_sync'\)/);
    /*
     * The containment rule, widened DELIBERATELY and once.
     *
     * This assertion is why the rule works: adding the `approvals` stage
     * failed it in CI, because that stage writes a second register. The set
     * is exhaustive on purpose — a loader that quietly gains a table is how a
     * function's blast radius grows without anybody deciding it should — so
     * the fix is to name the new table here rather than to relax the shape of
     * the check.
     *
     * Two registers and one log, and the log is shared: `market_sales_sync`
     * carries a row per run of every stage, approvals included, so an
     * operator reads one table to see what this function did.
     */
    const tables = [...LOADER.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set([
      'market_sales_medians',
      'market_building_approvals',
      'market_sales_sync',
    ]));
  });

  it('the approvals stage discovers its dataflow and refuses before it writes', () => {
    // The stage that failed the assertion above, asserted rather than assumed.
    expect(LOADER).toContain("stage === 'approvals'");
    /*
     * Discovery precedes the data query, asserted INSIDE the stage rather
     * than over the whole file. The read-only `probe` stage calls the same
     * two functions earlier in the module, so a first-occurrence ordering
     * over `LOADER` measures the probe and not this — which is what the
     * first version of this assertion did, and it failed for that reason
     * rather than because the stage was wrong.
     */
    const from = LOADER.indexOf("if (stage === 'approvals') {");
    const to = LOADER.indexOf("if (stage === 'vic') {", from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const STAGE = LOADER.slice(from, to);
    const at = (needle: string) => {
      const i = STAGE.indexOf(needle);
      expect(i, `${needle} is not in the approvals stage`).toBeGreaterThan(-1);
      return i;
    };
    expect(at('resolveBuildingApprovalsFlow(')).toBeGreaterThan(at('ABS_BA_DATAFLOW_CATALOGUE_URL'));
    // The structure is read between the flow and the query, because the key
    // is composed from it. Both URL builders are present — `all` is the
    // fallback when the structure cannot be read — so the ordering is
    // asserted against the COMPOSITION rather than against either builder.
    expect(at('absDataStructureUrl(')).toBeGreaterThan(at('resolveBuildingApprovalsFlow('));
    expect(at('composeApprovalsKey(')).toBeGreaterThan(at('absDataStructureUrl('));
    expect(at('narrowedApprovalsUrl(')).toBeGreaterThan(at('composeApprovalsKey('));
    expect(at('absBuildingApprovalsUrl(')).toBeGreaterThan(at('composeApprovalsKey('));
    expect(at('parseAbsBuildingApprovals(')).toBeGreaterThan(at('narrowedApprovalsUrl('));
    expect(at('upsertApprovals(')).toBeGreaterThan(at('parseAbsBuildingApprovals('));
    // No dataflow identifier is spelled in the loader: it comes from the
    // catalogue or from an operator override checked against the catalogue.
    expect(LOADER).not.toMatch(/'ABS,[A-Z0-9_]+,\d/);
    // Nor is a KEY spelled here. A positional key typed from memory returns a
    // plausible, wrong slice under an HTTP 200, which is the mistyped-column
    // failure with a success code in front of it.
    expect(STAGE).not.toMatch(/['"`][A-Z0-9_+]*\.[A-Z0-9_+]*\.[A-Z0-9_+]*['"`]/);
  });

  it('the approvals stage reads ONE page and learns the frontier from the register', () => {
    const from = LOADER.indexOf("if (stage === 'approvals') {");
    const STAGE = LOADER.slice(from, LOADER.indexOf("if (stage === 'vic') {", from));
    /*
     * Measured: SA2 narrowed is 111.6 MB over 33 months and 12.2 MB over 6,
     * against a 24 MB budget — so a full load is several requests, the shape
     * this loader has used since five DCJ workbooks exhausted an edge
     * worker's compute allowance.
     */
    expect(STAGE).toContain('approvalsPage(');
    // The frontier is READ, never assumed: the ABS publishes with a lag and
    // a constant for it is one nobody here can verify.
    expect(STAGE).toMatch(/from\('market_building_approvals'\)[\s\S]{0,200}order\('period'/);
    expect(STAGE).toContain('frontier');
    // And the page is judged against the window it asked for.
    expect(STAGE).toMatch(/minPeriods: window\.minPeriods/);
    // What remains is reported rather than left to be worked out.
    expect(STAGE).toContain('pages_remaining');
  });

  it('a structure it cannot read costs the approvals stage nothing', () => {
    const from = LOADER.indexOf("if (stage === 'approvals') {");
    const STAGE = LOADER.slice(from, LOADER.indexOf("if (stage === 'vic') {", from));
    // The narrowing is an optimisation, never a dependency: the fallback is
    // the `/all` request that shipped, so this can only improve a load or
    // leave it alone. A refusal here would take the register down to save
    // bytes, which is the wrong trade in both directions.
    expect(STAGE).toMatch(/catch \(error\) \{[\s\S]*?key: 'all'/);
    expect(STAGE).toContain("keyNarrowing.key === 'all'");
    // And what could not be narrowed is recorded, because an unnarrowed
    // dimension is a silently bigger download.
    expect(STAGE).toContain('key_unnarrowed');
  });

  it('the register keeps a suppressed median as null and keys a quarter by its end month', () => {
    expect(MIGRATION).toContain('primary key (state, area_kind, area, dwelling_type, period)');
    // me9.sales.2: the span joins the key, the measure and the capture travel on the row
    expect(MIGRATION_2).toContain('add primary key (state, area_kind, area, dwelling_type, period, period_span)');
    expect(MIGRATION_2).toContain("check (price_measure in ('median', 'mean'))");
    expect(MIGRATION_2).toContain("check (period_span in ('quarter', 'year'))");
    expect(MIGRATION_2).toContain("check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'AU'))");
    expect(MIGRATION_2).toContain('add column if not exists captured_at timestamptz');
    // The conflict target is the full natural key including the span. It is a
    // named constant now rather than a literal at the call site, because the
    // upsert sends two differently-shaped batches through it.
    expect(LOADER).toContain("'state,area_kind,area,dwelling_type,period,period_span'");
    expect(LOADER).toMatch(/onConflict:\s*CONFLICT/);
  });

  it('never erases a sales count it cannot restate', () => {
    /*
     * Victoria's and South Australia's sheets print ONE `No. of Sales`
     * column — the latest quarter's — so their parsers emit `salesCount:
     * null` on every other row. PostgREST writes `ON CONFLICT DO UPDATE SET`
     * for each column the payload names, so one payload for every record
     * rewrote every historical count back to null on every daily run.
     *
     * `scoreTransactionVolume` needs four periods carrying a count, so those
     * two states could never hold more than one and transaction volume — the
     * only PRIMARY demand measure this deployment is entitled to — was
     * structurally unmeasurable there. The 9 Hollow Street Compass of
     * 20 Sep 2026 scored Demand on nothing; 1 Crestview Avenue and 97 Poole
     * Road, both NSW, scored it 27 from a 3-period average.
     *
     * A record with no count is written WITHOUT the column, which leaves what
     * is stored standing. The two shapes cannot share a batch.
     */
    expect(LOADER).toMatch(/sales_count !== null/);
    expect(LOADER).toMatch(/sales_count: _dropped, \.\.\.rest/);
    expect(LOADER, 'the two shapes must be sent separately')
      .toMatch(/withCount[\s\S]{0,120}withoutCount/);
    expect(MIGRATION).toContain("check (period ~ '^[0-9]{4}-(03|06|09|12)$')");
    expect(MIGRATION).toContain('median_price numeric check (median_price is null or median_price > 0)');
    expect(MIGRATION).toContain('enable row level security');
  });

  it('the two registers are providers the evidence vocabulary knows', () => {
    expect(EVIDENCE).toContain("| 'qld_qgso_rlda'");
    expect(EVIDENCE).toContain("| 'nsw_dcj_rent_sales'");
    expect(EVIDENCE).toContain("| 'vic_vpsr_suburb'");
    expect(EVIDENCE).toContain("| 'sa_lsg_suburb'");
    expect(EVIDENCE).toContain("| 'abs_res_dwell'");
  });
});
