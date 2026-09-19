/**
 * Parse the ABS's published Postal-Area data into the platform's reference
 * rows — the ONE implementation, used by the `abs-poa-ingest` edge function
 * and by the tests.
 *
 * Sources (Australian Bureau of Statistics, CC BY 4.0):
 *  - 2021 Census GCP DataPack, POA level, Australia (short header). Column
 *    names below are transcribed from the pack's own
 *    `Metadata_2021_GCP_DataPack_R1_R2.xlsx` — never guessed. A wrong name
 *    here is not inert: it throws at parse, because Airtable-style silent
 *    undefined for a mistyped column is how this platform's worst defects
 *    stayed invisible.
 *  - SEIFA 2021 POA indexes workbook, Table 1. Its column order is
 *    **IRSD, IRSAD, IER, IEO** — verified against the header text at parse
 *    time, because the platform's old fabricated shape listed IRSAD first
 *    and assuming that order would swap advantage for disadvantage on every
 *    report.
 *
 * The verifier refuses rather than loads on anything implausible: a
 * zero-row parse, a POA count outside Australia's range, a national
 * population sum away from the 2021 Census's 25.42M, or a failed SEIFA
 * join. A truncated download or a wrong column dies here, not in a client's
 * report.
 *
 * Pure: no Deno, no network, no I/O — text in, rows out.
 */

/** ANZSIC industry divisions, in G54's own column order. */
export const INDUSTRY_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['P_Ag_For_Fshg_Tot', 'Agriculture, Forestry and Fishing'],
  ['P_Mining_Tot', 'Mining'],
  ['P_Manufact_Tot', 'Manufacturing'],
  ['P_El_Gas_Wt_Waste_Tot', 'Electricity, Gas, Water and Waste Services'],
  ['P_Constru_Tot', 'Construction'],
  ['P_WhlesaleTde_Tot', 'Wholesale Trade'],
  ['P_RetTde_Tot', 'Retail Trade'],
  ['P_Accom_food_Tot', 'Accommodation and Food Services'],
  ['P_Trans_post_wrehsg_Tot', 'Transport, Postal and Warehousing'],
  ['P_Info_media_teleco_Tot', 'Information Media and Telecommunications'],
  ['P_Fin_Insur_Tot', 'Financial and Insurance Services'],
  ['P_RtnHir_REst_Tot', 'Rental, Hiring and Real Estate Services'],
  ['P_Pro_scien_tec_Tot', 'Professional, Scientific and Technical Services'],
  ['P_Admin_supp_Tot', 'Administrative and Support Services'],
  ['P_Public_admin_sfty_Tot', 'Public Administration and Safety'],
  ['P_Educ_trng_Tot', 'Education and Training'],
  ['P_HlthCare_SocAs_Tot', 'Health Care and Social Assistance'],
  ['P_Art_recn_Tot', 'Arts and Recreation Services'],
  ['P_Oth_scs_Tot', 'Other Services'],
] as const;

/** ANZSCO major groups, in G60's own column order. */
export const OCCUPATION_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['P_Tot_Managers', 'Managers'],
  ['P_Tot_Professionals', 'Professionals'],
  ['P_Tot_TechnicTrades_W', 'Technicians and Trades Workers'],
  ['P_Tot_CommunPersnlSvc_W', 'Community and Personal Service Workers'],
  ['P_Tot_ClericalAdminis_W', 'Clerical and Administrative Workers'],
  ['P_Tot_Sales_W', 'Sales Workers'],
  ['P_Tot_Mach_oper_drivers', 'Machinery Operators and Drivers'],
  ['P_Tot_Labourers', 'Labourers'],
] as const;

/** The GCP CSVs the ingest needs, and the columns it reads from each. */
export const GCP_TABLES: Readonly<Record<string, readonly string[]>> = {
  G01: ['Tot_P_P'],
  G02: [
    'Median_age_persons', 'Median_mortgage_repay_monthly', 'Median_tot_prsnl_inc_weekly',
    'Median_rent_weekly', 'Median_tot_fam_inc_weekly', 'Median_tot_hhd_inc_weekly', 'Average_household_size',
  ],
  G37: ['O_OR_Total', 'O_MTG_Total', 'R_Tot_Total', 'Total_Total'],
  G46B: ['P_Tot_Emp_Tot', 'P_Tot_Unemp_Tot', 'P_Tot_LF_Tot', 'P_Not_in_LF_Tot', 'P_Tot_Tot'],
  G54C: INDUSTRY_COLUMNS.slice(0, 18).map(([c]) => c),
  G54D: [INDUSTRY_COLUMNS[18][0], 'P_Tot_Tot'],
  G60B: [...OCCUPATION_COLUMNS.map(([c]) => c), 'P_Tot_Tot'],
} as const;

export interface IndustryShare { name: string; employed: number; percentage: number | null }

export interface CensusPoaRow {
  poa: string;
  population: number | null;
  median_age: number | null;
  median_rent_weekly: number | null;
  median_hh_income_weekly: number | null;
  median_personal_income_weekly: number | null;
  median_family_income_weekly: number | null;
  median_mortgage_monthly: number | null;
  avg_household_size: number | null;
  owned_outright: number | null;
  owned_mortgage: number | null;
  rented: number | null;
  tenure_total: number | null;
  owner_occupier_rate: number | null;
  renter_rate: number | null;
  employed: number | null;
  unemployed: number | null;
  labour_force: number | null;
  not_in_labour_force: number | null;
  pop_15_plus: number | null;
  unemployment_rate: number | null;
  participation_rate: number | null;
  employment_to_pop_rate: number | null;
  industries: IndustryShare[];
  occupations: IndustryShare[];
}

export interface SeifaPoaRow {
  poa: string;
  irsd_score: number | null; irsd_decile: number | null;
  irsad_score: number | null; irsad_decile: number | null;
  ier_score: number | null; ier_decile: number | null;
  ieo_score: number | null; ieo_decile: number | null;
  usual_resident_population: number | null;
  caution: boolean;
  crosses_state: boolean;
}

/** Parse one short-header GCP CSV into POA -> {column: number|null}. */
export function parseGcpCsv(text: string, wantedColumns: readonly string[]): Map<string, Record<string, number | null>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('GCP CSV has no data rows');
  const header = lines[0].split(',');
  const idx = new Map<string, number>();
  for (const col of wantedColumns) {
    const i = header.indexOf(col);
    if (i === -1) throw new Error(`column ${col} not found in CSV header (${header.slice(0, 4).join(',')}…)`);
    idx.set(col, i);
  }
  const out = new Map<string, Record<string, number | null>>();
  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split(',');
    const poa = (cells[0] ?? '').replace(/^POA/, '');
    if (!/^\d{4}$/.test(poa)) continue; // POAs are four digits; anything else is furniture
    const row: Record<string, number | null> = {};
    for (const [col, i] of idx) {
      const raw = (cells[i] ?? '').trim();
      if (raw === '') { row[col] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`non-numeric value "${raw}" for ${col} at POA ${poa}`);
      row[col] = n;
    }
    out.set(poa, row);
  }
  if (out.size === 0) throw new Error('GCP CSV parsed to zero POAs — refusing');
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
/** A rate is only computed over a real denominator; small-area noise stays visible via the counts. */
const rate = (num: number | null | undefined, den: number | null | undefined): number | null =>
  den != null && den > 0 && num != null ? round1((num / den) * 100) : null;

/**
 * SEIFA Table 1, handed over as an array-of-arrays exactly as the sheet
 * reads (row 5 = index-group header, row 6 = column header, data from row
 * 7). The order check is the point: refuse to load rather than mislabel
 * advantage as disadvantage.
 */
export function parseSeifaTable1(aoa: ReadonlyArray<ReadonlyArray<unknown>>): SeifaPoaRow[] {
  const groupHeader = aoa[4] ?? [];
  const first = String(groupHeader[1] ?? '').trim();
  const second = String(groupHeader[3] ?? '').trim();
  if (!/Disadvantage$/.test(first) || !/Advantage and Disadvantage$/.test(second)) {
    throw new Error(
      `SEIFA Table 1 column order is not IRSD,IRSAD as expected — got "${first}" / "${second}". Refusing.`,
    );
  }
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
    return Number.isFinite(n) ? n : null;
  };
  const out: SeifaPoaRow[] = [];
  for (let i = 6; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const poa = String(row[0] ?? '').trim();
    if (!/^\d{4}$/.test(poa)) continue;
    const score = (v: unknown) => { const n = num(v); return n === null ? null : round1(n); };
    out.push({
      poa,
      irsd_score: score(row[1]), irsd_decile: num(row[2]),
      irsad_score: score(row[3]), irsad_decile: num(row[4]),
      ier_score: score(row[5]), ier_decile: num(row[6]),
      ieo_score: score(row[7]), ieo_decile: num(row[8]),
      usual_resident_population: num(row[9]),
      caution: String(row[10] ?? '').trim() !== '',
      crosses_state: String(row[11] ?? '').trim() !== '',
    });
  }
  if (out.length === 0) throw new Error('SEIFA parsed to zero POAs — refusing');
  return out;
}

/**
 * Assemble the census rows alone — the ingest runs in stages because the
 * edge worker's memory cannot hold the DataPack, the SEIFA workbook model
 * and the assembled rows at once (the single-pass version died at
 * WORKER_RESOURCE_LIMIT on its first invocation). The SEIFA join check
 * moves to `checkSeifaCoverage`, fed with the keys already loaded.
 */
export function assembleCensusRows(
  gcp: Readonly<Record<string, Map<string, Record<string, number | null>>>>,
): CensusPoaRow[] {
  const g01 = gcp['G01'], g02 = gcp['G02'], g37 = gcp['G37'], g46b = gcp['G46B'],
    g54c = gcp['G54C'], g54d = gcp['G54D'], g60b = gcp['G60B'];
  for (const [name, table] of Object.entries({ g01, g02, g37, g46b, g54c, g54d, g60b })) {
    if (!table) throw new Error(`GCP table ${name.toUpperCase()} missing from input`);
  }

  const census: CensusPoaRow[] = [];
  for (const [poa, p] of g01) {
    const m = g02.get(poa) ?? {};
    const t = g37.get(poa) ?? {};
    const l = g46b.get(poa) ?? {};
    const i1 = g54c.get(poa) ?? {};
    const i2 = g54d.get(poa) ?? {};
    const o = g60b.get(poa) ?? {};

    const employedTotal = i2['P_Tot_Tot'] ?? null;
    const industries: IndustryShare[] = [];
    for (const [col, name] of INDUSTRY_COLUMNS) {
      const employed = (col in i1 ? i1[col] : i2[col]) ?? null;
      if (employed !== null) industries.push({ name, employed, percentage: rate(employed, employedTotal) });
    }
    const occTotal = o['P_Tot_Tot'] ?? null;
    const occupations: IndustryShare[] = [];
    for (const [col, name] of OCCUPATION_COLUMNS) {
      const employed = o[col] ?? null;
      if (employed !== null) occupations.push({ name, employed, percentage: rate(employed, occTotal) });
    }

    census.push({
      poa,
      population: p['Tot_P_P'] ?? null,
      median_age: m['Median_age_persons'] ?? null,
      median_rent_weekly: m['Median_rent_weekly'] ?? null,
      median_hh_income_weekly: m['Median_tot_hhd_inc_weekly'] ?? null,
      median_personal_income_weekly: m['Median_tot_prsnl_inc_weekly'] ?? null,
      median_family_income_weekly: m['Median_tot_fam_inc_weekly'] ?? null,
      median_mortgage_monthly: m['Median_mortgage_repay_monthly'] ?? null,
      avg_household_size: m['Average_household_size'] ?? null,
      owned_outright: t['O_OR_Total'] ?? null,
      owned_mortgage: t['O_MTG_Total'] ?? null,
      rented: t['R_Tot_Total'] ?? null,
      tenure_total: t['Total_Total'] ?? null,
      owner_occupier_rate: rate((t['O_OR_Total'] ?? 0) + (t['O_MTG_Total'] ?? 0), t['Total_Total']),
      renter_rate: rate(t['R_Tot_Total'], t['Total_Total']),
      employed: l['P_Tot_Emp_Tot'] ?? null,
      unemployed: l['P_Tot_Unemp_Tot'] ?? null,
      labour_force: l['P_Tot_LF_Tot'] ?? null,
      not_in_labour_force: l['P_Not_in_LF_Tot'] ?? null,
      pop_15_plus: l['P_Tot_Tot'] ?? null,
      unemployment_rate: rate(l['P_Tot_Unemp_Tot'], l['P_Tot_LF_Tot']),
      participation_rate: rate(l['P_Tot_LF_Tot'], l['P_Tot_Tot']),
      employment_to_pop_rate: rate(l['P_Tot_Emp_Tot'], l['P_Tot_Tot']),
      industries,
      occupations,
    });
  }

  // ── Refuse anything implausible before a single row is written ──────────
  const totalPersons = census.reduce((s, r) => s + (r.population ?? 0), 0);
  if (census.length < 2400 || census.length > 3200) {
    throw new Error(`POA row count ${census.length} outside the plausible range for Australia — refusing`);
  }
  // The 2021 Census counted 25,422,788 persons; POA coverage excludes a small
  // migratory/offshore remainder, so the sum must land beside it.
  if (totalPersons < 24_000_000 || totalPersons > 26_000_000) {
    throw new Error(`national population summed to ${totalPersons} — not the 2021 Census; refusing`);
  }
  return census;
}

/**
 * The cross-source sanity check, fed with whatever SEIFA keys are already
 * loaded: a census parse whose POAs do not overlap SEIFA's is joined on the
 * wrong key, and refusing here is what stops it being written.
 */
export function checkSeifaCoverage(census: CensusPoaRow[], seifaPoas: ReadonlySet<string>): number {
  const withSeifa = census.filter((r) => seifaPoas.has(r.poa)).length;
  if (withSeifa < 2000) {
    throw new Error(`only ${withSeifa} POAs matched SEIFA — the join key is wrong; refusing`);
  }
  return withSeifa;
}
