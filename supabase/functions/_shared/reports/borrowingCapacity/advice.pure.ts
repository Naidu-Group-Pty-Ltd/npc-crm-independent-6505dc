/**
 * What the Snapshot says the client should do, in words a client reads.
 *
 * `calculate-borrowing-capacity` writes its recommendations and warnings as
 * fixed engine strings (`index.ts`, the `recommendations.push` / `warnings.push`
 * lines) and every one reached the page verbatim. Read off two production
 * documents on 28 Sep 2026:
 *
 *  - "Limited borrowing capacity - focus on strengthening financial position":
 *    an ASCII hyphen doing an em dash's job, and a sentence that restates the
 *    band printed in red above it.
 *  - "Consider paying down high-interest debts first", printed to a client whose
 *    record holds no debt at all — $0 of commitments and no liability. The
 *    engine's rule fires on the band, not on the debts.
 *  - "Monthly expenses exceed income - unable to service new debt", printed to a
 *    client with no income recorded, where the thing to do is record it.
 *
 * So the engine's wording is translated on the way OUT, as the report's reader
 * notes are (`readerNote`), rather than rewritten at the source: the engine's
 * strings also feed the calculator screen and stored rows, and changing them
 * there would move every consumer at once. The rules that decide WHICH advice
 * fires stay the engine's; this module only words it and drops what the record
 * contradicts.
 *
 * `advice.spec.ts` reads the engine's source and fails on any string pushed
 * there that this phrasebook does not know, so a new engine rule cannot reach a
 * client in the machine's own words.
 *
 * Pure: no clock, no I/O.
 */

/** The facts about the record the wording depends on. */
export interface AdviceFacts {
  /** Gross income on the record. Zero means none was recorded. */
  grossIncome: number;
  /** Monthly commitments the assessment deducted. */
  commitmentsMonthly: number;
  /** Liabilities listed on the record. */
  liabilityCount: number;
  /**
   * Whether any of them is consumer debt — a card, a personal or car loan,
   * buy-now-pay-later. A home loan is not "high-interest debt", and advice to
   * pay one down first is advice about a different kind of debt.
   */
  hasHighInterestDebt: boolean;
  /** The DTI the assessment reported, when it reported one. */
  dti: number | null;
  /** The monthly surplus the assessment reported. */
  surplusMonthly: number;
}

/** One engine sentence, recognised, and what the client reads instead. */
interface Phrase {
  /** Matches the engine's string exactly (a template's variable part as a group). */
  match: RegExp;
  /** The client-facing sentence, or null when the record contradicts the advice. */
  say: (facts: AdviceFacts, groups: string[]) => string | null;
}

const x = (n: number) => `${n.toFixed(1)}x`;

/**
 * Every string the engine pushes, in the order it pushes them.
 *
 * Each `say` is written against the rule that fires it in
 * `calculateBorrowingCapacity`, so the sentence never claims more than the rule
 * established: "above $500,000" is the threshold of the rule that emits the
 * portfolio line, and 7x is the threshold of the DTI warning.
 */
const PHRASEBOOK: readonly Phrase[] = [
  // ── recommendations ────────────────────────────────────────────────────────
  {
    match: /^Conservative mode: Capacity adjusted with minimum surplus floors and DTI cap$/,
    say: () => 'This assessment uses the conservative policy, so a minimum surplus floor and a debt-to-income cap reduce the capacity.',
  },
  {
    match: /^Strong borrowing position - ready for property acquisition$/,
    say: () => 'The position is strong enough to proceed towards a purchase.',
  },
  {
    // The engine adds "while rates are favorable" — a claim about the market
    // the record does not hold. The rule that fires it is a capacity above
    // $500,000, and that is what the sentence says.
    match: /^Consider accelerating portfolio growth while rates are favorable$/,
    say: () => 'Capacity above $500,000 leaves room to plan a further acquisition.',
  },
  {
    match: /^Moderate borrowing capacity - proceed with caution$/,
    say: () => 'Capacity is moderate: proceed, and keep a margin between the loan and the limit.',
  },
  {
    match: /^Consider debt reduction strategies before new borrowing$/,
    say: (f) => `Reducing existing debt before new borrowing would lower the debt-to-income ratio${f.dti !== null ? ` from ${x(f.dti)}` : ''}.`,
  },
  {
    match: /^Build cash buffer to improve serviceability$/,
    say: () => 'A larger cash buffer would strengthen the application; the monthly surplus is under $300.',
  },
  {
    // With no income recorded there is nothing to strengthen yet — the step is
    // to record it, which `recordedIncomeAdvice` says in its own words.
    match: /^Limited borrowing capacity - focus on strengthening financial position$/,
    say: (f) => {
      if (f.grossIncome <= 0) return null;
      // A limited band beside a positive surplus is the ratio's doing (the
      // engine rates red on a nil surplus OR a ratio past its threshold), so
      // the advice names the lever that moves it.
      if (f.surplusMonthly > 0 && f.dti !== null) {
        return 'The rating is held back by the debt-to-income ratio: reducing existing debt, or adding income, is what improves it.';
      }
      return 'Capacity is limited. More income, or lower expenses and commitments, is what moves it.';
    },
  },
  {
    // Fires on the band alone. Advice to pay down debt the client does not have
    // is the most visibly wrong sentence a lending document can print.
    match: /^Consider paying down high-interest debts first$/,
    say: (f) => (f.hasHighInterestDebt
      ? 'Paying down high-interest debt first would free serviceability for the new loan.'
      : null),
  },
  {
    match: /^Existing commitments are high - debt consolidation may help$/,
    say: () => 'Existing commitments take more than half of after-tax income; consolidating them may help.',
  },

  // ── warnings ───────────────────────────────────────────────────────────────
  {
    match: /^DTI ratio approaching ([\d.]+)x cap limit$/,
    say: (_f, [cap]) => `The debt-to-income ratio is close to the ${cap}x cap applied to this assessment.`,
  },
  {
    match: /^DTI ratio exceeds most lender thresholds$/,
    say: (f) => (f.dti !== null
      ? `At ${x(f.dti)}, the debt-to-income ratio is above the 7x that most lenders accept.`
      : 'The debt-to-income ratio is above the 7x that most lenders accept.'),
  },
  {
    match: /^Monthly expenses exceed income - unable to service new debt$/,
    say: (f) => (f.grossIncome <= 0
      ? null
      : 'Living expenses and commitments exceed after-tax income, so no new loan can be serviced.'),
  },
  {
    match: /^Borrowing capacity constrained by existing commitments$/,
    say: () => 'Existing commitments are what hold the capacity down.',
  },
  {
    match: /^Surplus below conservative minimum floor of (.+)\/mo$/,
    say: (_f, [floor]) => `The surplus is below the conservative policy's minimum of ${floor} a month, so it is not counted.`,
  },
];

/** A liability kind that is consumer debt, as opposed to a home or investment loan. */
export const HIGH_INTEREST_DEBT = /credit|personal|car\b|vehicle|buy now|bnpl|afterpay|overdraft|store card/i;

/** The one thing to do when the record holds no income. */
export const RECORD_INCOME_ADVICE =
  'Record the household’s income and recalculate: with no income on the record, no capacity can be assessed.';

/** A string the engine wrote that this module does not recognise. */
function tidy(text: string): string {
  // The engine joins clauses with " - "; a reader expects a dash.
  return text.replace(/\s+-\s+/g, ' — ').replace(/\s+/g, ' ').trim();
}

/**
 * Present one engine sentence, or null when the record contradicts it.
 *
 * An unrecognised sentence is printed tidied rather than dropped: losing a
 * warning is worse than printing it in the engine's words, and the spec
 * stops that from reaching production unnoticed.
 */
export function presentAdvice(text: string, facts: AdviceFacts): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  for (const phrase of PHRASEBOOK) {
    const m = phrase.match.exec(raw);
    if (m) return phrase.say(facts, m.slice(1));
  }
  return tidy(raw);
}

/** True when this module has a wording for the sentence. */
export function isKnownAdvice(text: string): boolean {
  return PHRASEBOOK.some((p) => p.match.test(String(text ?? '').trim()));
}

/**
 * The whole list, presented: translated, contradictions dropped, repeats
 * removed, and — where no income is recorded — led by the one step that would
 * produce an assessment at all.
 */
export function presentAdviceList(
  items: readonly string[],
  facts: AdviceFacts,
  opts: { leadWithIncome?: boolean } = {},
): string[] {
  const out: string[] = [];
  if (opts.leadWithIncome && facts.grossIncome <= 0) out.push(RECORD_INCOME_ADVICE);
  for (const item of items) {
    const said = presentAdvice(item, facts);
    if (said && !out.includes(said)) out.push(said);
  }
  return out;
}
