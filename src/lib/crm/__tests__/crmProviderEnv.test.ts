/**
 * The SERVER's reading of the provider — the one that can see credentials.
 *
 * `resolveCrmProvider` answers from a single string, which is all a browser
 * bundle can ever have. These cover the half a bundle cannot do, and the rule
 * that makes it necessary: a deployment must not change which CRM it is
 * because nobody typed a word into a secrets panel.
 */
import { describe, expect, it } from "vitest";
import {
  CRM_PROVIDER_ENV,
  hasGoHighLevelCredentials,
  resolveCrmProviderFromEnv,
} from "../../../../supabase/functions/_shared/crm/crmProvider.pure";

/** This clone's real environment, measured 19 Sep 2026: no GHL names at all. */
const CLONE = {
  SUPABASE_URL: "https://qvuwrvwzjyigptmnijyb.supabase.co",
} as const;
/** The prime's. */
const PRIME = {
  GOHIGHLEVEL_API_KEY: "eyJ...",
  GOHIGHLEVEL_LOCATION_ID: "abc123",
} as const;

describe("the default is what the deployment holds", () => {
  it("is native on a clone that holds no GoHighLevel account", () => {
    const r = resolveCrmProviderFromEnv(CLONE);
    expect(r.provider).toBe("native");
    expect(r.source).toBe("default");
    expect(r.credentialled).toBe(true); // native wants no GHL credential
  });

  it("is ghl on a deployment that holds one, with nothing configured", () => {
    // The failure this closes: `DEFAULT_CRM_PROVIDER` is `native`, so without
    // this the prime would resolve `native` by omission and a tenant's
    // conversations would move system of record silently.
    const r = resolveCrmProviderFromEnv(PRIME);
    expect(r.provider).toBe("ghl");
    expect(r.source).toBe("default");
    expect(r.credentialled).toBe(true);
  });
});

describe("an explicit setting is never overruled by a missing credential", () => {
  it("stays ghl, and reports the absence separately", () => {
    // What the prime looks like the moment a key is rotated out.
    const r = resolveCrmProviderFromEnv({
      ...CLONE,
      [CRM_PROVIDER_ENV]: "ghl",
    });
    expect(r.provider).toBe("ghl");
    expect(r.source).toBe("configured");
    expect(r.credentialled).toBe(false);
  });

  it("stays native even where a GoHighLevel account is available", () => {
    const r = resolveCrmProviderFromEnv({
      ...PRIME,
      [CRM_PROVIDER_ENV]: "native",
    });
    expect(r.provider).toBe("native");
    expect(r.source).toBe("configured");
  });
});

describe("an unrecognised word falls to the credentials, not to a constant", () => {
  it("keeps the base resolver's warning and still derives", () => {
    const r = resolveCrmProviderFromEnv({
      ...PRIME,
      [CRM_PROVIDER_ENV]: "hubspot",
    });
    expect(r.source).toBe("default");
    expect(r.warning).toContain("hubspot");
    // Derived from what this deployment holds — NOT the blunt `native`.
    expect(r.provider).toBe("ghl");
  });

  it("says nothing where nothing was configured", () => {
    expect(resolveCrmProviderFromEnv(CLONE).warning).toBeNull();
  });
});

describe("what counts as holding an account", () => {
  it("needs both halves of a pair", () => {
    // A key with no location id addresses no account; a location id with no
    // key authorises nothing.
    expect(hasGoHighLevelCredentials({ GOHIGHLEVEL_API_KEY: "k" })).toBe(false);
    expect(hasGoHighLevelCredentials({ GOHIGHLEVEL_LOCATION_ID: "l" })).toBe(
      false,
    );
  });

  it("accepts the rotated pair as an alternative, not an addition", () => {
    expect(
      hasGoHighLevelCredentials({
        GOHIGHLEVEL_API_KEY_NEW: "k",
        GOHIGHLEVEL_LOCATION_ID_NEW: "l",
      }),
    ).toBe(true);
  });

  it("does not read whitespace as a secret", () => {
    expect(
      hasGoHighLevelCredentials({
        GOHIGHLEVEL_API_KEY: " ",
        GOHIGHLEVEL_LOCATION_ID: "",
      }),
    ).toBe(false);
  });
});
