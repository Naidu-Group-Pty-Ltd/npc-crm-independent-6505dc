/**
 * What to tell the operator when the listing scraper's model call fails, and
 * whether a second pass is worth making — pure.
 *
 * WHY THIS EXISTS
 * ---------------
 * This function used to call `api.perplexity.ai` directly with a hardcoded
 * `sonar-pro`, so its only failure vocabulary was Perplexity's status codes:
 * production shows four jobs failing with the literal string
 * `Perplexity request failed with status 502`. That message is unactionable in
 * two ways at once. It names a provider the operator had already tried to move
 * off in Model Hub (the binding was inert — see index.ts), and it names no model,
 * so "which of my models failed, and did the fallback even run?" had no answer
 * anywhere in the product.
 *
 * The scrape now runs through `llmRouter`, which reports an `attempts` array —
 * one entry per model in the `listing_scrape` chain. These helpers turn that
 * into a sentence that names what ran and points at the screen that changes it.
 *
 * DISCLOSURE
 * ----------
 * Only model ids, route names and status codes cross this boundary. The router
 * has already reduced provider bodies to sanitised tokens (`provider_http_502`,
 * `provider_timeout`), and raw upstream text is never echoed to a browser: a
 * provider's error body is the one place an API key or an internal hostname
 * turns up in a 500. Model ids are safe because Model Hub already shows them to
 * the same operator.
 *
 * Pure: no imports, no Deno globals, no I/O.
 */

export interface ScrapeModelAttempt {
  route: string;
  model_id: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ScrapeFailureInput {
  /** `LLMError.status` — 503 when the whole chain failed, else the provider's. */
  status?: number;
  /** `LLMError.attempts` — one entry per model tried, in chain order. */
  attempts?: ScrapeModelAttempt[];
  /** Fallback text for a failure that never reached a provider at all. */
  message?: string;
}

/**
 * Statuses the router refuses to fall back on, because another model cannot fix
 * them: they are facts about the credential or the account, not the request.
 * Each needs its own instruction, so each gets its own sentence.
 */
const TERMINAL_STATUS_ADVICE: Record<number, string> = {
  401: 'the provider rejected the API key (401). Check the key in Integrations.',
  402: 'the provider account is out of credit (402). Top up or change plan.',
  403: 'the provider refused the request (403). Check the key\'s permissions in Integrations.',
  429: 'the provider rate limit was hit (429). Wait a moment and try again.',
};

/** Statuses worth a second pass with a simpler request. See `shouldRetryWithoutSchema`. */
const REQUEST_SHAPED_STATUSES = new Set([400, 422, 500, 502, 503, 504]);

const WHERE_TO_CHANGE_IT = 'Model Hub → Agent Bindings → Property Listing Scraper';

function label(attempt: ScrapeModelAttempt): string {
  const where = attempt.status ? ` (HTTP ${attempt.status})` : attempt.error ? ` (${attempt.error})` : '';
  return `${attempt.route}/${attempt.model_id}${where}`;
}

/**
 * Should the chain be re-run with `response_format` omitted?
 *
 * Perplexity answers the probe in `check-model-availability` — a two-token chat
 * call with no `response_format` — while 502-ing this function's request, which
 * differs mainly by carrying a 62-property `json_schema`. That points at schema
 * compilation rather than at the key, the account or an outage, and a schema is
 * the one part of the request we can drop and still get an answer: the prompt
 * already ends with "Return JSON only" and `safeJsonParse` lifts an object out
 * of prose.
 *
 * True only when every attempt failed for a reason a different request shape
 * could plausibly change. A credential or quota status means the second pass
 * would fail identically, at the cost of another billed call.
 */
export function shouldRetryWithoutSchema(attempts: ScrapeModelAttempt[] | undefined): boolean {
  if (!attempts || attempts.length === 0) return false;
  return attempts.every(
    (a) => !a.ok && (a.status === undefined || REQUEST_SHAPED_STATUSES.has(a.status)),
  );
}

/**
 * A failure sentence that names the models actually tried and where to change
 * them — never a bare provider status the operator cannot act on.
 */
export function describeScrapeFailure(input: ScrapeFailureInput): string {
  const attempts = input.attempts ?? [];

  // A credential/quota answer is about the account, so report it against the
  // model that hit it rather than as a chain-wide failure.
  for (const attempt of attempts) {
    const advice = attempt.status !== undefined ? TERMINAL_STATUS_ADVICE[attempt.status] : undefined;
    if (advice) return `${attempt.route}/${attempt.model_id}: ${advice}`;
  }
  const topLevelAdvice = input.status !== undefined ? TERMINAL_STATUS_ADVICE[input.status] : undefined;
  if (topLevelAdvice) return `Listing extraction failed — ${topLevelAdvice}`;

  if (attempts.length === 0) {
    return input.message?.trim()
      ? `Listing extraction failed before any model was called: ${input.message.trim()}`
      : 'Listing extraction failed before any model was called.';
  }

  const tried = attempts.map(label).join(', ');
  const plural = attempts.length === 1 ? 'model' : 'models';
  return `Listing extraction failed on all ${attempts.length} ${plural} bound to this agent: ${tried}. `
    + `Pick a different model in ${WHERE_TO_CHANGE_IT}, or try again shortly.`;
}
