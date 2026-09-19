/**
 * "Is this failure "the function is not deployed here"?" — asked once, the
 * same way, by every format that keeps a legacy generator behind its route.
 *
 * ## The defect this exists to stop repeating
 *
 * Three formats carried a private copy of this predicate and two of them were
 * wrong in the same way, for the same reason, for months.
 *
 * A missing edge function is a **404 from the Supabase gateway**, not from the
 * function, and a gateway 404 carries no `Access-Control-Allow-Origin` header.
 * The request is preflighted (`credentials: 'include'` plus
 * `Content-Type: application/json`), so the browser never lets the caller see
 * the status or the body at all — `fetch` rejects, and `invokeSecureFunction`
 * turns that rejection into
 *
 *     Network/CORS error calling <fn>. Please check the function deployment …
 *
 * Matching on `failed to fetch` therefore missed the exact case the fallback
 * was written for. Worse, the browsers disagree on the wording they reject
 * with — Chrome says `Failed to fetch`, Firefox `NetworkError when attempting
 * to fetch resource.`, Safari `Load failed` — and only Chrome's is the string
 * `invokeSecureFunction` rewrites, so the substring arm was dead on every
 * browser either way.
 *
 * The consequence was not a cosmetic message. `requestCashFlowPdf` and
 * `requestBorrowingCapacitySnapshot` are handed a working in-browser generator
 * as `legacyFallback` and never called it: they threw, the modal turned that
 * into a red toast, and **the adviser got no file at all** — from a button
 * whose whole contract is that the legacy generator covers the gap.
 *
 * `requestReportQaPdf` was fixed in place and the fix was never ported. So the
 * predicate now lives here, once.
 *
 * ## The two rules
 *
 * - **A transport failure is an absent function.** `network === true` means the
 *   request never reached a function at all — undeployed, offline, blocked,
 *   CORS-misconfigured — and in every one of those the legacy document is the
 *   right answer, because there is no server answer to prefer.
 * - **A timeout is the opposite of an absent function.** It is also
 *   `network: true`, and it means the route answered *slowly*: it exists, it is
 *   working, and it may well have finished the render. Telling somebody to
 *   deploy it would be wrong, and silently handing them the legacy document
 *   after a slow render is worse — the two documents differ.
 *
 * A bare 404 is deliberately NOT enough. These routes answer 404 for a record
 * the caller may not see — on purpose, so they do not confirm whether it
 * exists — and reading that as "not deployed" would hand someone the legacy
 * document for a record they have no access to.
 */

/** The shape `invokeSecureFunction` returns; only these four fields matter. */
export interface RouteFailure {
  message?: string;
  status?: number;
  network?: boolean;
  code?: string;
}

/**
 * True when the failure means "this function does not exist here".
 *
 * Never throws, and answers false for a null error, so a caller can pass the
 * transport's `error` straight through.
 */
export function looksUndeployed(error: RouteFailure | null | undefined): boolean {
  if (!error) return false;
  // The arm that actually fires in production. See this file's header.
  if (error.network === true && error.code !== 'provider_timeout') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('function not found')
    || message.includes('requested function')
    || message.includes('does not exist')
    || message.includes('failed to fetch')
    || message.includes('network/cors')
    || message.includes('failed to send a request');
}
