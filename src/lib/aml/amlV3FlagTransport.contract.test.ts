import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * How the AML V3 rollout flags reach the browser — pinned in the source.
 *
 * ── The defect this exists to stop coming back ────────────────────────
 * `useAmlV3Flags` used to read `feature_flags` directly:
 *
 *     supabase.from("feature_flags").select("key,value").in("key", KEYS)
 *
 * That read cannot work in this application, and it fails silently, which is
 * the part that cost months:
 *
 *   • `public.feature_flags` grants SELECT `TO authenticated`.
 *   • The Command Centre's browser client is anon-only. Identity here is a
 *     custom HttpOnly cookie session, and `src/integrations/supabase/client.ts`
 *     sets `persistSession: false` precisely so GoTrue never competes with
 *     it — so the client never holds the `authenticated` role.
 *   • RLS does not error on a role no policy matches. It FILTERS. The query
 *     returned `[]` with HTTP 200 and a null `error`, and every flag coerced
 *     from `undefined` to `false`.
 *
 * So every V3 flag read as off, in every browser, for every user, however the
 * database was set. `aml_v3_case_workspace` gates the entire staged case
 * workspace, so that surface was unreachable from the day it shipped, and
 * turning the flag on in the database changed nothing — the reading never
 * came from the database.
 *
 * A unit test cannot catch the regression: mock the client and the table read
 * passes perfectly. Only the transport can be pinned, so it is pinned here.
 * The same trap is documented on `useBuilderStockMarketplaceFlag` for
 * `builder_stock_marketplace`; the rule both state is: READ THROUGH THE
 * SERVER.
 *
 * Scope note: this asserts on the V3 flag reader alone. Other browser-side
 * flag readers carry the identical latent defect (`usePartnerWorkspaceFlags`
 * is one, currently inert because every `aml_partner_*` flag is false), and
 * widening this test would turn a fix into an unrelated refactor. Synthetic
 * data only — nothing here touches a database.
 */

const repo = join(__dirname, "../../..");
const reader = readFileSync(join(repo, "src/lib/aml/useAmlV3Flags.ts"), "utf8");
const amlAccess = readFileSync(join(repo, "supabase/functions/aml-access/index.ts"), "utf8");

/** Comment lines are prose about the bug; they must not satisfy an assertion. */
const code = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const readerCode = code(reader);
const amlAccessCode = code(amlAccess);

const FLAG_KEYS = [
  "aml_v3_nav",
  "aml_v3_start_client_compliance",
  "aml_v3_compliance_home",
  "aml_v3_case_workspace",
  "aml_v3_regulatory_hub",
  "aml_v3_terminology_editor",
  "aml_v3_metrics_relocation",
  "aml_v3_org_settings",
];

describe("the V3 flags are read through the server, never off the table", () => {
  it("does not import the browser Supabase client at all", () => {
    // The narrow assertion (`.from("feature_flags")`) is too easy to route
    // around. Without the client in scope there is no table read to write.
    expect(readerCode).not.toMatch(/from\s+["']@\/integrations\/supabase\/client["']/);
  });

  it("does not query feature_flags from the browser", () => {
    expect(readerCode).not.toMatch(/from\(\s*["']feature_flags["']\s*\)/);
  });

  it("reads them from aml-access, on the call every AML surface already makes", () => {
    // `aml-access` is invoked for roles on every AML page load, so answering
    // the flags there costs no extra round trip.
    expect(readerCode).toMatch(/invokeSecureFunction/);
    expect(readerCode).toMatch(/["']aml-access["']/);
  });
});

describe("aml-access answers the flags with the service role", () => {
  it("names every flag the reader expects", () => {
    // A key present on one side and not the other reads as a switched-off
    // feature, which is the exact failure mode this whole file is about.
    for (const key of FLAG_KEYS) {
      expect(amlAccessCode, `aml-access is missing ${key}`).toContain(key);
      expect(readerCode, `the reader is missing ${key}`).toContain(key);
    }
  });

  it("returns them under `v3Flags`, which is what the reader destructures", () => {
    expect(amlAccessCode).toMatch(/v3Flags/);
    expect(readerCode).toMatch(/v3Flags/);
  });

  it("throws rather than answering 'all off' when the flag query fails", () => {
    // The service-role read failing must not look like eight disabled
    // features. Fail loudly on the server; the client then reports the flags
    // as unavailable rather than as off.
    expect(amlAccessCode).toMatch(/if\s*\(\s*v3Error\s*\)\s*throw\s+v3Error/);
  });
});

describe("an unobtainable reading is distinguishable from a switched-off one", () => {
  it("exposes availability separately from the flag values", () => {
    // All eight values are `false` in both cases. Without this, a broken
    // read is indistinguishable from a disabled rollout — which is what
    // sent a superadmin to a toggle that was already on.
    expect(readerCode).toMatch(/unavailable/);
    expect(readerCode).toMatch(/readAmlV3FlagsAvailability/);
  });

  it("never writes a failed read to the cache", () => {
    // Caching the first bad answer is what turned a transient failure into
    // a permanent one. `writeCache` must be reachable only after the read
    // has been marked good.
    const okIndex = readerCode.indexOf("lastReadOk = true");
    const writeIndex = readerCode.indexOf("writeCache(next)");
    expect(okIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(okIndex);
  });

  it("bumps the cache key past the readings the table read wrote", () => {
    // Every v1/v2 entry says "all flags off" regardless of the database,
    // because an anon table read is what wrote it. None may be trusted.
    expect(readerCode).toMatch(/CACHE_KEY\s*=\s*["']aml:v3_flags:v3["']/);
  });
});
