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
