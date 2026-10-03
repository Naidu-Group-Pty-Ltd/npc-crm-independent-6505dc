/**
 * What the Strategy Advisor's reader accepts as an answer.
 *
 * The advisor answers as a server-sent event stream. On 28 Sep 2026 it had
 * been answering nothing, silently: its address was built from an unset
 * build-time variable, so the request went to the app's own host, which
 * answers any path with its HTML shell and a 200. The reader looked for
 * `data:` lines in that HTML, found none, and ended the turn with the
 * question on screen and no answer and no error.
 *
 * The address is fixed at its source. These two rules make the failure
 * visible if anything like it happens again: a 200 that is not the agent's
 * stream is refused by name, and a stream that carried nothing is said to
 * have carried nothing.
 */

/** Null when the response is the agent's stream; otherwise why it is not. */
export function agentStreamRefusal(contentType: string | null | undefined): string | null {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('text/event-stream')) return null;
  if (type.includes('text/html')) {
    return 'The Strategy Advisor could not be reached: the request was answered by the web app rather than the advisor. Please refresh the page and try again.';
  }
  return `The Strategy Advisor returned an unexpected response${type ? ` (${type.split(';')[0]})` : ''}. Please try again.`;
}

/** Said when the stream ended with no prose, no scenarios and no error. */
export function emptyAgentAnswerMessage(): string {
  return 'The Strategy Advisor did not return an answer. Please try again, or rephrase the request.';
}

/** The engine figures a card carries, as far as the summary needs them. */
export interface SummarisedCard {
  name: string;
  engineValidation?: {
    borrowingCapacity?: number | null;
    capacityChange?: number | null;
    meetsTarget?: boolean | null;
    shortfallToTarget?: number | null;
    targetPurchasePrice?: number | null;
  } | null;
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString('en-AU')}`;
}

/**
 * The advisor's reply when it returned cards and no prose of its own.
 *
 * The scenario tool is now required whenever cards are asked for, and a model
 * made to call a tool usually writes nothing beside it. The reply used to be a
 * fixed paragraph promising "3 scenarios" whatever arrived; it now names each
 * card with the engine's own figures, so the chat says what the cards show.
 * Nothing here is computed: every figure is the engine's, and a figure the
 * engine did not return is left out rather than shown as zero.
 */
export function scenarioSummaryProse(cards: ReadonlyArray<SummarisedCard>): string {
  const count = cards.length;
  if (count === 0) return emptyAgentAnswerMessage();
  const lines = cards.map((card, i) => {
    const v = card.engineValidation ?? {};
    const facts: string[] = [];
    if (typeof v.borrowingCapacity === 'number' && Number.isFinite(v.borrowingCapacity)) {
      const change = typeof v.capacityChange === 'number' && Number.isFinite(v.capacityChange) && v.capacityChange !== 0
        ? ` (${v.capacityChange > 0 ? '+' : '−'}${dollars(Math.abs(v.capacityChange))})`
        : '';
      facts.push(`capacity ${dollars(v.borrowingCapacity)}${change}`);
    }
    if (typeof v.targetPurchasePrice === 'number' && v.targetPurchasePrice > 0) {
      if (v.meetsTarget === true) facts.push(`clears the ${dollars(v.targetPurchasePrice)} target`);
      else if (typeof v.shortfallToTarget === 'number' && v.shortfallToTarget > 0) {
        facts.push(`short of the ${dollars(v.targetPurchasePrice)} target by ${dollars(v.shortfallToTarget)}`);
      }
    }
    const name = card.name?.trim() || `Scenario ${i + 1}`;
    return `${i + 1}. **${name}**${facts.length ? ` — ${facts.join(', ')}` : ''}`;
  });
  const noun = count === 1 ? 'scenario' : 'scenarios';
  return [
    `Here ${count === 1 ? 'is' : 'are'} **${count} ${noun}**, each checked by the borrowing engine:`,
    '',
    ...lines,
    '',
    'Choose **Apply Scenario** on a card to load its levers into the strategy modelling.',
  ].join('\n');
}

/** Said when the stream carried a scenario call that held no usable cards. */
export function unreadableScenariosMessage(): string {
  return 'The Strategy Advisor returned scenarios that could not be read. Please try again.';
}
