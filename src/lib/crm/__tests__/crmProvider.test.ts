/**
 * The CRM identity rules, pinned.
 *
 * These assert the three things the module's header argues for, because each
 * of them is a decision somebody could reasonably undo while "simplifying":
 * an explicit setting outranking a missing key, an unrecognised word not being
 * a provider, and the reading saying how it was reached.
 */
import { describe, expect, it } from "vitest";
import {
  CRM_PROVIDER_ENV,
  describeCrmProvider,
  hasGoHighLevelCredentials,
  resolveCrmProvider,
} from "../../../../supabase/functions/_shared/crm/crmProvider.pure";

/** What this clone's project environment actually looks like, measured 19 Sep 2026. */
const CLONE_ENV = {
  SUPABASE_URL: "https://qvuwrvwzjyigptmnijyb.supabase.co",
} as const;

/** What the prime's looks like. */
const PRIME_ENV = {
  GOHIGHLEVEL_API_KEY: "eyJhbGciOi...",
  GOHIGHLEVEL_LOCATION_ID: "abc123",
} as const;

describe("what CRM a deployment is", () => {
  it("is native on a clone that holds no GoHighLevel account", () => {
    // The whole premise. No clone has ever been given these names — the
    // fleet's secret policy carries no forward row for them — so this is the
    // ordinary state of every deployment but the prime.
    const r = resolveCrmProvider(CLONE_ENV);
    expect(r.provider).toBe("native");
    expect(r.source).toBe("derived");
  });

  it("is GoHighLevel on a deployment that holds one", () => {
    const r = resolveCrmProvider(PRIME_ENV);
    expect(r.provider).toBe("gohighlevel");
    expect(r.source).toBe("derived");
    expect(r.credentialled).toBe(true);
  });

  it("accepts the rotated spelling as an alternative, not an addition", () => {
    // The prime carries both pairs mid-rotation. Requiring all four would
    // report a correctly-rotated deployment as uncredentialled.
    expect(
      hasGoHighLevelCredentials({
        GOHIGHLEVEL_API_KEY_NEW: "k",
        GOHIGHLEVEL_LOCATION_ID_NEW: "l",
      }),
    ).toBe(true);
  });

  it("refuses a half configuration", () => {
    // A key with no location id addresses no account; a location id with no
    // key authorises nothing. The same rule `airtableListingsRoute` states
    // about a token with no base id.
    expect(hasGoHighLevelCredentials({ GOHIGHLEVEL_API_KEY: "k" })).toBe(false);
    expect(hasGoHighLevelCredentials({ GOHIGHLEVEL_LOCATION_ID: "l" })).toBe(
      false,
    );
  });

  it("does not read an empty string as a secret", () => {
    expect(
      hasGoHighLevelCredentials({
        GOHIGHLEVEL_API_KEY: "  ",
        GOHIGHLEVEL_LOCATION_ID: "",
      }),
    ).toBe(false);
  });
});

describe("an explicit setting is never overruled by a missing credential", () => {
  it("stays GoHighLevel, and reports the absence separately", () => {
    // This is what the prime looks like the moment a key is rotated out. A CRM
    // must not change identity because a secret expired — the tenant's
    // messages would silently start going to a different system of record.
    const r = resolveCrmProvider({
      ...CLONE_ENV,
      [CRM_PROVIDER_ENV]: "gohighlevel",
    });
    expect(r.provider).toBe("gohighlevel");
    expect(r.source).toBe("configured");
    expect(r.credentialled).toBe(false);
    expect(describeCrmProvider(r)).toMatch(/will not sync/i);
  });

  it("stays native even where a GoHighLevel account is available", () => {
    const r = resolveCrmProvider({
      ...PRIME_ENV,
      [CRM_PROVIDER_ENV]: "native",
    });
    expect(r.provider).toBe("native");
    expect(r.source).toBe("configured");
  });

  it("never marks a native deployment as short of a credential it does not want", () => {
    // A permanent red mark on a correctly configured clone is how an operator
    // learns to ignore the reading.
    expect(
      resolveCrmProvider({ [CRM_PROVIDER_ENV]: "native" }).credentialled,
    ).toBe(true);
  });
});

describe("a word this build has never heard of is not a provider", () => {
  it.each([
    "hubspot",
    "salesforce",
    "",
    "  ",
    "GoHighLevel Inc",
    "unknown",
    "true",
  ])("does not resolve %j to whichever provider comes first", (word) => {
    const r = resolveCrmProvider({ ...CLONE_ENV, [CRM_PROVIDER_ENV]: word });
    // Blank is "unset", which is a different answer from "not understood" —
    // and neither may be read as a configured choice.
    expect(r.source).not.toBe("configured");
    expect(["gohighlevel", "native"]).toContain(r.provider);
  });

  it("names the word rather than swallowing it", () => {
    const r = resolveCrmProvider({
      ...CLONE_ENV,
      [CRM_PROVIDER_ENV]: "hubspot",
    });
    expect(r.source).toBe("unrecognised");
    expect(r.configuredAs).toBe("hubspot");
    expect(describeCrmProvider(r)).toContain("hubspot");
    // It still runs — an unrecognised setting must not take the CRM down.
    expect(r.provider).toBe("native");
  });

  it("invents no word where there was none", () => {
    expect(resolveCrmProvider(CLONE_ENV).configuredAs).toBeNull();
    expect(
      resolveCrmProvider({ [CRM_PROVIDER_ENV]: "native" }).configuredAs,
    ).toBeNull();
  });

  it("accepts the short spelling operators actually type", () => {
    expect(resolveCrmProvider({ [CRM_PROVIDER_ENV]: "GHL" }).provider).toBe(
      "gohighlevel",
    );
    expect(
      resolveCrmProvider({ [CRM_PROVIDER_ENV]: " Native " }).provider,
    ).toBe("native");
  });
});

describe("the sentence an operator reads", () => {
  it("says which of the four states this is, and never the same words twice", () => {
    const said = [
      resolveCrmProvider(CLONE_ENV),
      resolveCrmProvider(PRIME_ENV),
      resolveCrmProvider({ ...CLONE_ENV, [CRM_PROVIDER_ENV]: "gohighlevel" }),
      resolveCrmProvider({ ...CLONE_ENV, [CRM_PROVIDER_ENV]: "hubspot" }),
    ].map(describeCrmProvider);
    expect(new Set(said).size).toBe(said.length);
  });

  it("never tells a native deployment that something is missing", () => {
    // Nothing is. The absence IS the configuration.
    const said = describeCrmProvider(resolveCrmProvider(CLONE_ENV));
    for (const alarm of ["missing", "not configured", "error", "failed"]) {
      expect(said.toLowerCase()).not.toContain(alarm);
    }
  });
});
