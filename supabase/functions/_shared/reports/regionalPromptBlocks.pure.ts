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
 *    instruction;
 *  - and the forward half carries a PERMITTED FORM rather than a bare
 *    prohibition — see `forwardDemandInstruction`.
 */
import { REGIONAL_WEB_SEARCH_RULE } from './registerAuthority.pure.ts';
import {
  forwardDemandCoverageNote,
  type ForwardDemandAvailability,
} from './market/openData/forwardDemand.pure.ts';
import {
  forwardDemandStatement,
  type ProjectionRegisterRead,
} from './market/openData/projectionRegister.pure.ts';
import { elsewhereOnly, inHomeSection } from './adviserVoice.pure.ts';

interface Numericish { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const people = (v: number) => v.toLocaleString('en-AU');

export interface RegionalPromptInput {
  regionalTrends?: Numericish | null;
  /**
   * The jurisdiction, so the forward-demand sentence can name its publisher.
   * Absent resolves to the unknown-jurisdiction wording, which states the
   * limit as this report's rather than as a finding about the area.
   */
  state?: string | null;
  /**
   * What this deployment holds by way of a PROJECTION, where a caller states
   * it without reading the register. Defaults to `not_read`: `not_loaded` was
   * the default while no register existed and was true everywhere, and it
   * stops being true for a caller that simply never asked the moment one
   * jurisdiction loads — the regeneration path is such a caller.
   */
  forwardDemand?: ForwardDemandAvailability | null;
  /**
   * What the register read returned for this property (`readProjectionRegister`).
   * A reading prints the publisher's own table, provenance and rules; an
   * absence prints its own sentence. Outranks `forwardDemand`, because it is
   * what was actually read.
   */
  forwardDemandProjection?: ProjectionRegisterRead | null;
}

function growthRow(label: string, w: Numericish | null | undefined, source: string): string | null {
  const window = str(w?.['window']);
  const annual = num(w?.['annualPercent']);
  const change = num(w?.['changePeople']);
  const total = num(w?.['totalPercent']);
  if (!window || annual === null || change === null || total === null) return null;
  const direction = change >= 0 ? '+' : '';
  // Over one year the annual rate IS the total; repeating it is noise. Over
  // several, the two are different statements and each is named as what it
  // is — `+1.62% (0.32% a year)` was read as "0.3% between 2020 and 2025" on
  // the Compass for 60 Lawley Street, Spalding (25 Sep 2026).
  const annualNote = annual === total
    ? `${direction}${total}%`
    : `${direction}${total}% in total (an average of ${annual}% a year)`;
  return `| ${label} (${window}) | ${direction}${people(change)} people, ${annualNote} | ${source} |`;
}

/**
 * How the table above is to be put into a sentence, shown rather than told.
 *
 * Measured on the Compass for 60 Lawley Street, Spalding (25 Sep 2026): the
 * table said `+198 people, +1.62% (0.32% a year)` for 2020 to 2025, and the
 * document said the population "increased by 0.3% between 2020 and 2025" on
 * one page, "0.3% … to June 2025" on another and "0.3% in the year to June
 * 2025" on a third — the yearly rate presented as the five-year change, and
 * then as a one-year one. Every figure was the register's; the sentences
 * disagreed with it and with each other. It also wrote "Geraldton's estimated
 * resident population" for an ABS statistical area whose boundary is not the
 * city's. A prohibition alone is what a model routes around, so the rule
 * carries the permitted form, composed from THIS reading's own figures.
 *
 * Returns '' where no multi-year window was measured — a one-year row has one
 * figure and nothing to confuse.
 */
export function populationWordingRule(input: RegionalPromptInput): string {
  const t = input.regionalTrends;
  const sa2Name = str((t?.['sa2'] as Numericish | undefined)?.['name']);
  const pop = t?.['population'] as Numericish | undefined;
  if (!sa2Name || !pop) return '';
  for (const key of ['fiveYear', 'tenYear']) {
    const w = pop[key] as Numericish | undefined;
    const window = str(w?.['window']);
    const annual = num(w?.['annualPercent']);
    const change = num(w?.['changePeople']);
    const total = num(w?.['totalPercent']);
    const years = window ? /^(\d{4})\s+to\s+(\d{4})$/.exec(window) : null;
    if (!years || annual === null || change === null || total === null || annual === total) continue;
    const span = Number(years[2]) - Number(years[1]);
    const verb = change >= 0 ? 'rose' : 'fell';
    const area = `the surrounding statistical area (ABS SA2 "${sa2Name}")`;
    return [
      `HOW TO STATE THE POPULATION FIGURES. A multi-year row carries two different numbers: the TOTAL change across `
      + `its window and the AVERAGE RATE A YEAR within it. Write the total with its window — "the population of ${area} `
      + `${verb} ${Math.abs(total)}% between ${years[1]} and ${years[2]}, by ${people(Math.abs(change))} people" — or the `
      + `rate with the words "a year" — "an average of ${Math.abs(annual)}% a year over those ${span} years". Never write `
      + 'the yearly rate as the change between two years, never present a multi-year figure as a one-year one, and '
      + 'never state a figure without the window it covers.',
      `Name the area as the statistical area it is. "${sa2Name}" is the name of an ABS Statistical Area Level 2, and its `
      + 'boundary is not the boundary of the town, suburb or council that shares the name — write "the surrounding '
      + `statistical area" or "the ${sa2Name} SA2", never "${sa2Name}'s population" as though it were the town's.`,
    ].join(' ');
  }
  return '';
}

/**
 * The measured population table and the rule for stating it, for the pinned
 * context. The table is the AUTHORITY for every population figure a section
 * may state, and on 25 Sep 2026 it sat in the trimmed middle of the base
 * prompt: the Lawley Street run kept about half of that prompt and a NSW run
 * about a ninth, so most sections wrote the figure from whatever was left.
 * The forward-demand half is pinned separately (`forwardDemandBlocks`), so it
 * is not repeated here.
 */
export function populationTrendPin(input: RegionalPromptInput): string {
  const block = populationTrendBlock(input);
  if (block === '') return '';
  return [block, populationWordingRule(input)].filter((part) => part !== '').join('\n\n');
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

/**
 * The forward half of the block, and why a prohibition alone was not enough.
 *
 * The instruction below already forbade *"a population projection"*, and that
 * prohibition is right. What it had no companion for is the PERMITTED FORM —
 * and the section validator *requires* the words `population`, `income` and
 * `employment` in this section, so the model is obliged to write about demand
 * while being told one thing it may not say and offered nothing to say
 * instead.
 *
 * This repository has recorded twice what that produces. *A prohibition with
 * no demonstration of the permitted form is one a model routes around*
 * (`compassDocumentContract`), and the planning block TELLS the model never
 * to write a bracketed pointer while nine of ten delivered documents carried
 * one. So the absence gets a sentence, composed once by
 * `forwardDemandCoverageNote`, naming the publisher a reader can go to.
 *
 * Two bounds on it. The sentence carries **no figure, no year and no rate**
 * — asserted where it is composed. And the model is told not to present the
 * publisher as a source this report consulted, because naming where a figure
 * lives and claiming to have read it are different statements and only the
 * first is true.
 */
function forwardDemandInstruction(input: RegionalPromptInput): string[] {
  const read = input.forwardDemandProjection ?? null;
  // A held projection is the publisher's own table, which carries its own
  // provenance and the rules that bound what may be said about it.
  if (read && read.kind === 'reading') return [forwardDemandStatement(read, input.state ?? null)];
  const note = read
    ? forwardDemandStatement(read, input.state ?? null)
    : forwardDemandCoverageNote(input.forwardDemand ?? { kind: 'not_read' }, input.state ?? null);
  return [
    `**Forward demand — what this report holds:**\n\n${note}`,
    `${inHomeSection('forwardDemand')} where the analysis touches what the population is expected to do, use the `
    + `statement above — closely paraphrased in your own words. ${elsewhereOnly('forwardDemand')} In every `
    + 'section: state no projected population, growth rate or horizon of your own, and do NOT present the '
    + 'publisher named in it as a source this report consulted: naming where a figure can be found and '
    + 'claiming to have read it are different statements, and only the first is true here.',
  ];
}

/**
 * The forward-demand statement alone — the table or the absence, with its
 * rules — for the pinned context, so the authority for a projected figure
 * cannot be trimmed away while the demographics section's rule survives.
 * The same composer the section uses, so the two cannot disagree.
 */
export function forwardDemandBlocks(input: RegionalPromptInput): string {
  return forwardDemandInstruction(input).join('\n\n');
}

export function regionalTrendBlocks(input: RegionalPromptInput): string {
  const block = populationTrendBlock(input);
  const projected = input.forwardDemandProjection?.kind === 'reading';
  if (block === '') {
    return [
      'No measured population trend is available for this property’s area. State that plainly in one sentence; ' +
      'do NOT assert a population figure, growth rate or unemployment rate for the area from memory.',
      ...forwardDemandInstruction(input),
      REGIONAL_WEB_SEARCH_RULE,
    ].join('\n\n');
  }
  const wording = populationWordingRule(input);
  return [
    block,
    ...(wording ? [wording] : []),
    'Discuss only the measured figures above, naming the SA2 and the windows. The SA2 may cover more than the suburb — ' +
    'say "the surrounding area" where they differ. Do NOT state an unemployment rate, ' +
    (projected
      ? 'a projected figure other than those in the forward-demand table below, '
      : 'a population projection, ') +
    'or any growth figure not in the table, and do NOT extrapolate the trend beyond the measured windows. ' +
    'The table above is BACKWARD-looking: it measures what has happened, and nothing in it is a statement about ' +
    'what will happen.',
    ...forwardDemandInstruction(input),
    REGIONAL_WEB_SEARCH_RULE,
  ].join('\n\n');
}
