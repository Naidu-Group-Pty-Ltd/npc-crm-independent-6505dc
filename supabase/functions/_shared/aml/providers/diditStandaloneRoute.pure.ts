/**
 * Where a standalone verification call goes, and what it carries.
 *
 * ## Why a deployment might not hold the key at all
 *
 * A Didit API key is scoped to an APPLICATION, and that scope includes the
 * application's session list — every session, with the customer's name and
 * live pre-signed URLs to their passport portrait and selfie. Measured against
 * the live account on 7 Sep 2026. So a key forwarded to every tenant is a
 * credential each of them could use to read the others' customers' identity
 * documents, and Didit publishes no API to mint a key per tenant.
 *
 * The credential therefore stops travelling and the CALL travels instead:
 * Mission Control holds the one key and runs the three operations on a
 * tenant's behalf, authenticated by the Mission Control key the clone already
 * has. The prime is the account holder and still calls Didit directly.
 *
 * ## The three rules
 *
 * **The direct route requires the vendor key and nothing else decides it.** A
 * deployment holding `DIDIT_API_KEY` is one entitled to spend it — that is the
 * prime, and any future deployment given its own Didit application.
 *
 * **A brokered call must NOT be metered here.** Mission Control writes the
 * usage row because Mission Control made the vendor call. Metering at both
 * ends bills the tenant twice, which this platform's own rule names as worse
 * than not billing at all. `meter` is what carries that, and it is false for
 * exactly one route.
 *
 * **Unconfigured is a named state, never a silent direct call.** A deployment
 * with neither route must refuse and say which half is missing; falling back
 * to an unauthenticated vendor call would produce a 401 that reads like a
 * customer failing verification.
 */

/** Vendor path → the operation name the broker allows. Both ends are explicit. */
const BROKER_OPERATION: Record<string, string> = {
  "/v3/id-verification/": "id-verification",
  "/v3/passive-liveness/": "passive-liveness",
  "/v3/face-match/": "face-match",
};

export type StandaloneRoute =
  | {
      via: "direct";
      url: string;
      headers: Record<string, string>;
      /** The credential to redact from any error text on this route. */
      secret: string;
      /** Direct calls spend the vendor key here, so they are metered here. */
      meter: true;
    }
  | {
      via: "broker";
      url: string;
      headers: Record<string, string>;
      secret: string;
      /** Mission Control meters the vendor call it makes. Never both. */
      meter: false;
    }
  | { via: "unconfigured"; why: string };

export function resolveStandaloneRoute(input: {
  path: string;
  apiKey: string | null | undefined;
  apiBase: string;
  missionControlUrl: string | null | undefined;
  cloneApiKey: string | null | undefined;
}): StandaloneRoute {
  const key = (input.apiKey ?? "").trim();
  if (key) {
    return {
      via: "direct",
      url: `${input.apiBase}${input.path}`,
      headers: { "x-api-key": key, Accept: "application/json" },
      secret: key,
      meter: true,
    };
  }

  const mcUrl = (input.missionControlUrl ?? "").trim().replace(/\/+$/, "");
  const cloneKey = (input.cloneApiKey ?? "").trim();
  const operation = BROKER_OPERATION[input.path];

  if (!operation) {
    // A path the broker does not carry must never be attempted through it.
    return {
      via: "unconfigured",
      why: `no DIDIT_API_KEY, and ${input.path} is not an operation Mission Control brokers`,
    };
  }
  if (!mcUrl || !cloneKey) {
    return {
      via: "unconfigured",
      why:
        "identity verification needs either DIDIT_API_KEY, or MISSION_CONTROL_URL and " +
        "MISSION_CONTROL_CLONE_API_KEY to reach the broker",
    };
  }

  return {
    via: "broker",
    url: `${mcUrl}/api/public/verification/${operation}`,
    headers: { "x-clone-api-key": cloneKey, Accept: "application/json" },
    secret: cloneKey,
    meter: false,
  };
}
