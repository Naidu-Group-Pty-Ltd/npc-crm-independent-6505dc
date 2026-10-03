/**
 * Does the broker want scenario cards, or an answer about the cards on screen?
 *
 * The Strategy Advisor answers in one of two ways. In `scenarios` mode it is
 * handed the `generate_scenarios` tool and the reply is three cards, each with
 * an Apply button that moves the strategy levers. In `answer` mode the tool is
 * withheld and the reply is prose about cards the broker already has.
 *
 * Until 2 Oct 2026 the choice was made by one rule written in April: a message
 * containing a question mark and none of nine action verbs was a
 * "clarification". Almost every brief a broker writes is a question, so almost
 * every brief lost its cards:
 *
 * - all three of the advisor's own suggested prompts end in "?" and use none
 *   of the nine verbs ("What strategies can maximise their capacity?"), so the
 *   built-in examples could never produce a card;
 * - a substring list caught ordinary briefs as well ("is it" is inside "is it
 *   possible", "what is" inside "what is the best way");
 * - and it was applied with no cards on screen at all, when there is nothing
 *   to clarify.
 *
 * Measured on production on 2 Oct 2026: a dictated 276-character brief for a
 * $750,000 new build was read as `clarificationMode: true`, the tool was never
 * offered, and the broker got prose and no cards.
 *
 * Three rules replace it, and the server and the browser read the same ones:
 *
 * - **With no cards on screen there is nothing to clarify.** Every message is
 *   a brief and gets cards.
 * - **Asking for options means cards.** An action verb ("make", "propose",
 *   "show me") or a request for new or other options means fresh cards even
 *   when cards are already showing, and so does a brief: a purchase budget or
 *   a strategy question ("what strategies…", "how can we get them to…").
 * - **An answer is owed only to a message about the cards.** It names a card
 *   (by number, by position, by "these options" or by its own name), or it is
 *   a short follow-up question ("why", "explain", "will this…"). A long
 *   message that carries a brief is a new brief even where it mentions the
 *   cards, because that is what a dictated request sounds like.
 */

export type AdvisorRequestMode = 'scenarios' | 'answer';

export interface AdvisorRequestContext {
  /** The names of the cards on screen (the request's `priorScenarios`). Empty or absent: none. */
  priorScenarioNames?: ReadonlyArray<string | null | undefined> | null;
}

/** The AU property range a budget must fall in, so a repayment is not read as a price. */
const MIN_BUDGET = 50_000;
const MAX_BUDGET = 50_000_000;

const BUDGET_PATTERNS: readonly RegExp[] = [
  // $700k, $1.2m, $700K
  /\$\s*([0-9]+(?:\.[0-9]+)?)\s*([kKmM])\b/g,
  // 700k, 1.2m  (no $)
  /\b([0-9]+(?:\.[0-9]+)?)\s*([kKmM])\b/g,
  // $700,000 or $700000
  /\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/g,
];

/**
 * Every purchase-sized amount the text mentions, in the order the patterns
 * find them. The one reading of "$750k" / "750k" / "$750,000" the advisor
 * uses: `detectTargetPrice` picks its target from these, and a message that
 * names one is a purchase brief.
 */
export function budgetAmountsIn(text: string | null | undefined): number[] {
  if (!text) return [];
  const amounts: number[] = [];
  for (const pattern of BUDGET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let value = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      const suffix = (m[2] || '').toLowerCase();
      if (suffix === 'k') value *= 1_000;
      else if (suffix === 'm') value *= 1_000_000;
      if (value < MIN_BUDGET || value > MAX_BUDGET) continue;
      amounts.push(value);
    }
  }
  return amounts;
}

/**
 * Verbs that ask the advisor to produce or rework options. "A new build" is a
 * kind of property and "does it make sense" is a question, so neither counts.
 */
const ACTION =
  /\b(generate|regenerate|create|(?<!new )build|rebuild|run|re-?run|redo|make(?! sense)|propose|recommend|suggest|show me|give me|find|refine|rework|revise|tweak|adjust)\b/;

/** Asking for options other than the ones on screen. */
const NEW_OPTIONS =
  /\b(new|another|alternative|alternate|different|more|other|fresh|extra|additional)\s+(scenarios?|options?|strateg(?:y|ies)|approach(?:es)?|plans?|ways?|ideas?|cards?)\b/;

/** A strategy question: how to reach, lift or afford something. */
const STRATEGY_ASK = new RegExp([
  String.raw`\bwhat\s+(strateg(?:y|ies)|options?|levers?|approach(?:es)?|can\s+(?:we|i|they|the client)\s+do)\b`,
  String.raw`\b(best|right|optimal|fastest|cheapest|safest|smartest)\s+(way|approach|strategy|option|plan|path|move)\b`,
  String.raw`\bways?\s+to\b`,
  String.raw`\bhow\s+(?:can|could|do|would|should|might)\s+(?:we|i|they|he|she|the client|my client|the clients?)\b`,
  String.raw`\bwhat\s+would\s+it\s+take\b`,
  String.raw`\b(maximi[sz]e|increase|improve|boost|lift|raise|grow|unlock)\b[^.?!]{0,40}\b(capacity|borrowing|serviceability|purchase power|buying power)\b`,
  String.raw`\b(capacity|borrowing)\b[^.?!]{0,40}\b(maximi[sz]e|increase|improve|boost|lift|raise)\b`,
  String.raw`\bwhich\s+(debts?|liabilit(?:y|ies)|loans?|properties|property|levers?|cards?)\s+(should|to|would|could)\b`,
  String.raw`\b(buy|buying|afford|acquire)\b|\bto\s+purchase\b`,
].join('|'));

/** Naming a card on screen by number, position or pointer. */
const CARD_REFERENCE = new RegExp([
  String.raw`\b(scenario|option|card|strategy|plan)\s*(#\s*)?[1-3]\b`,
  String.raw`\b(first|second|third|1st|2nd|3rd|last|top|middle|bottom)\s+(one|scenario|option|card|strategy|plan)\b`,
  String.raw`\b(this|that|these|those|the|your|each|both|all)\s+(three\s+)?(scenarios?|options?|cards?|strateg(?:y|ies)|plans?)\b`,
  String.raw`\bapplied\b`,
].join('|'));

/** The words of a follow-up question about something already said. */
const FOLLOW_UP_CUE = new RegExp([
  String.raw`\b(clarify|confirm|explain|elaborate|meaning|mean|assum(?:e|es|ed|ption|ptions))\b`,
  String.raw`\bwhy\b`,
  String.raw`\b(will|would|does|did)\s+(this|that|it)\b`,
  String.raw`\bis\s+(this|that)\b`,
  String.raw`\b(how|what)\s+(does|did)\b`,
  String.raw`\bbefore\s+(i\s+)?apply(ing)?\b`,
].join('|'));

/** A follow-up question is short; a dictated brief is not. */
export const FOLLOW_UP_MAX_CHARS = 200;

function namesACard(lower: string, names: ReadonlyArray<string>): boolean {
  if (CARD_REFERENCE.test(lower)) return true;
  return names.some((name) => name.length >= 4 && lower.includes(name));
}

/**
 * Which way the advisor answers `message`. Pure: the same text and the same
 * cards on screen always answer the same way, on the server and in the browser.
 *
 * With cards on screen, in this order:
 * 1. a request to produce or rework options → `scenarios`;
 * 2. a message that names a card → `answer`, unless it also carries a brief
 *    (a budget or a strategy question) and is too long to be a follow-up;
 * 3. a brief (a budget or a strategy question) → `scenarios`;
 * 4. a short follow-up question → `answer`;
 * 5. anything else → `scenarios`.
 */
export function advisorRequestMode(
  message: string | null | undefined,
  context: AdvisorRequestContext = {},
): AdvisorRequestMode {
  const lower = (message ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (lower.length === 0) return 'scenarios';

  // Nothing on screen: nothing to clarify.
  const cardsOnScreen = context.priorScenarioNames ?? [];
  if (cardsOnScreen.length === 0) return 'scenarios';
  const names = cardsOnScreen
    .map((n) => (typeof n === 'string' ? n.toLowerCase().replace(/\s+/g, ' ').trim() : ''))
    .filter((n) => n.length > 0);

  if (ACTION.test(lower) || NEW_OPTIONS.test(lower)) return 'scenarios';

  const short = lower.length <= FOLLOW_UP_MAX_CHARS;
  const brief = budgetAmountsIn(lower).length > 0 || STRATEGY_ASK.test(lower);
  if (namesACard(lower, names)) return brief && !short ? 'scenarios' : 'answer';
  if (brief) return 'scenarios';
  if (short && FOLLOW_UP_CUE.test(lower)) return 'answer';

  return 'scenarios';
}

/**
 * Is `message` a follow-up about the cards on screen? The inverse of the
 * `scenarios` mode, kept under the name the edge function has always used.
 */
export function isClarificationMessage(
  message: string | null | undefined,
  context: AdvisorRequestContext = {},
): boolean {
  return advisorRequestMode(message, context) === 'answer';
}

/**
 * Did a model answer, but without the scenario cards it was required to
 * return? The router marks such an attempt 422 ("required tool call missing")
 * and moves down the fallback chain; when the chain runs out, this is what
 * tells the broker the advisor replied without cards rather than that the
 * service failed, because the remedy is different (ask again, or phrase the
 * request as the options wanted).
 */
export function answeredWithoutScenarios(
  attempts: ReadonlyArray<{ status?: number | null } | null | undefined> | null | undefined,
): boolean {
  return (attempts ?? []).some((attempt) => attempt?.status === 422);
}
