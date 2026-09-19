/**
 * Browser entry point for the activation gate's state rules.
 *
 * The rules live with the Edge Function that talks to Mission Control —
 * `supabase/functions/_shared/paymentGate.pure.ts` — because the parsing, the
 * fail-open policy and the customer-facing wording all have to be the same on
 * both sides of that call. Two copies of "does this verdict lock the app" is
 * how a screen comes to disagree with the server that fed it.
 */
export * from "../../../supabase/functions/_shared/paymentGate.pure.ts";
