/**
 * The V3 flag reader — and the read that could never have worked.
 *
 * `aml_v3_case_workspace` decides whether an AML case opens in the staged
 * compliance journey or the legacy dialog. It was switched on in the database
 * and *nothing changed on screen*. Two defects stacked:
 *
 *   1. The reader wrote its answer to `sessionStorage` once and never asked
 *      again, and `sessionStorage` survives a reload.
 *   2. Underneath that, the read itself was `supabase.from('feature_flags')`
 *      from the browser — an anon client against a table that grants SELECT
 *      `TO authenticated`. RLS filters rather than erroring, so the query
 *      returned `[]` with HTTP 200 and a null error, and every flag coerced
 *      to `false`. Fixing (1) could not have helped: the revalidated answer
 *      was the same silent lie.
 *
 * These tests pin the shape of the fix. The flags are read THROUGH THE SERVER
 * (`aml-access`, service role, on a call every AML surface already makes), a
 * cached reading still renders without a round trip, it is always revalidated
 * behind, and — the part that matters most — an answer that could not be
 * obtained is reported as unavailable rather than as a switched-off feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeSecureFunction = vi.fn();

vi.mock("@/lib/secureInvoke", () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));

const CACHE_KEY = "aml:v3_flags:v3";

const ALL_OFF = {
  v3Nav: false, startClientCompliance: false, complianceHome: false,
  caseWorkspace: false, regulatoryHub: false, terminologyEditor: false,
  metricsRelocation: false, orgSettings: false,
};

/** `aml-access` answers `summary` with a `v3Flags` map; absent keys are off. */
const summary = (v3Flags: Record<string, unknown>) => ({
  data: { enabled: true, roles: [], v3Flags },
  error: null,
});

async function freshModule() {
  vi.resetModules();
  return import("./useAmlV3Flags");
}

beforeEach(() => {
  invokeSecureFunction.mockReset();
  sessionStorage.clear();
});

describe("refreshAmlV3Flags", () => {
  it("reads the flags from aml-access, not from the feature_flags table", async () => {
    invokeSecureFunction.mockResolvedValue(summary({ aml_v3_case_workspace: true }));
    const { refreshAmlV3Flags } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags.caseWorkspace).toBe(true);
    expect(flags.v3Nav).toBe(false);

    const [fn, body] = invokeSecureFunction.mock.calls[0] as [string, { op: string }];
    expect(fn).toBe("aml-access");
    expect(body.op).toBe("summary");
  });

  it("coerces the three spellings a flag value is stored in", async () => {
    invokeSecureFunction.mockResolvedValue(summary({
      aml_v3_nav: true,
      aml_v3_compliance_home: "true",
      aml_v3_case_workspace: { enabled: true },
      aml_v3_regulatory_hub: { enabled: false },
      aml_v3_org_settings: "yes",
    }));
    const { refreshAmlV3Flags } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags.v3Nav).toBe(true);
    expect(flags.complianceHome).toBe(true);
    expect(flags.caseWorkspace).toBe(true);
    expect(flags.regulatoryHub).toBe(false);
    // Anything that is not one of the three spellings is off, not truthy.
    expect(flags.orgSettings).toBe(false);
  });

  it("shares one request between concurrent callers", async () => {
    // Four surfaces read these flags. Now that every mount revalidates, they
    // must not fire four identical calls in the same tick.
    invokeSecureFunction.mockResolvedValue(summary({}));
    const { refreshAmlV3Flags } = await freshModule();

    await Promise.all([refreshAmlV3Flags(), refreshAmlV3Flags(), refreshAmlV3Flags()]);
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good reading when the call fails", async () => {
    invokeSecureFunction.mockResolvedValue(summary({ aml_v3_case_workspace: true }));
    const { refreshAmlV3Flags } = await freshModule();
    await refreshAmlV3Flags();

    invokeSecureFunction.mockRejectedValue(new Error("network"));
    const after = await refreshAmlV3Flags();
    // A failed read is not a switched-off feature.
    expect(after.caseWorkspace).toBe(true);
  });

  it("defaults everything to false when nothing has ever been read", async () => {
    invokeSecureFunction.mockRejectedValue(new Error("network"));
    const { refreshAmlV3Flags } = await freshModule();
    const flags = await refreshAmlV3Flags();
    // Fail closed: unreadable is off. A rollout is never switched ON by a
    // broken read, only ever left off by one.
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it("never caches a failure", async () => {
    // This is what turned a transient problem into a permanent one: the
    // first bad answer was written down and every later read trusted it.
    invokeSecureFunction.mockResolvedValue({ data: null, error: new Error("500") });
    const { refreshAmlV3Flags } = await freshModule();
    await refreshAmlV3Flags();
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull();

    invokeSecureFunction.mockResolvedValue(summary({ aml_v3_case_workspace: true }));
    const recovered = await refreshAmlV3Flags();
    expect(recovered.caseWorkspace).toBe(true);
  });
});

describe("an answer that was not obtained is not an answer of 'off'", () => {
  it("treats a response with no v3Flags as unreadable, not as all-off", async () => {
    // `aml-access` deployed at a version that predates `v3Flags` answers the
    // summary perfectly well and simply omits the field. Reading that as
    // eight switched-off flags is the same silent lie the table read told.
    invokeSecureFunction.mockResolvedValue({
      data: { enabled: true, roles: ["mlro"] },
      error: null,
    });
    const { refreshAmlV3Flags, readAmlV3FlagsAvailability } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags).toEqual(ALL_OFF);
    expect(readAmlV3FlagsAvailability()).toBe(false);
    // ...and it is not written down as if it were a reading.
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("reports availability once a real reading answers", async () => {
    invokeSecureFunction.mockResolvedValue(summary({}));
    const { refreshAmlV3Flags, readAmlV3FlagsAvailability } = await freshModule();

    await refreshAmlV3Flags();
    // Every flag is off — but that is now a KNOWN off, which is a different
    // statement from the one above and the register's notice says so.
    expect(readAmlV3FlagsAvailability()).toBe(true);
  });
});

describe("the cache cannot outlive a flag change", () => {
  it("writes under a key that a stale v1/v2 reading cannot satisfy", async () => {
    // Every v1 and v2 entry was written by the anon table read, so every one
    // of them says "all flags off" regardless of the database. The bump is
    // what stops those tabs from going on believing it.
    sessionStorage.setItem("aml:v3_flags:v1", JSON.stringify({ caseWorkspace: false }));
    sessionStorage.setItem("aml:v3_flags:v2", JSON.stringify({ caseWorkspace: false }));
    invokeSecureFunction.mockResolvedValue(summary({ aml_v3_case_workspace: true }));
    const { refreshAmlV3Flags } = await freshModule();

    const flags = await refreshAmlV3Flags();
    expect(flags.caseWorkspace).toBe(true);
    expect(sessionStorage.getItem(CACHE_KEY)).toContain('"caseWorkspace":true');
  });

  it("revalidates a cached reading rather than trusting it for the session", async () => {
    // A tab that cached `false` before the flip must pick the change up on
    // its next mount — not on its next browser session.
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(ALL_OFF));
    invokeSecureFunction.mockResolvedValue(summary({ aml_v3_case_workspace: true }));
    const { refreshAmlV3Flags } = await freshModule();

    const refreshed = await refreshAmlV3Flags();
    expect(refreshed.caseWorkspace).toBe(true);
    expect(sessionStorage.getItem(CACHE_KEY)).toContain('"caseWorkspace":true');
  });
});
