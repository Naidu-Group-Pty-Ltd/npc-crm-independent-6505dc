import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Behavioural tests for the local_lists screening adapter — the screening
 * scope contract (Defect A) and the sanctions freshness gate (Defect G).
 *
 * The rules these serve:
 *   - DFAT/UN/OFAC are sanctions lists, not a PEP register and not an
 *     adverse-media corpus. A result can never read as clearing a scope the
 *     data cannot answer.
 *   - Stale or missing required list data is a technical condition —
 *     screening incomplete — never "customer clear" and never "customer
 *     matched".
 */

const env: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { AML_ENVIRONMENT: "test" });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
});
afterEach(() => {
  delete (globalThis as any).Deno;
});

/**
 * PostgREST-style thenable builder that honours eq/order/limit, so the
 * provider's per-list freshness lookups behave as they would in the database.
 */
function fakeAdmin(tables: { syncs?: any[]; entries?: any[] }) {
  const makeBuilder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let take: number | null = null;
    const b: any = {
      select: () => b,
      eq: (col: string, v: unknown) => { filters.push([col, v]); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { take = n; return b; },
      overlaps: () => b, not: () => b, is: () => b, in: () => b,
      then: (resolve: any) => {
        let rows = table === "sanctions_list_syncs"
          ? [...(tables.syncs ?? [])] : [...(tables.entries ?? [])];
        for (const [col, v] of filters) rows = rows.filter((r) => r[col] === v);
        if (orderBy) {
          const { col, asc } = orderBy;
          rows.sort((x, y) => String(x[col] ?? "").localeCompare(String(y[col] ?? "")) * (asc ? 1 : -1));
        }
        if (take != null) rows = rows.slice(0, take);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return b;
  };
  return { schema: () => ({ from: (table: string) => makeBuilder(table) }) };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const sync = (list_code: string, over: Record<string, unknown> = {}) => ({
  list_code, status: "succeeded",
  started_at: over.completed_at ?? hoursAgo(2), completed_at: hoursAgo(2),
  payload_sha256: `${list_code[0]}`.repeat(64), entry_count: 100,
  ...over,
});

const FRESH_SYNCS = [
  sync("dfat", { completed_at: hoursAgo(2), started_at: hoursAgo(2), payload_sha256: "a".repeat(64) }),
  sync("un", { completed_at: hoursAgo(3), started_at: hoursAgo(3), payload_sha256: "b".repeat(64), entry_count: 200 }),
  sync("ofac", { completed_at: hoursAgo(4), started_at: hoursAgo(4), payload_sha256: "c".repeat(64), entry_count: 300 }),
];

async function provider(admin: any, config: Record<string, unknown> = {}) {
  const { getScreeningProvider } = await import(
    "../../../supabase/functions/_shared/aml/providers/index.ts");
  return getScreeningProvider({
    resolved: { providerKey: "local_lists", mode: "live", configId: null, config, costCents: 0 },
    admin,
  });
}

const request = (scope: string[], metadata: Record<string, unknown> = {}) => ({
  caseId: "case-1", subjectLabel: "Alex Example",
  subjectType: "individual" as const, scope: scope as any, metadata,
});

describe("local_lists screening scopes tell the truth (Defect A)", () => {
  it("declares sanctions-only coverage", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS }));
    expect(p.supportedScopes).toEqual(["sanctions"]);
  });

  it("cannot represent PEP or adverse media as checked when only sanctions was screened", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS, entries: [] }));
    const result = await p.runScreening(request(["pep", "sanctions", "adverse_media"]));
    // Sanctions found nothing, but the overall result is NOT clear: two of
    // the three requested scopes were never checked, and the result says so.
    expect(result.status).toBe("review");
    expect((result.summary as any).scopes_not_covered).toEqual(["pep", "adverse_media"]);
    expect((result.summary as any).scopes_covered).toEqual(["sanctions"]);
    expect((result.summary as any).unsupported_scope_note).toMatch(/NOT checked/);
  });

  it("reports every unsupported requested scope, watchlist included", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS, entries: [] }));
    const result = await p.runScreening(request(["watchlist", "adverse_media"]));
    expect(result.status).toBe("review");
    expect((result.summary as any).scopes_not_covered).toEqual(["watchlist", "adverse_media"]);
  });

  it("returns a genuine clear only for a purely-sanctions request with current lists", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS, entries: [] }));
    const result = await p.runScreening(request(["sanctions"]));
    expect(result.status).toBe("clear");
    expect(result.matches).toHaveLength(0);
    expect((result.summary as any).scopes_not_covered).toEqual([]);
  });

  it("refers candidate hits to a human, never auto-clearing or auto-confirming", async () => {
    const p = await provider(fakeAdmin({
      syncs: FRESH_SYNCS,
      entries: [{
        external_id: "DFAT-1", list_code: "dfat", primary_name: "Alex Example",
        aliases: [], date_of_birth: null, entry_type: "individual",
        listing_reference: "ref-1", listing_detail: {},
      }],
    }));
    const result = await p.runScreening(request(["sanctions"]));
    expect(result.status).toBe("review");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].matchType).toBe("sanctions");
  });

  it("screens known aliases, keeping the best score per listed entry", async () => {
    const p = await provider(fakeAdmin({
      syncs: FRESH_SYNCS,
      entries: [{
        external_id: "DFAT-2", list_code: "dfat", primary_name: "Aleksandr Primerov",
        aliases: [], date_of_birth: null, entry_type: "individual",
        listing_reference: null, listing_detail: {},
      }],
    }));
    const noAlias = await p.runScreening(request(["sanctions"]));
    expect(noAlias.matches).toHaveLength(0);
    const withAlias = await p.runScreening(
      request(["sanctions"], { aliases: ["Aleksandr Primerov"] }));
    expect(withAlias.matches).toHaveLength(1);
    expect(withAlias.status).toBe("review");
  });

  it("refers an unscreenable name to a human instead of clearing it", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS, entries: [] }));
    const result = await p.runScreening({ ...request(["sanctions"]), subjectLabel: "· ·" });
    expect(result.status).toBe("review");
    expect((result.summary as any).reason).toBe("no_usable_name_tokens");
  });
});

describe("sanctions freshness fails closed (Defect G)", () => {
  it("never produces a result when DFAT has no successful sync", async () => {
    const p = await provider(fakeAdmin({
      syncs: FRESH_SYNCS.filter((s) => s.list_code !== "dfat"), entries: [],
    }));
    await expect(p.runScreening(request(["sanctions"])))
      .rejects.toThrow(/sanctions_list_unavailable.*dfat/);
  });

  it("never produces a result when the DFAT sync is stale beyond the limit", async () => {
    const p = await provider(fakeAdmin({
      syncs: [
        sync("dfat", { completed_at: hoursAgo(100), started_at: hoursAgo(100) }),
        ...FRESH_SYNCS.filter((s) => s.list_code !== "dfat"),
      ],
      entries: [],
    }));
    await expect(p.runScreening(request(["sanctions"])))
      .rejects.toThrow(/sanctions_list_unavailable/);
  });

  it("never produces a result when the latest DFAT sync attempt FAILED, even with a fresh success behind it", async () => {
    // The list may be missing designations published since the failure —
    // 'latest sync failed' is a fail-closed condition in its own right.
    const p = await provider(fakeAdmin({
      syncs: [
        sync("dfat", { completed_at: hoursAgo(6), started_at: hoursAgo(6) }),
        sync("dfat", { status: "failed", completed_at: null, started_at: hoursAgo(1), entry_count: 0 }),
        ...FRESH_SYNCS.filter((s) => s.list_code !== "dfat"),
      ],
      entries: [],
    }));
    await expect(p.runScreening(request(["sanctions"])))
      .rejects.toThrow(/latest sync attempt failed/);
  });

  it("refuses a 'successful' sync that published zero entries", async () => {
    const p = await provider(fakeAdmin({
      syncs: [
        sync("dfat", { entry_count: 0 }),
        ...FRESH_SYNCS.filter((s) => s.list_code !== "dfat"),
      ],
      entries: [],
    }));
    await expect(p.runScreening(request(["sanctions"])))
      .rejects.toThrow(/sanctions_list_unavailable/);
  });

  it("a quieter list's fresh success is still seen when other lists sync more often", async () => {
    // A batched recent-syncs window used to be able to push dfat's latest
    // success out of view; the per-list lookups cannot.
    const noisy = Array.from({ length: 80 }, (_, i) =>
      sync("un", { completed_at: hoursAgo(1), started_at: hoursAgo(1), payload_sha256: String(i % 10).repeat(64) }));
    const p = await provider(fakeAdmin({
      syncs: [...noisy, sync("dfat"), sync("ofac")],
      entries: [],
    }));
    await expect(p.runScreening(request(["sanctions"]))).resolves.toMatchObject({ status: "clear" });
  });

  it("honours a tenant-configured freshness limit", async () => {
    const admin = fakeAdmin({
      syncs: [{ list_code: "dfat", status: "succeeded", completed_at: hoursAgo(10), payload_sha256: "a".repeat(64), entry_count: 100 }],
      entries: [],
    });
    const strict = await provider(admin, { max_list_age_hours: 4 });
    await expect(strict.runScreening(request(["sanctions"])))
      .rejects.toThrow(/sanctions_list_unavailable/);
    const lenient = await provider(admin, { max_list_age_hours: 24 });
    await expect(lenient.runScreening(request(["sanctions"]))).resolves.toMatchObject({ status: "clear" });
  });

  it("screens normally when the current sync succeeded, recording list evidence", async () => {
    const p = await provider(fakeAdmin({ syncs: FRESH_SYNCS, entries: [] }));
    const result = await p.runScreening(request(["sanctions"]));
    expect(result.status).toBe("clear");
    const freshness = (result.summary as any).list_freshness;
    expect(freshness.dfat.fresh).toBe(true);
    expect(freshness.dfat.required).toBe(true);
    expect((result.raw as any).list_versions.dfat).toMatch(/^a{12}@/);
  });

  it("keeps UN and OFAC as supplemental sources — reported, not blocking", async () => {
    const p = await provider(fakeAdmin({
      syncs: FRESH_SYNCS.filter((s) => s.list_code === "dfat"), entries: [],
    }));
    const result = await p.runScreening(request(["sanctions"]));
    expect(result.status).toBe("clear");
    const freshness = (result.summary as any).list_freshness;
    expect(freshness.un.fresh).toBe(false);
    expect(freshness.un.required).toBe(false);
  });
});
