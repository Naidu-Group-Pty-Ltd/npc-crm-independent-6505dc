/**
 * Compose the population-trend statistics block from the measured regional
 * reading — the first real growth figures this product has served. Before
 * this, "population growth" in a report was whatever the model recalled:
 * the Census demographics tables carry 2021 levels and no trend, and the
 * prompt asked for growth commentary anyway.
 *
 * Rules:
 *  - every figure names the SA2 it was measured for (the ABS's own unit
 *    for regional population — the area containing the property, which may
 *    be named differently from the suburb) and the window it covers;
 *  - a growth row renders only where the reading holds that window (both
 *    endpoints measured) — law 2: a labelled row promises a figure;
 *  - unemployment gets no row and the instruction forbids inventing one
 *    until the SALM register is loaded;
 *  - with nothing measured, one honest line plus the no-invention
 *    instruction.
 */

interface Numericish { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const people = (v: number) => v.toLocaleString('en-AU');

export interface RegionalPromptInput {
  regionalTrends?: Numericish | null;
}

function growthRow(label: string, w: Numericish | null | undefined, source: string): string | null {
  const window = str(w?.['window']);
  const annual = num(w?.['annualPercent']);
  const change = num(w?.['changePeople']);
  const total = num(w?.['totalPercent']);
  if (!window || annual === null || change === null || total === null) return null;
  const direction = change >= 0 ? '+' : '';
  // Over one year the annual rate IS the total; repeating it is noise.
  const annualNote = annual === total
    ? `${direction}${total}%`
    : `${direction}${total}% (${annual}% a year)`;
  return `| ${label} (${window}) | ${direction}${people(change)} people, ${annualNote} | ${source} |`;
}

export function populationTrendBlock(input: RegionalPromptInput): string {
  const t = input.regionalTrends;
  const sa2 = t?.['sa2'] as Numericish | undefined;
  const pop = t?.['population'] as Numericish | undefined;
  const latest = pop?.['latest'] as Numericish | undefined;
  const sa2Name = str(sa2?.['name']);
  const latestYear = num(latest?.['year']);
  const latestErp = num(latest?.['erp']);
  if (!sa2Name || latestYear === null || latestErp === null) return '';

  const source = str(pop?.['source']) ?? 'ABS Regional population';
  const rows = [
    `| Population (estimated residents, 30 June ${latestYear}) | ${people(latestErp)} | ${source} |`,
    growthRow('1-year change', pop?.['oneYear'] as Numericish, source),
    growthRow('5-year change', pop?.['fiveYear'] as Numericish, source),
    growthRow('10-year change', pop?.['tenYear'] as Numericish, source),
  ].filter((r): r is string => r !== null);

  return [
    `**Measured population trend for the surrounding statistical area (SA2 "${sa2Name}" — the ABS area containing this property):**\n\n| Metric | Value | Source |\n|---|---|---|\n${rows.join('\n')}`,
  ].join('\n\n');
}

export function regionalTrendBlocks(input: RegionalPromptInput): string {
  const block = populationTrendBlock(input);
  if (block === '') {
    return 'No measured population trend is available for this property’s area. State that plainly in one sentence; ' +
      'do NOT assert a population figure, growth rate or unemployment rate for the area from memory.';
  }
  return [
    block,
    'Discuss only the measured figures above, naming the SA2 and the windows. The SA2 may cover more than the suburb — ' +
    'say "the surrounding area" where they differ. Do NOT state an unemployment rate, a population projection, or any ' +
    'growth figure not in the table, and do NOT extrapolate the trend beyond the measured windows.',
  ].join('\n\n');
}
