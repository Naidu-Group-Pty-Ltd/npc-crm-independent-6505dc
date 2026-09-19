/**
 * Compose the Demographics & Demand Drivers statistics blocks from the real
 * data in hand — the tables the generator prompt used to template with
 * placeholders and wrong labels.
 *
 * What this replaces, recorded because each defect was live:
 *
 *  - **Fixed industry rows.** The prompt hard-coded "Professional Services"
 *    as row one and "Construction" as row five for every suburb in the
 *    country, then filled them from `industries[0..4]` — so whatever
 *    industry actually ranked first wore whatever name the template put
 *    there. Rows are now written from the measured list, sorted by
 *    employment.
 *  - **"ABS (2025)" on everything.** The vintage is the data's own
 *    `referencePeriod`, rendered as `ABS Census 2021 (POA)` — a figure must
 *    never wear a date it does not have.
 *  - **A growth column with no source.** Per-industry growth, income growth
 *    and the 1/3/5-year job-growth table had no integrated source; a column
 *    that cannot be filled is a column omitted, and the model is told
 *    explicitly not to assert growth figures nothing measured.
 *  - **Rating fallbacks that asserted.** `seifaData?.irsad?.rating ||
 *    'Moderate Advantage'` printed a socio-economic judgement precisely when
 *    there was no data behind it.
 *
 * Law 2 applies throughout: a labelled row is a promise that a figure
 *  follows it — absent means the row is omitted, and a whole block with
 * nothing to say says so in one honest line instead of a table of
 * placeholders.
 *
 * Pure: no Deno, no network; used by `generate-investment-report` and under
 * test from vitest.
 */

interface NumericishBlock { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const fmtInt = (v: number) => v.toLocaleString('en-AU');
const fmtMoney = (v: number) => `$${v.toLocaleString('en-AU')}`;

/** `ABS Census 2021 (POA)` from whatever the service stamped, else a safe generic. */
function vintageLabel(block: NumericishBlock | undefined): string {
  const ref = str(block?.['referencePeriod']);
  return ref ? `ABS Census ${ref} (POA)` : 'ABS Census (POA)';
}

/** A markdown table from [label, value, source] rows; empty string when no row has a figure. */
function table(header: string[], rows: Array<string[] | null>): string {
  const kept = rows.filter((r): r is string[] => r !== null);
  if (kept.length === 0) return '';
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '-------').join('|')}|`,
    ...kept.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

export interface DemographicsPromptInput {
  demographics?: {
    employment?: NumericishBlock;
    income?: NumericishBlock;
    population?: NumericishBlock;
  };
  seifaData?: NumericishBlock;
  employmentData?: NumericishBlock;
}

/** The "Population & Employment Statistics" table, from real figures only. */
export function populationEmploymentTable(input: DemographicsPromptInput): string {
  const emp = input.demographics?.employment ?? {};
  const inc = input.demographics?.income ?? {};
  const pop = input.demographics?.population ?? {};
  const src = vintageLabel(emp['referencePeriod'] ? emp : inc);

  const rows: Array<string[] | null> = [
    num(pop['total']) !== null ? ['Population (usual residents)', fmtInt(num(pop['total'])!), src] : null,
    num(emp['laborForce']) !== null ? ['Labour Force Size', fmtInt(num(emp['laborForce'])!), src] : null,
    num(emp['employmentRate']) !== null ? ['Employment Rate (of labour force)', `${num(emp['employmentRate'])}%`, src] : null,
    num(inc['unemploymentRate']) !== null ? ['Unemployment Rate', `${num(inc['unemploymentRate'])}%`, src] : null,
    num(emp['laborForceParticipation']) !== null ? ['Participation Rate', `${num(emp['laborForceParticipation'])}%`, src] : null,
    num(inc['medianWeeklyIncome']) !== null ? ['Median Weekly Household Income', fmtMoney(num(inc['medianWeeklyIncome'])!), src] : null,
    num(inc['medianHouseholdIncome']) !== null
      ? ['Median Annual Household Income (annualised from weekly)', fmtMoney(num(inc['medianHouseholdIncome'])!), src]
      : null,
    num(inc['medianAge']) !== null ? ['Median Age', String(num(inc['medianAge'])), src] : null,
  ];
  return table(['Metric', 'Value', 'Data Source'], rows);
}

/** The SEIFA table — score, decile, and the index's real description. */
export function seifaTable(input: DemographicsPromptInput): string {
  const s = input.seifaData ?? {};
  const ref = str(s['referencePeriod']);
  const idx = (key: string, label: string): string[] | null => {
    const block = s[key] as NumericishBlock | undefined;
    const score = num(block?.['score']);
    const decile = num(block?.['decile']);
    if (score === null || decile === null) return null;
    const description = str(block?.['description']) ?? label;
    return [label, String(Math.round(score)), `${decile}/10`, description];
  };
  const body = table(
    ['Index', 'Score', 'Decile', 'Description'],
    [
      idx('irsad', 'IRSAD'),
      idx('irsd', 'IRSD'),
      idx('ier', 'IER'),
      idx('ieo', 'IEO'),
    ],
  );
  if (!body) return '';
  return `${body}\n\nSource: ABS SEIFA ${ref ?? ''} (POA). Decile 10 = most advantaged, decile 1 = most disadvantaged.`.replace('  ', ' ');
}

/** The industry table — real names, measured shares, largest first, no growth column. */
export function industryTable(input: DemographicsPromptInput): string {
  const industries = (input.employmentData?.['majorIndustries'] ?? input.demographics?.employment?.['topIndustries']) as
    | Array<{ name?: unknown; percentage?: unknown }>
    | undefined;
  if (!Array.isArray(industries)) return '';
  const rows: Array<string[] | null> = industries.slice(0, 5).map((i) => {
    const name = str(i?.name);
    const pct = num(i?.percentage);
    return name && pct !== null ? [name, `${pct}%`] : null;
  });
  return table(['Industry', 'Workforce %'], rows);
}

/**
 * The whole statistics block for the Demographics section of the prompt.
 * When nothing is available, one honest line replaces the tables — a visible
 * absence, never a grid of placeholders.
 */
export function demographicsStatBlocks(input: DemographicsPromptInput): string {
  const parts: string[] = [];
  const popEmp = populationEmploymentTable(input);
  const seifa = seifaTable(input);
  const industries = industryTable(input);

  if (popEmp) parts.push('**Population & Employment Statistics:**\n\n' + popEmp);
  if (seifa) parts.push('**Socioeconomic Profile (SEIFA Indices):**\n\n' + seifa);
  if (industries) parts.push('**Employment & Industry Breakdown:**\n\n' + industries);

  if (parts.length === 0) {
    return 'Local demographic, socio-economic and industry statistics are unavailable for this postal area. State that plainly in one sentence; do not estimate or invent figures for this section.';
  }

  parts.push(
    'No employment or income time-series is integrated for this area: do NOT assert job-growth, income-growth or population-growth percentages. Discuss only the figures in the tables above, and attribute them to their stated source.',
  );
  return parts.join('\n\n');
}
