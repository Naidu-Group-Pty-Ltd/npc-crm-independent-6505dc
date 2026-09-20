/**
 * Does the finished document agree with ITSELF?
 *
 * `factReconciliation.pure.ts` asks a different question — does the prose agree
 * with the RECORD — and it is the right question for a figure the record holds.
 * Four of the defects read off the supplied PDFs are not that shape. They are
 * the document contradicting itself, page against page, with the record
 * carrying only one of the two values or neither:
 *
 *  - a **$467** weekly shortfall on page 12 beside **$450** on page 17;
 *  - an **interest-only** loan of $444,000 at 6.5% beside a first-year
 *    repayment of **$33,677**, which is the amortising figure, not the interest;
 *  - **B / 62** on the dashboard beside *"Total Score: 60/100 (Overall Risk
 *    Score)"* under the heading *Overall Investment Score*;
 *  - bedrooms and bathrooms **described as missing** in one passage and
 *    **asserted** in another.
 *
 * A reader cannot resolve any of these. Whichever figure is right, the document
 * has told them it does not know, and that is a defect independent of which
 * producer is at fault.
 *
 * ## Four rules
 *
 * **1. It compares what the document PRINTS and computes nothing new.** Every
 * finding is two statements the document already made, quoted back. There is
 * exactly one piece of arithmetic in this module — a year's interest on a
 * stated balance at a stated rate — and it is here because that product IS the
 * definition of an interest-only payment, not a model of one; the same
 * expression already exists in `promptFinancials.interestOnlyMonthlyPaymentFor`.
 * Nothing here is a second financial calculator, and nothing here may become
 * one: no cost base, no growth, no tax, no amortisation.
 *
 * **2. It discloses; it never rewrites.** Findings become `validation_flags`
 * entries the way `reconcileFacts`'s do. A contradiction cannot be repaired by
 * deleting one side of it — which of the two is right is a question about the
 * producer, and silently dropping a figure would leave a document that is
 * consistent and possibly wrong.
 *
 * **3. A quantity is compared only against the SAME quantity.** A weekly rent,
 * a weekly repayment and a weekly cash position are three different numbers
 * that all print as "$N a week", and comparing across them manufactures
 * findings rather than finding them. Each rule below states its vocabulary and
 * matches nothing outside it.
 *
 * **4. A genuinely different basis is not a contradiction — but it must be
 * LABELLED.** Two weekly figures on different bases (52 contractual weeks
 * against the occupancy assumption, say) are both correct and the document has
 * to say so; the finding names the basis vocabulary it looked for and did not
 * find, so the remedy is a label rather than a recalculation.
 *
 * Pure: no imports beyond sibling `.pure` modules, no I/O.
 */
import { isProseLine } from './scoreClaims.pure.ts';
import { amortisingPayment } from './loanLedger.pure.ts';

export type ConsistencyRule =
  | 'weekly-cash-position-disagrees'
  | 'weekly-cash-direction-disagrees'
  | 'interest-only-repayment-does-not-reconcile'
  | 'overall-assessment-disagrees'
  | 'attribute-asserted-and-withheld';

export interface ConsistencyFinding {
  rule: ConsistencyRule;
  severity: 'error' | 'warning';
  message: string;
  /** The contradicting statements, verbatim and trimmed, in document order. */
  statements: string[];
}

// ── reading numbers out of a document ─────────────────────────────────────

/** `$33,677`, `$33,677.40`, `-$450`, `($450)`, `−$450`. */
const MONEY = /\(?[-−]?\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\)?/g;

interface MoneyHit { value: number; start: number; end: number; }

function moneyHitsIn(text: string): MoneyHit[] {
  const out: MoneyHit[] = [];
  MONEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(text)) !== null) {
    const raw = m[0];
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    // A bracketed or signed figure is the same magnitude; a cash POSITION is
    // compared on magnitude because one section prints "−$450 a week" and the
    // next "a $450 weekly shortfall" for the identical quantity.
    out.push({ value: /^[(]|[-−]/.test(raw.trim()) ? -n : n, start: m.index, end: m.index + raw.length });
  }
  return out;
}

function moneyValuesIn(text: string): number[] {
  return moneyHitsIn(text).map((h) => h.value);
}

/** `6.5%`, `6.50 %`, `6.5 per cent`. */
const PERCENT = /([0-9]+(?:\.[0-9]+)?)\s?(?:%|per cent)/i;

/** Lines a document is made of, with table pipes kept — a cell is a statement. */
function linesOf(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

/** Skip fenced code and the viz directives, which are instructions not prose. */
function statementLines(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of linesOf(markdown)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^\s*\{\{/.test(line)) continue;
    if (!line.trim()) continue;
    out.push(line);
  }
  return out;
}

/**
 * `28860` -> `$28,860`, grouped here rather than by the runtime.
 *
 * Deno and Node need not agree on ICU grouping and these strings are asserted
 * in tests — the rule `measure.pure.ts` records and `investmentSourceOfTruth`
 * enforces over every canonical module.
 */
function money(n: number): string {
  const whole = String(Math.round(Math.abs(n)));
  let grouped = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ',';
    grouped += whole[i];
  }
  return `${n < 0 ? '-' : ''}$${grouped}`;
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 170) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── 1. the weekly cash position ───────────────────────────────────────────

/**
 * A weekly cash position, in the two shapes a document actually writes it.
 *
 * Both were measured on the stored Financial Analysis for 48 Redfern Street,
 * Cowra, which states the SAME quantity three times and disagrees with itself:
 *
 *   | Weekly net position | -$467 |          (twice, in two chapter tables)
 *   - **$450 a week — $23,383 a year — of income from outside the property.**
 *   … the position is $450 a week short, so that is a 101% rise in rent …
 *
 * `keyMetrics` holds `annualNet: -23383` and `weeklyNet: -450`, and −23383/52
 * is −450 while −23383/50 is −467. The prose is right and the two table rows
 * are a composition frozen before the record was healed.
 *
 * A first version of this rule found neither: it wanted exactly one money
 * value on the line, and the sentence states the same position in two units
 * ("$450 a week — $23,383 a year"), which is one claim rather than a
 * comparison. So the figure is chosen by its UNIT rather than by being alone.
 */

/** `$450 a week`, `$450 per week`, `$450/week`. */
const MONEY_A_WEEK = /\(?[-−]?\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\)?\s*(?:a|per|\/)\s*week\b/gi;

/** `weekly shortfall of $450`, `weekly net position is -$467`. */
const WEEKLY_NOUN_THEN_MONEY =
  /\bweekly\s+(?:net\s+position|cash\s+(?:position|flow|shortfall)|shortfall|deficit|surplus)\b[^.$|]{0,24}\(?[-−]?\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/gi;

/** A table row's LABEL cell, when the row is the weekly cash position. */
const WEEKLY_CASH_CELL =
  /^\s*weekly\s+(?:net\s+position|cash\s+(?:position|flow|shortfall)|shortfall|deficit|surplus)\b/i;

/**
 * A cash-position noun somewhere on the line.
 *
 * Required for the prose shapes, because `$895 a week of rent` and `$648 a
 * week in repayments` are weekly money and are not this quantity. It is not
 * required for a table row, whose label cell has already said so.
 */
const CASH_POSITION_NOUN =
  /\b(?:net\s+position|cash\s+position|cash\s+flow|position|shortfall|deficit|surplus|out\s+of\s+pocket|funded|contribut)/i;

/**
 * A weekly figure that is NOT the cash position, however it is worded.
 *
 * Judged over the span between the label and the figure plus a short tail,
 * never over the whole line — which is the difference between excluding a rent
 * row and excluding *"On the contractual rent, before the vacancy allowance,
 * the weekly shortfall is $450"*, a cash position that names the rent basis it
 * rests on and exactly the sentence this rule most needs to read.
 */
const NOT_THE_CASH_POSITION =
  /\b(?:rent|rental|repayment|repayments|interest|mortgage|break[-\s]?even|gross|management\s+fee|letting|insurance|rates|body\s+corporate|strata)\b/i;

/** How far past the figure a disqualifying noun still describes it. */
const SPAN_TAIL_CHARS = 14;

/**
 * Words that say a figure is on a stated, different basis.
 *
 * Their PRESENCE is what turns a disagreement into a labelled distinction, so
 * the rule reports the absence of a label rather than the presence of two
 * numbers — which is exactly the remedy asked for: *label genuinely different
 * calculation bases*.
 */
const BASIS_LABEL =
  /\b(?:\d{2}\s*(?:of\s*52\s*)?weeks?\s+let|occupanc|occupied\s+weeks|contractual|vacancy\s+allowance|before\s+tax|after\s+tax|post[-\s]?tax|year\s*\d|base\s+case|scenario)\b/i;

/** Two weekly cash figures within a dollar of one another are one figure. */
const WEEKLY_TOLERANCE = 1;

/**
 * Which way the money moves, read from the WORDS as well as the sign.
 *
 * `+$467` and `−$467` are materially different: one is a property that funds
 * itself and the other is one the investor tops up by $467 a week, every week,
 * for as long as they hold it. An earlier version of this module took the
 * magnitude of both and so reported that pair as CONSISTENT — the single worst
 * reading it could give, because a sign flip between two sections is a graver
 * defect than a disagreement about how much.
 *
 * The sign is not always in the digits. A table cell writes `-$467` or
 * `($467)`; prose writes "a weekly shortfall of $450", where the direction is
 * carried entirely by the noun. Both are read, and an explicit numeric sign
 * wins over a noun, because a writer who signed the figure meant the sign.
 */
type CashDirection = 'outflow' | 'inflow' | 'unstated';

const OUTFLOW_NOUN =
  /\b(?:shortfall|deficit|out\s+of\s+pocket|top[-\s]?up|contribut\w*|fund(?:ing|ed)?\s+(?:requirement|cost)|negative(?:ly)?\s+geared|holding\s+cost)\b/i;
const INFLOW_NOUN =
  /\b(?:surplus|positive(?:ly)?\s+geared|net\s+income|cash\s+positive|in\s+(?:your|the\s+investor'?s)\s+pocket)\b/i;

function directionFrom(signed: number | undefined, text: string): CashDirection {
  if (signed !== undefined && signed < 0) return 'outflow';
  if (signed !== undefined && signed > 0 && /[+]/.test(text)) return 'inflow';
  if (OUTFLOW_NOUN.test(text)) return 'outflow';
  if (INFLOW_NOUN.test(text)) return 'inflow';
  return 'unstated';
}

const DIRECTION_WORD: Record<CashDirection, string> = {
  outflow: 'money the investor puts in',
  inflow: 'money the property returns',
  unstated: 'direction not stated',
};

const splitCells = (line: string): string[] | null => {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || t.length < 2) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};

/** The weekly cash figure a line states, or undefined. */
interface WeeklyCashReading { magnitude: number; direction: CashDirection }

function weeklyCashFigureIn(line: string): WeeklyCashReading | undefined {
  const cells = splitCells(line);
  if (cells) {
    const at = cells.findIndex((c) => WEEKLY_CASH_CELL.test(c));
    if (at < 0) return undefined;
    for (const cell of cells.slice(at + 1)) {
      const hits = moneyHitsIn(cell);
      if (!hits.length) continue;
      const signed = hits[0].value;
      // The label cell carries the noun (`Weekly shortfall`), the value cell
      // carries the sign, and either may be the only one that says which way.
      return {
        magnitude: Math.abs(signed),
        direction: directionFrom(signed, `${cells[at]} ${cell}`),
      };
    }
    return undefined;
  }
  if (!CASH_POSITION_NOUN.test(line)) return undefined;
  for (const re of [MONEY_A_WEEK, WEEKLY_NOUN_THEN_MONEY]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const span = line.slice(Math.max(0, m.index - 18), m.index + m[0].length + SPAN_TAIL_CHARS);
      if (NOT_THE_CASH_POSITION.test(span)) continue;
      const v = Number(m[1].replace(/,/g, ''));
      if (!Number.isFinite(v)) continue;
      const negated = /[-−]\s*\$?\s*$|\(\s*\$?\s*$/.test(line.slice(0, m.index + 1))
        || /^\(?[-−]/.test(m[0].trim());
      return { magnitude: Math.abs(v), direction: directionFrom(negated ? -v : undefined, line) };
    }
  }
  return undefined;
}

export function findWeeklyCashDisagreements(markdown: string): ConsistencyFinding[] {
  const seen: Array<WeeklyCashReading & { line: string; labelled: boolean }> = [];
  for (const line of statementLines(markdown)) {
    const reading = weeklyCashFigureIn(line);
    if (reading === undefined) continue;
    seen.push({ ...reading, line: trim(line), labelled: BASIS_LABEL.test(line) });
  }
  if (seen.length < 2) return [];

  const out: ConsistencyFinding[] = [];

  /*
   * Direction first, and on its own, because it is the graver reading.
   *
   * Two sections that state the same magnitude in opposite directions are not
   * "within tolerance" — they disagree about whether the investor is paid or
   * pays. Collapsed onto a magnitude they look identical, which is how a
   * detector can report a contradiction as agreement.
   */
  const stated = seen.filter((s) => s.direction !== 'unstated');
  const outflows = stated.filter((s) => s.direction === 'outflow');
  const inflows = stated.filter((s) => s.direction === 'inflow');
  if (outflows.length && inflows.length) {
    out.push({
      rule: 'weekly-cash-direction-disagrees',
      severity: 'error',
      message:
        'The document states the weekly cash position in BOTH directions — '
        + `${outflows.map((d) => money(-d.magnitude)).join(', ')} (${DIRECTION_WORD.outflow}) and `
        + `${inflows.map((d) => money(d.magnitude)).join(', ')} (${DIRECTION_WORD.inflow}). `
        + 'These are not two roundings of one answer. One says the property funds itself and the '
        + 'other says the investor tops it up every week for as long as they hold it, and a reader '
        + 'has no way to tell which section to act on. Resolve it at the producer that publishes the '
        + 'cash position; do not reconcile it by dropping a sign.',
      statements: [...outflows, ...inflows].map((d) => clip(d.line)),
    });
  }

  const distinct: typeof seen = [];
  for (const s of seen) {
    if (!distinct.some((d) => Math.abs(d.magnitude - s.magnitude) <= WEEKLY_TOLERANCE)) distinct.push(s);
  }
  if (distinct.length < 2) return out;

  const unlabelled = distinct.filter((d) => !d.labelled);
  out.push({
    rule: 'weekly-cash-position-disagrees',
    // Two unlabelled figures is a contradiction; a labelled pair is a
    // distinction a reader can follow, and reporting it as an error is the
    // false caveat this repository already pays for elsewhere.
    severity: unlabelled.length >= 2 ? 'error' : 'warning',
    message:
      `The document states ${distinct.length} different weekly cash positions `
      + `(${distinct.map((d) => (d.direction === 'inflow' ? money(d.magnitude) : money(-d.magnitude))).join(', ')}). `
      + 'A weekly figure is the annual cash position divided by 52; two of them means two annual '
      + 'positions, which the engine publishes as one. Bind each section to the same approved '
      + 'financial output, or — where the bases genuinely differ (contractual rent against the '
      + 'occupancy assumption, pre-tax against post-tax, year one against a later year) — say so in '
      + 'the label, because a reader cannot tell a second basis from a second answer.',
    statements: distinct.map((d) => clip(d.line)),
  });
  return out;
}

// ── 2. the loan the document describes ────────────────────────────────────

const INTEREST_ONLY = /\binterest[-\s]?only\b/i;
const AMORTISING = /\b(?:principal\s+(?:and|&|\+)\s+interest|P\s?&\s?I\b|amortis)/i;
const LOAN_AMOUNT_LABEL = /\b(?:loan|borrowing|debt|mortgage|facility)\b[^|\n]{0,40}\b(?:amount|balance|of|size|drawn)?\b/i;
const ANNUAL_REPAYMENT_LABEL =
  /\b(?:(?:first|1st|year[-\s]?1|year\s+one|annual|yearly)[^|\n]{0,30}\b(?:repayment|repayments|loan\s+payment|loan\s+payments|debt\s+service)|(?:repayment|repayments|loan\s+payments|debt\s+service)[^|\n]{0,30}\b(?:first\s+year|year\s+1|year\s+one|a\s+year|per\s+annum|p\.?a\.?))/i;

/** Within this much of the interest-only figure, the document is consistent. */
const REPAYMENT_TOLERANCE_PCT = 2;

export function findLoanBasisContradiction(markdown: string): ConsistencyFinding[] {
  const lines = statementLines(markdown);
  const ioLines = lines.filter((l) => INTEREST_ONLY.test(l));
  if (!ioLines.length) return [];

  // The loan's own two numbers, read off the document. The largest money value
  // on a loan-amount line is the principal: a line may also carry a monthly
  // figure beside it.
  let principal: number | undefined;
  let principalLine = '';
  for (const line of lines) {
    if (!LOAN_AMOUNT_LABEL.test(line)) continue;
    if (/\b(?:deposit|price|value|equity|cost|stamp|total)\b/i.test(line)) continue;
    const values = moneyValuesIn(line).map(Math.abs).filter((v) => v >= 10_000);
    if (!values.length) continue;
    const best = Math.max(...values);
    if (principal === undefined || best > principal) { principal = best; principalLine = trim(line); }
  }
  let rate: number | undefined;
  let rateLine = '';
  for (const line of lines) {
    if (!/\b(?:interest\s+rate|rate\s+assumed|at\s+[0-9.]+\s?%|variable\s+rate|lending\s+rate)\b/i.test(line)) continue;
    if (/\b(?:growth|yield|inflation|cpi|vacancy|LVR|loan[-\s]to[-\s]value|return|cap(?:italisation)?\s+rate)\b/i.test(line)) continue;
    const m = line.match(PERCENT);
    if (!m) continue;
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v <= 0 || v > 20) continue;
    rate = v; rateLine = trim(line);
    break;
  }
  if (principal === undefined || rate === undefined) return [];

  /*
   * A year's interest on the stated balance at the stated rate. This is the
   * DEFINITION of an interest-only payment, restated, not a model of one — it
   * takes no cost base, no fee, no growth and no amortisation, and it is the
   * same expression `interestOnlyMonthlyPaymentFor` already computes twelve
   * times over. Rule 1 of this module's header holds because of that.
   */
  const interestOnlyAnnual = principal * (rate / 100);
  const tolerance = interestOnlyAnnual * (REPAYMENT_TOLERANCE_PCT / 100);

  /*
   * A payment above a year's interest does not, on its own, mean amortisation.
   *
   * An earlier version of this rule said it did, and that was an inference the
   * evidence does not carry. A first-year repayment can exceed the interest on
   * the stated balance because the loan amortises — or because the figure
   * includes lender fees, mortgage insurance or establishment costs, because
   * the balance the schedule ran on is not the one this line labels, or
   * because the rate moved during the year. The detector sees two numbers that
   * do not reconcile; it cannot see why.
   *
   * So the excess is MEASURED against both definitions rather than attributed
   * to one. `amortisingPayment` is the canonical annuity — the same function
   * `buildLoanLedger` runs — and where the printed figure matches it the
   * finding states that as a computed fact with the arithmetic shown. Where it
   * matches neither, the finding says exactly that and names the candidates,
   * which is what an operator needs in order to establish it at the producer.
   *
   * Measured on 48 Redfern Street: principal $444,000 at 6.5% gives interest
   * of $28,860 and a 30-year annuity of $33,676. The document prints $33,677.
   */
  const piAnnual = (years: number) =>
    amortisingPayment(principal!, rate! / 100 / 12, years * 12) * 12;
  const PLAUSIBLE_TERMS = [30, 25] as const;

  for (const line of lines) {
    if (!ANNUAL_REPAYMENT_LABEL.test(line)) continue;
    if (/\bmonth/i.test(line)) continue;
    const values = moneyValuesIn(line).map(Math.abs).filter((v) => v > interestOnlyAnnual + tolerance);
    if (!values.length) continue;
    const stated = Math.max(...values);
    const excess = stated - interestOnlyAnnual;

    const matchedTerm = PLAUSIBLE_TERMS.find(
      (y) => Math.abs(stated - piAnnual(y)) <= piAnnual(y) * (REPAYMENT_TOLERANCE_PCT / 100),
    );

    const preamble =
      `The document describes an interest-only loan of ${money(principal)} at ${rate}% and prints a `
      + `first-year repayment of ${money(stated)}. A year's interest on that balance at that rate is `
      + `${money(interestOnlyAnnual)} — ${money(excess)} less.`;

    const reading = matchedTerm
      ? ` The printed figure matches principal-and-interest over ${matchedTerm} years on the same `
        + `balance and rate (${money(piAnnual(matchedTerm))}) to within `
        + `${REPAYMENT_TOLERANCE_PCT}%, so the schedule was built on the amortising basis while the `
        + 'label says interest-only.'
      : ' The printed figure matches neither basis: it is above a year\'s interest and does not '
        + `agree with principal-and-interest over 30 years (${money(piAnnual(30))}) or 25 `
        + `(${money(piAnnual(25))}). Fees, mortgage insurance, a balance other than the one this `
        + 'line labels, or a rate that moved during the year would each explain it, and the '
        + 'document says none of them.';

    return [{
      rule: 'interest-only-repayment-does-not-reconcile',
      severity: 'error',
      message:
        preamble + reading
        + ' One of the three is wrong — the label, the term recorded against the loan, or the figure '
        + 'the schedule was built from — and the reader is not told which. Establish it at the '
        + 'producer; do not change the accepted assumption to make the page agree with itself.',
      statements: [clip(principalLine), clip(rateLine), clip(trim(line))],
    }];
  }
  return [];
}

// ── 3. the overall assessment ─────────────────────────────────────────────

/** The heading and label vocabulary of THE canonical assessment. */
const OVERALL_LABEL =
  /\b(?:overall\s+(?:investment\s+)?(?:score|assessment|grade|rating)|investment\s+(?:score|grade)|total\s+score|composite\s+score)\b/i;
/** `62/100`, `62 out of 100`. Unambiguous wherever it appears. */
const SCORE_OUT_OF = /\b([0-9]{1,3})\s*(?:\/|out of)\s*100\b/;
/** A metric that is NOT the investment assessment, however it is drawn. */
const OTHER_METRIC =
  /\b(?:risk|property[- ]fit|fit|investor[- ]readiness|readiness|confidence|affordability|suitability|liveability|walk)\s+(?:score|rating|index)\b/i;
/** A bare figure, read only where the label puts it: `Score: 62`, `B · 62`. */
const SCORE_BARE = /(?<![$\d.,])\b([0-9]{1,3})\b(?!\s*(?:%|per cent)|[\d.,])/;
/**
 * The grade letter, read case-SENSITIVELY on purpose.
 *
 * `/i` would make `[A-F]` match `a`-`f` and every ordinary word would offer a
 * grade, so the keyword spells its own capitalisation instead. `Grade B` in a
 * table cell was silently unreadable while `is rated C` in a sentence was not,
 * which is the shape of a rule that half works.
 */
const GRADE_LETTER = /\b(?:[Gg]rade|GRADE|[Rr]ated|RATED)\b[^A-F\n|]{0,12}\b([A-F][+-]?)\b|\b([A-F][+-]?)\s*(?:·|—|–)\s*[0-9]{1,3}\b/;

/**
 * The part of a line the label's VALUE is in.
 *
 * A markdown table puts the value in the next cell, so the label's own cell
 * carries no figure and a window measured in characters cannot cross the pipe
 * without also crossing into the next row's label. Splitting on the pipe is
 * what lets `| Overall investment score | B · 62 |` be read at all, and it is
 * why a bare figure is never taken from anywhere else on the line.
 */
function valueSideOf(line: string, label: RegExp): string | null {
  if (line.includes('|')) {
    const cells = line.split('|').map((c) => c.trim());
    const at = cells.findIndex((c) => label.test(c));
    if (at < 0) return null;
    return cells.slice(at + 1).find((c) => c.length > 0) ?? '';
  }
  const m = label.exec(line);
  if (!m) return null;
  return line.slice(m.index + m[0].length);
}

export function findOverallAssessmentDisagreements(markdown: string): ConsistencyFinding[] {
  const scores: Array<{ value: number; line: string }> = [];
  const grades: Array<{ value: string; line: string }> = [];
  for (const line of statementLines(markdown)) {
    if (!OVERALL_LABEL.test(line)) continue;
    const valueSide = valueSideOf(line, OVERALL_LABEL);
    // `N/100` is unambiguous anywhere on the line; a bare figure is read only
    // from the value side, so a date, a page number or a dimension's own score
    // elsewhere on the line is never mistaken for the headline.
    const m = line.match(SCORE_OUT_OF) ?? (valueSide === null ? null : valueSide.match(SCORE_BARE));
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= 0 && v <= 100) scores.push({ value: v, line: trim(line) });
    }
    const g = (valueSide ?? line).match(GRADE_LETTER) ?? line.match(GRADE_LETTER);
    if (g) grades.push({ value: (g[1] ?? g[2]).toUpperCase(), line: trim(line) });
  }

  /*
   * A figure presented AS the canonical assessment while naming a different
   * metric. Measured on the stored Executive Briefing for 1/27D Mitchell
   * Street, verbatim:
   *
   *   - Total Score: 60/100 (Overall Risk Score)
   *
   * One line, two claims, and a reader takes the first. A risk score, a
   * property-fit reading and an investor-readiness figure are all legitimate
   * metrics — they are simply not the investment assessment, and printed under
   * its label they read as a second opinion about the same question.
   */
  const misnamed: Array<{ metric: string; line: string }> = [];
  for (const line of statementLines(markdown)) {
    if (!OVERALL_LABEL.test(line)) continue;
    const m = line.match(OTHER_METRIC);
    if (m) misnamed.push({ metric: m[0], line: trim(line) });
  }

  const findings: ConsistencyFinding[] = [];
  if (misnamed.length) {
    const named = [...new Set(misnamed.map((x) => x.metric.toLowerCase()))];
    findings.push({
      rule: 'overall-assessment-disagrees',
      severity: 'error',
      message:
        `A figure is published under the overall assessment's own label while naming a different `
        + `metric (${named.join(', ')}). One canonical investment assessment reaches a client `
        + 'document. A separate metric is legitimate and must be named as what it is, in its own '
        + 'place, rather than under the label a reader takes for the property\'s grade.',
      statements: misnamed.map((x) => clip(x.line)),
    });
  }
  const distinctScores = scores.filter((s, i) => scores.findIndex((x) => x.value === s.value) === i);
  if (distinctScores.length >= 2) {
    findings.push({
      rule: 'overall-assessment-disagrees',
      severity: 'error',
      message:
        `The document publishes ${distinctScores.length} different overall assessment figures `
        + `(${distinctScores.map((s) => s.value).join(', ')}) out of 100. One canonical investment `
        + 'assessment reaches a client document. A separate metric — a risk score, a suitability '
        + 'reading, a confidence figure — is legitimate, and must be named as what it is rather than '
        + 'printed under the investment assessment\'s own heading, where it reads as a second opinion '
        + 'about the same question.',
      statements: distinctScores.map((s) => clip(s.line)),
    });
  }
  const distinctGrades = grades.filter((g, i) => grades.findIndex((x) => x.value === g.value) === i);
  if (distinctGrades.length >= 2) {
    findings.push({
      rule: 'overall-assessment-disagrees',
      severity: 'error',
      message:
        `The document publishes ${distinctGrades.length} different overall grades `
        + `(${distinctGrades.map((g) => g.value).join(', ')}). A report states one grade for the `
        + 'property, or states that the grade is withheld; it does not offer a reader a choice.',
      statements: distinctGrades.map((g) => clip(g.line)),
    });
  }
  return findings;
}

// ── 4. an attribute both asserted and withheld ────────────────────────────

interface AttributeVocabulary {
  readonly key: string;
  /** How the document names the attribute. */
  readonly noun: RegExp;
  /** How the document ASSERTS it — a count adjacent to the noun. */
  readonly asserted: RegExp;
}

const ATTRIBUTES: readonly AttributeVocabulary[] = [
  { key: 'bedrooms', noun: /\bbed(?:room)?s?\b/i, asserted: /\b([1-9][0-9]?)\s*(?:-|\s)?\s*bed(?:room)?s?\b|\bbed(?:room)?s?\b\s*[:|]\s*([1-9][0-9]?)\b/i },
  { key: 'bathrooms', noun: /\bbath(?:room)?s?\b/i, asserted: /\b([1-9](?:\.5)?)\s*(?:-|\s)?\s*bath(?:room)?s?\b|\bbath(?:room)?s?\b\s*[:|]\s*([1-9](?:\.5)?)\b/i },
  { key: 'car spaces', noun: /\bcar\s*(?:space|park|bay)s?\b|\bgarage\b/i, asserted: /\b([1-9])\s*car\s*(?:space|park|bay)s?\b|\bcar\s*(?:space|park|bay)s?\b\s*[:|]\s*([1-9])\b/i },
];

/** The document saying it does not hold the attribute. */
const WITHHELD =
  /\b(?:not\s+(?:provided|available|stated|specified|recorded|disclosed|supplied|confirmed)|unavailable|no\s+(?:data|information|record)|unknown|undisclosed|could\s+not\s+be\s+(?:established|confirmed)|absent\s+from\s+the\s+record)\b/i;

export function findAttributeContradictions(markdown: string): ConsistencyFinding[] {
  const lines = statementLines(markdown);
  const findings: ConsistencyFinding[] = [];
  for (const attr of ATTRIBUTES) {
    const assertedLines: string[] = [];
    const withheldLines: string[] = [];
    for (const line of lines) {
      if (!attr.noun.test(line)) continue;
      /*
       * A sentence about OTHER properties is not a statement about this one.
       * `evidenceClaims.pure.ts` pays for this rule already: a neighbouring
       * parcel cannot establish the subject's configuration, and a comparable
       * sales table legitimately carries other houses' bedroom counts.
       */
      if (/\b(?:comparable|nearby|neighbouring|neighboring|surrounding|other|similar|median|typical|stock|street|suburb)\b/i.test(line)) continue;
      if (WITHHELD.test(line)) { withheldLines.push(trim(line)); continue; }
      if (attr.asserted.test(line)) assertedLines.push(trim(line));
    }
    if (!assertedLines.length || !withheldLines.length) continue;
    findings.push({
      rule: 'attribute-asserted-and-withheld',
      severity: 'error',
      message:
        `The document both states the subject's ${attr.key} and says the ${attr.key} information is `
        + 'not held. Reconcile the subject\'s own facts against the approved evidence and say one '
        + 'thing: where the record establishes the figure, state it everywhere; where it does not, '
        + 'withhold it everywhere. A neighbouring property, a comparable sale or the suburb\'s '
        + 'typical stock cannot establish this property\'s configuration.',
      statements: [clip(assertedLines[0]), clip(withheldLines[0])],
    });
  }
  return findings;
}

// ── the whole reading ─────────────────────────────────────────────────────

export function findDocumentContradictions(markdown: string): ConsistencyFinding[] {
  if (!markdown || !markdown.trim()) return [];
  return [
    ...findWeeklyCashDisagreements(markdown),
    ...findLoanBasisContradiction(markdown),
    ...findOverallAssessmentDisagreements(markdown),
    ...findAttributeContradictions(markdown),
  ];
}

/** The `validation_flags` shape, the same one `factFindingToFlag` produces. */
export function contradictionToFlag(f: ConsistencyFinding): {
  type: 'consistency';
  rule: ConsistencyRule;
  severity: 'error' | 'warning';
  message: string;
  statements: string[];
} {
  return {
    type: 'consistency',
    rule: f.rule,
    severity: f.severity,
    message: f.message,
    statements: f.statements,
  };
}

/** Kept exported so a caller can prove the prose filter is the shared one. */
export { isProseLine };
