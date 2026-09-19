import { describe, expect, it } from "vitest";
import {
  CLIENT_SEARCH_SELECT,
  buildClientSearchOrFilter,
  matchesAllTerms,
  sanitizeClientSearchQuery,
  selectActivationMatches,
  selectActivationPage,
  toActivationClientResult,
  tokenizeClientSearch,
  isBrowseQuery,
  isClientPickerStatus,
  orderBrowsedClients,
  clampPageSize,
  clampOffset,
  type ClientSearchRow,
} from "../../../supabase/functions/_shared/aml/clientSearchMatch.pure";

const rugesh: ClientSearchRow = {
  id: "11111111-1111-4111-8111-111111111111",
  is_active: false,
  primary_first_name: "Rugesh",
  primary_surname: "Naidu",
  primary_email: "rugesh@example.test",
  primary_mobile: "0400 111 222",
};

const activeAlex: ClientSearchRow = {
  id: "22222222-2222-4222-8222-222222222222",
  is_active: true,
  primary_first_name: "Alex",
  primary_middle_name: "P",
  primary_surname: "Naidu",
  primary_email: "alex@example.test",
  primary_mobile: null,
};

const unrelated: ClientSearchRow = {
  id: "33333333-3333-4333-8333-333333333333",
  is_active: true,
  primary_first_name: "Morgan",
  primary_surname: "Smith",
};

const secondaryOnly: ClientSearchRow = {
  id: "44444444-4444-4444-8444-444444444444",
  is_active: false,
  primary_first_name: null,
  primary_surname: null,
  secondary_first_name: "Priya",
  secondary_surname: "Naidu",
};

const rows = [rugesh, activeAlex, unrelated, secondaryOnly];

describe("AML activation client search — tokenised full-name matching", () => {
  it("finds a client by full first name", () => {
    const result = selectActivationMatches(rows, "Rugesh");
    expect(result.map((r) => r.id)).toContain(rugesh.id);
    expect(result.map((r) => r.id)).not.toContain(unrelated.id);
  });

  it("finds a client by full surname", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const ids = result.map((r) => r.id);
    expect(ids).toContain(rugesh.id);
    expect(ids).toContain(activeAlex.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it("finds a client by full name split across first name and surname columns", () => {
    // primary_first_name = Rugesh, primary_surname = Naidu — the full phrase
    // exists in no single column, but tokenised matching must still find it.
    const result = selectActivationMatches(rows, "Rugesh Naidu");
    expect(result.map((r) => r.id)).toEqual([rugesh.id]);
  });

  it("is case-insensitive", () => {
    expect(selectActivationMatches(rows, "rugesh naidu").map((r) => r.id))
      .toEqual([rugesh.id]);
    expect(selectActivationMatches(rows, "RUGESH NAIDU").map((r) => r.id))
      .toEqual([rugesh.id]);
  });

  it("matches partial first names and partial surnames", () => {
    expect(selectActivationMatches(rows, "Ruge").map((r) => r.id)).toContain(rugesh.id);
    expect(selectActivationMatches(rows, "Naid").map((r) => r.id)).toContain(rugesh.id);
    expect(selectActivationMatches(rows, "Ruge Naid").map((r) => r.id)).toEqual([rugesh.id]);
  });

  it("requires all tokens to appear in the same applicant's name", () => {
    // "Rugesh Smith" mixes two different clients — must match neither.
    expect(selectActivationMatches(rows, "Rugesh Smith")).toEqual([]);
    expect(matchesAllTerms(rugesh, ["rugesh", "smith"])).toBe(false);
  });

  it("matches on the secondary applicant's name too", () => {
    expect(selectActivationMatches(rows, "Priya Naidu").map((r) => r.id))
      .toEqual([secondaryOnly.id]);
  });

  it("includes inactive clients in the results (selectable)", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const inactive = result.filter((r) => r.is_active !== true);
    expect(inactive.map((r) => r.id)).toContain(rugesh.id);
  });

  it("orders active matches before inactive ones and reports statuses accurately", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const projected = result.map((r) => toActivationClientResult(r, false));
    expect(projected[0]).toMatchObject({ id: activeAlex.id, is_active: true });
    const rugeshResult = projected.find((p) => p.id === rugesh.id);
    expect(rugeshResult).toMatchObject({
      is_active: false,
      label: "Rugesh Naidu",
      email: "rugesh@example.test",
      mobile: "0400 111 222",
    });
  });

  it("trims repeated spaces and safely strips filter metacharacters", () => {
    expect(sanitizeClientSearchQuery("  Rugesh    Naidu  ")).toBe("Rugesh Naidu");
    expect(sanitizeClientSearchQuery("Rugesh%,()\\Naidu")).toBe("Rugesh Naidu");
    expect(selectActivationMatches(rows, "  rugesh    naidu  ").map((r) => r.id))
      .toEqual([rugesh.id]);
  });

  it("builds a PostgREST or-filter covering every name column per token", () => {
    const filter = buildClientSearchOrFilter(tokenizeClientSearch("Rugesh Naidu"));
    for (const col of [
      "primary_first_name", "primary_surname", "secondary_first_name", "secondary_surname",
    ]) {
      expect(filter).toContain(`${col}.ilike.%Rugesh%`);
      expect(filter).toContain(`${col}.ilike.%Naidu%`);
    }
    // Stripped metacharacters can never reach the filter tokens.
    const tokens = tokenizeClientSearch(sanitizeClientSearchQuery("a(),%b cd"));
    expect(tokens.join("")).not.toMatch(/[(),%\\]/);
  });

  it("projects identification data only — no financial fields", () => {
    expect(CLIENT_SEARCH_SELECT).not.toMatch(/portfolio|debt|cash_flow|income/);
    const projected = toActivationClientResult(rugesh, true);
    expect(Object.keys(projected).sort()).toEqual(
      ["email", "has_open_case", "id", "is_active", "label", "mobile"],
    );
    expect(projected.has_open_case).toBe(true);
  });

  it("caps the result set", () => {
    const many: ClientSearchRow[] = Array.from({ length: 60 }, (_, i) => ({
      id: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
      is_active: i % 2 === 0,
      primary_first_name: "Rugesh",
      primary_surname: "Naidu",
    }));
    expect(selectActivationMatches(many, "Naidu").length).toBe(20);
  });
});

/**
 * Browse mode — the picker before anybody types.
 *
 * The picker returned `[]` for anything shorter than two characters, so
 * opening the activation dialog showed an empty box. On this deployment that
 * hid 775 clients (40 active, 735 inactive) behind having to already know a
 * name and spell it — which is exactly what "clients I already have are not
 * available here" felt like from the outside.
 *
 * These pin the two halves: browse must not fall through the search path, and
 * a page must always report the true total rather than its own length.
 */
describe("browse mode", () => {
  it("treats an empty or one-character query as browse, not as search", () => {
    expect(isBrowseQuery("")).toBe(true);
    expect(isBrowseQuery("   ")).toBe(true);
    expect(isBrowseQuery("R")).toBe(true);
    expect(isBrowseQuery("Na")).toBe(false);
    // Metacharacters are stripped before the length is judged, so a query of
    // pure punctuation browses rather than searching for nothing.
    expect(isBrowseQuery("%(),")).toBe(true);
  });

  it("puts active clients first so 40 do not sit behind 735", () => {
    const ordered = orderBrowsedClients([rugesh, activeAlex, unrelated]);
    expect(ordered.map((r) => r.is_active)).toEqual([true, true, false]);
    // Order within a group is the database's, untouched.
    expect(ordered.slice(0, 2).map((r) => r.id)).toEqual([activeAlex.id, unrelated.id]);
  });

  it("clamps a caller-supplied page size and offset", () => {
    expect(clampPageSize(undefined)).toBe(25);
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(5000)).toBe(50);
    expect(clampPageSize(-3)).toBe(25);
    expect(clampPageSize("abc")).toBe(25);
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-9)).toBe(0);
    expect(clampOffset(75)).toBe(75);
  });

  it("recognises the three register slices and nothing else", () => {
    expect(isClientPickerStatus("all")).toBe(true);
    expect(isClientPickerStatus("active")).toBe(true);
    expect(isClientPickerStatus("inactive")).toBe(true);
    expect(isClientPickerStatus("archived")).toBe(false);
    expect(isClientPickerStatus(undefined)).toBe(false);
  });
});

describe("a page of search results reports the true total", () => {
  const many: ClientSearchRow[] = Array.from({ length: 48 }, (_, i) => ({
    id: `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
    is_active: i < 8,
    primary_first_name: "Rugesh",
    primary_surname: "Naidu",
  }));

  it("counts what matched, never what it returned", () => {
    const page = selectActivationPage(many, "Naidu", 25, 0);
    expect(page.rows).toHaveLength(25);
    // A page size masquerading as a total is how a picker quietly tells an
    // operator that a client does not exist.
    expect(page.total).toBe(48);
  });

  it("pages without losing or repeating a row", () => {
    const first = selectActivationPage(many, "Naidu", 25, 0);
    const second = selectActivationPage(many, "Naidu", 25, 25);
    expect(second.rows).toHaveLength(23);
    expect(second.total).toBe(48);
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(48);
  });

  it("takes the page after the strict match, not before it", () => {
    // The database pre-filter is deliberately wide and cannot express the
    // all-tokens-on-one-person rule. Slicing first would page over rows that
    // were about to be discarded, and drop real matches off the end.
    const mixed = [unrelated, rugesh, activeAlex];
    const page = selectActivationPage(mixed, "Naidu", 2, 0);
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.id)).toEqual([activeAlex.id, rugesh.id]);
  });

  it("returns nothing for a browse query rather than everything", () => {
    // Browse is a different database filter; this function must not silently
    // become "all clients" when the query is empty.
    expect(selectActivationPage(many, "", 25, 0)).toEqual({ rows: [], total: 0 });
  });
});

/**
 * Email matching.
 *
 * An operator holding an enquiry email expects to paste it in — but the
 * load-bearing reason is duplicate detection before a client is created. A
 * name check cannot match "Rob Smith" to an existing "Robert Smith"; the
 * shared address will.
 */
describe("email is searchable, without loosening the one-person rule", () => {
  const withEmails: ClientSearchRow = {
    id: "77777777-7777-4777-8777-777777777777",
    is_active: true,
    primary_first_name: "Robert",
    primary_surname: "Smith",
    primary_email: "robert@example.test",
    secondary_first_name: "Dana",
    secondary_surname: "Okafor",
    secondary_email: "dana@example.test",
  };

  it("matches a full email address", () => {
    const terms = tokenizeClientSearch(sanitizeClientSearchQuery("robert@example.test"));
    expect(matchesAllTerms(withEmails, terms)).toBe(true);
  });

  it("matches the secondary applicant on their own email", () => {
    const terms = tokenizeClientSearch(sanitizeClientSearchQuery("dana@example.test"));
    expect(matchesAllTerms(withEmails, terms)).toBe(true);
  });

  it("never assembles a match across two different people", () => {
    // "Dana" from the secondary applicant plus the PRIMARY applicant's email
    // is not a person. Widening the haystack must not widen this.
    const terms = tokenizeClientSearch(sanitizeClientSearchQuery("dana robert@example.test"));
    expect(matchesAllTerms(withEmails, terms)).toBe(false);
  });

  it("still matches a name that shares no tokens with any email", () => {
    expect(matchesAllTerms(withEmails, ["robert", "smith"])).toBe(true);
    expect(matchesAllTerms(withEmails, ["robert", "okafor"])).toBe(false);
  });

  it("asks the database for email columns as well as name columns", () => {
    const filter = buildClientSearchOrFilter(["smith"]);
    expect(filter).toContain("primary_email.ilike.%smith%");
    expect(filter).toContain("secondary_email.ilike.%smith%");
    // ...and selects them, or the in-memory match could never see them.
    expect(CLIENT_SEARCH_SELECT).toContain("secondary_email");
  });
});
