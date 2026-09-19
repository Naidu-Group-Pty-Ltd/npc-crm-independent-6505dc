/**
 * Compose the Current Economic Context block from the measured macro
 * reading — replacing a template whose every cell had a hardcoded fallback
 * (`|| '4.10'` on the cash rate, `|| '2.4'` on CPI, `|| '4.1'` on a
 * national unemployment rate) under a heading that read "VERIFIED ECONOMIC
 * DATA (use these exact figures)". When the service refused honestly, the
 * fallbacks printed a year-stale rate as verified.
 *
 * Rules:
 *  - a row renders only where a figure was measured, and carries the
 *    figure's own reference period and the table it came from (law 2: a
 *    labelled row promises a figure — absent means omitted);
 *  - GDP, unemployment and participation are NOT in the RBA statistical
 *    tables this reading is built from, so no such row exists and the
 *    instruction forbids inventing one;
 *  - the CURRENT cash rate target leads, with the date it took effect, from
 *    F1's `FIRMMCRTD` and the RBA's own announced-change column. F1.1's
 *    `FIRMMCRT` is a MONTHLY AVERAGE and is a different fact: in a month
 *    containing a Board change it averages two targets and equals neither
 *    (4.31, 3.96, 3.83 and 3.70 all appear in that series and no Board ever
 *    set them). It is kept for trend context under its own label and is
 *    never presented as the rate in force;
 *  - where the current target is NOT loaded the block FAILS CLOSED: the
 *    monthly average still renders, under its own monthly-average label, and
 *    the model is told in terms that no current/today's rate is available.
 *    Substituting the average behind a "current" label is the defect this
 *    exists to prevent;
 *  - with nothing measured, the block is one honest line plus the
 *    no-invention instruction.
 */

interface Numericish { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

export interface MacroPromptInput {
  economics?: Numericish | null;
}

/** "4.35% (monthly average, August 2026)" — a figure with its period. */
function figureCell(fig: Numericish | null | undefined, prefixNote?: string): string | null {
  const value = num(fig?.['value']);
  const label = str(fig?.['periodLabel']);
  if (value === null || !label) return null;
  return `${value}% (${prefixNote ? `${prefixNote}, ` : ''}${label})`;
}

function sourceCell(source: string | null, publicationDate: string | null): string {
  if (!source) return '';
  return publicationDate ? `${source}, published ${publicationDate}` : source;
}

export function macroEconomicBlock(input: MacroPromptInput): string {
  const e = input.economics;
  const rows: string[] = [];

  // The rate in force, and the day the RBA set it. This row leads because it
  // is the one macro fact a reader acts on, and because the row beneath it is
  // a monthly average that must never be mistaken for it.
  const target = e?.['cashRateTarget'] as Numericish | null | undefined;
  const targetPercent = num(target?.['percent']);
  const targetLabel = str(target?.['effectiveLabel']);
  const haveTarget = targetPercent !== null && targetLabel !== null;
  if (haveTarget) {
    const dateSource = str(target?.['effectiveDateSource']) ?? 'RBA';
    const targetSource = sourceCell(str(target?.['source']), str(target?.['publicationDate']));
    rows.push(`| RBA cash rate target (current) | ${targetPercent}% | ${targetSource} |`);
    // The effective date and the last CHANGE date are different facts and get
    // their own rows. The RBA publishes "4.35%, effective 12 August 2026" while
    // the rate last moved on 6 May 2026 — the Board met twice more and held.
    // One row carrying both invites the model to conflate them, which is the
    // error this correction exists to remove.
    rows.push(`| — effective from | ${targetLabel} (most recent Board decision) | ${dateSource} |`);
    const changedLabel = str(target?.['lastChangedLabel']);
    const changePoints = num(target?.['lastChangePoints']);
    if (changedLabel !== null && changePoints !== null) {
      const held = num(target?.['decisionsSinceChange']);
      const heldNote = held !== null && held > 0
        ? `; unchanged at ${held} Board decision${held === 1 ? '' : 's'} since`
        : '';
      rows.push(
        `| — last changed | ${changedLabel}, by ${changePoints > 0 ? '+' : ''}${changePoints} percentage points${heldNote} | ${dateSource} |`,
      );
    }
    const asAt = str(target?.['asAtLabel']);
    if (asAt) rows.push(`| — in force as at | ${asAt} | RBA statistical table F1 |`);
  }

  const cash = e?.['cashRate'] as Numericish | null | undefined;
  const cashCell = figureCell(cash?.['current'] as Numericish, 'monthly average');
  const cashSource = sourceCell(str(cash?.['source']), str(cash?.['publicationDate']));
  if (cashCell) rows.push(`| Cash Rate Target — Monthly Average | ${cashCell} | ${cashSource} |`);

  const infl = e?.['inflation'] as Numericish | null | undefined;
  const inflSource = sourceCell(str(infl?.['source']), str(infl?.['publicationDate']));
  const yearEnded = figureCell(infl?.['yearEnded'] as Numericish);
  if (yearEnded) rows.push(`| Inflation — headline CPI, year-ended | ${yearEnded} | ${inflSource} |`);
  const trimmed = figureCell(infl?.['trimmedMeanYearEnded'] as Numericish);
  if (trimmed) rows.push(`| Inflation — trimmed mean, year-ended | ${trimmed} | ${inflSource} |`);
  const quarterlyInfl = figureCell(infl?.['quarterly'] as Numericish);
  if (quarterlyInfl) rows.push(`| Inflation — quarterly (seasonally adjusted) | ${quarterlyInfl} | ${inflSource} |`);
  if (yearEnded || trimmed) {
    const band = str(infl?.['targetBand']);
    if (band) rows.push(`| RBA inflation target | ${band} band | RBA's published medium-term target |`);
  }

  const lend = e?.['lendingRates'] as Numericish | null | undefined;
  const lendSource = sourceCell(str(lend?.['source']), str(lend?.['publicationDate']));
  const oo = lend?.['ownerOccupier'] as Numericish | null | undefined;
  const inv = lend?.['investor'] as Numericish | null | undefined;
  const ooStd = figureCell(oo?.['standardVariable'] as Numericish);
  if (ooStd) rows.push(`| Standard variable housing rate (owner-occupier, banks) | ${ooStd} | ${lendSource} |`);
  const ooDisc = figureCell(oo?.['discountedVariable'] as Numericish);
  if (ooDisc) rows.push(`| Discounted variable housing rate (owner-occupier, banks) | ${ooDisc} | ${lendSource} |`);
  const invStd = figureCell(inv?.['standardVariable'] as Numericish);
  if (invStd) rows.push(`| Standard variable housing rate (investor, banks) | ${invStd} | ${lendSource} |`);
  const invFixed = figureCell(inv?.['threeYearFixed'] as Numericish);
  if (invFixed) rows.push(`| 3-year fixed housing rate (investor, banks) | ${invFixed} | ${lendSource} |`);

  if (rows.length === 0) {
    return 'No measured macro-economic reading is available for this report. State that in one sentence; ' +
      'do NOT print an economic indicators table, and do NOT state a cash rate, inflation figure, GDP growth, ' +
      'unemployment rate or any other macro figure from memory.';
  }

  return [
    `**Measured economic indicators (each with its own reference period):**\n\n| Indicator | Value | Source |\n|---|---|---|\n${rows.join('\n')}`,
    'Write 2–3 paragraphs in plain English explaining how the cash rate, inflation and housing lending rates above ' +
    'affect mortgage costs, borrowing capacity and property demand, connecting them to this property’s local market. ' +
    'Use only the figures in the table, with their stated periods. Do NOT state GDP growth, unemployment, participation, ' +
    'consumer confidence or any other macro figure — none is measured here. Do NOT attribute any projection to the RBA ' +
    'or Treasury. Do NOT put a "What This Means" heading or any other commentary label above the paragraphs.',
    haveTarget
      ? 'The cash rate in force is the row labelled "RBA cash rate target (current)". Its effective date is the ' +
        '"effective from" row — the most recent Board decision, whether or not that decision moved the rate. The ' +
        '"last changed" row is a DIFFERENT date: when the target last moved. Do NOT present the last-changed date ' +
        'as the effective date, and do NOT write that the rate "has been at this level since" the effective date — ' +
        'it has been at this level since it last CHANGED. The "Cash Rate Target — Monthly Average" row is a MONTHLY ' +
        'AVERAGE of that target and is NOT the rate in force: use it only to describe the trend, always calling it ' +
        'a monthly average, and never present its month as a board decision date.'
      : 'NO CURRENT CASH RATE TARGET IS AVAILABLE for this report. The only cash-rate figure in the table is a ' +
        'MONTHLY AVERAGE and you must call it that every time you use it. Do NOT describe it as the current rate, ' +
        "today's rate, the rate in force or the latest rate, do NOT give it an effective or decision date, and do " +
        'NOT state a current cash rate from memory.',
  ].join('\n\n');
}
