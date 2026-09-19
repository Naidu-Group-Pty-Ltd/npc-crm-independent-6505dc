/**
 * Shared classification for wallet/billing errors surfaced by the
 * mission-control-* edge functions (Billing & Usage page).
 *
 * Three buckets:
 *  - not_provisioned — Mission Control's database is missing the wallet
 *    tables (PGRST205 "Could not find the table … in the schema cache").
 *    This is permanent until an administrator applies the Mission Control
 *    billing migration; retrying cannot help, so the UI must say exactly
 *    that instead of promising the service is "catching up".
 *  - transient — mid-deploy 5xx, Mission Control unreachable, rate-limit
 *    windows. Worth one silent retry and a "try again in a moment" message.
 *  - other — real, actionable errors (e.g. permission denied); shown as-is.
 */
export type WalletErrorKind = "not_provisioned" | "transient" | "other";

export function classifyWalletError(message: string): WalletErrorKind {
  if (/schema cache|could not find the table/i.test(message)) return "not_provisioned";
  if (
    /payment_methods_list_failed|wallet_lookup_failed|internal_error|mission_control_unreachable|rate.?limit|\b50[234]\b|timed? ?out|network/i.test(
      message,
    )
  ) {
    return "transient";
  }
  return "other";
}

export const WALLET_NOT_PROVISIONED_MESSAGE =
  "Not provisioned yet: Mission Control's billing database is missing its wallet/invoice tables, so retrying won't help. An administrator needs to apply the Mission Control billing migration (see aurixa-mission-control PR #20 deploy notes), then refresh this page.";

export const WALLET_TRANSIENT_MESSAGE =
  "Temporarily unavailable — the billing service is catching up. Try again in a moment.";

export function friendlyWalletError(message: string): string {
  switch (classifyWalletError(message)) {
    case "not_provisioned":
      return WALLET_NOT_PROVISIONED_MESSAGE;
    case "transient":
      return WALLET_TRANSIENT_MESSAGE;
    default:
      return message;
  }
}
