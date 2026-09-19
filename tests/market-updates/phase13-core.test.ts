import { beforeAll, describe, expect, test } from "bun:test";
import {
  canonicalPeriodWindow,
  type DigestPeriod,
} from "../../supabase/functions/market-updates-digest/periodWindow.ts";
import {
  normaliseClassification,
  validateClassification,
} from "../../supabase/functions/market-updates-ingest/classification.ts";

let safeSourceExcerpt: typeof import("../../supabase/functions/market-updates-ingest/adapters/security.ts").safeSourceExcerpt;
let normaliseUrl: typeof import("../../supabase/functions/market-updates-ingest/adapters/security.ts").normaliseUrl;

beforeAll(async () => {
  // The production helper reads Deno.env. Supplying only that narrow contract keeps
  // this test runnable under Bun without replacing any network or security logic.
  Object.assign(globalThis, {
    Deno: { env: { get: () => undefined } },
  });
  ({ safeSourceExcerpt, normaliseUrl } = await import(
    "../../supabase/functions/market-updates-ingest/adapters/security.ts"
  ));
});

describe("classification validation", () => {
  test("normalises fractional confidence and removes unsupported values", () => {
    const result = validateClassification({
      segments: ["finance", "invented", "finance"],
      audience_tags: ["investors", "not_an_audience"],
      geography: ["NSW", "Atlantis"],
      impact_level: "catastrophic",
      confidence_score: 0.84,
      ai_summary: "  Source-backed summary  ",
    });

    expect(result.category).toBe("finance");
    expect(result.segments).toEqual(["finance"]);
    expect(result.audience_tags).toEqual(["investors"]);
    expect(result.geography).toEqual(["NSW"]);
    expect(result.impact_level).toBe("low");
    expect(result.confidence_score).toBe(84);
    expect(result.ai_summary).toBe("Source-backed summary");
    expect(result.validation_failures).toEqual([
      "unsupported_segment_removed",
      "unsupported_audience_removed",
      "unsupported_geography_removed",
      "unsupported_impact_replaced",
    ]);
  });

  test("uses deterministic safe defaults for malformed classifier output", () => {
    const first = validateClassification({ confidence_score: 999 });
    const second = validateClassification({ confidence_score: 999 });
    expect(first).toEqual(second);
    expect(first.segments).toEqual(["property"]);
    expect(first.geography).toEqual(["Australia"]);
    expect(first.confidence_score).toBe(100);
    expect(first.validation_failures).toContain("summary_missing");
  });

  test("deduplicates accepted arrays and caps structured fields", () => {
    const result = normaliseClassification({
      segments: ["rental", "rental"],
      audience_tags: ["smsf", "smsf"],
      confidence_score: -10,
    });
    expect(result.segments).toEqual(["rental"]);
    expect(result.audience_tags).toEqual(["smsf"]);
    expect(result.confidence_score).toBe(0);
  });
});

describe("canonical digest windows", () => {
  const expected: Record<DigestPeriod, [string, string]> = {
    "24h": ["2026-07-26T00:00:00.000Z", "2026-07-27T00:00:00.000Z"],
    weekly: ["2026-07-20T00:00:00.000Z", "2026-07-27T00:00:00.000Z"],
    biweekly: ["2026-07-20T00:00:00.000Z", "2026-08-03T00:00:00.000Z"],
    monthly: ["2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
    quarterly: ["2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    annual: ["2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  };

  for (const period of Object.keys(expected) as DigestPeriod[]) {
    test(`${period} is stable throughout its canonical bucket`, () => {
      const first = canonicalPeriodWindow(period, new Date("2026-07-26T01:02:03Z"));
      const second = canonicalPeriodWindow(period, new Date("2026-07-26T23:59:59Z"));
      expect([first.start.toISOString(), first.end.toISOString()]).toEqual(expected[period]);
      expect(second.key).toBe(first.key);
      expect(first.key).toBe(`${period}:${expected[period][0]}`);
    });
  }
});

describe("source metadata and legal-storage helpers", () => {
  test("removes tracking parameters while retaining source URL identity", () => {
    expect(normaliseUrl(
      "https://news.example.com/item?id=42&utm_source=test#section",
      "https://news.example.com/feed",
      ["news.example.com"],
    )).toBe("https://news.example.com/item?id=42");
  });

  test("suppresses link-only excerpts and bounds transformative excerpts", () => {
    expect(safeSourceExcerpt(
      { copyright_mode: "link_and_metadata_only_unless_licensed" },
      "Do not persist",
    )).toBeNull();
    const excerpt = safeSourceExcerpt(
      { copyright_mode: "rss_excerpt_and_transformative_summary" },
      `<p>${"source ".repeat(300)}</p>`,
    );
    expect(excerpt).not.toContain("<p>");
    expect(excerpt!.length).toBeLessThanOrEqual(700);
  });
});
