import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { categoryForSegment, normaliseClassification, validateClassification } from "../classification.ts";

Deno.test("segment categories use persisted database values", () => {
  assertEquals(categoryForSegment("property"), "property_market");
  assertEquals(categoryForSegment("economic"), "economy");
  assertEquals(categoryForSegment("rental"), "rental_market");
  assertEquals(categoryForSegment("social"), "other");
});

Deno.test("classification validates geography, impact and required summary", () => {
  const result = validateClassification({
    category: "finance", segments: ["finance"], audience_tags: [],
    geography: ["NSW", "Mars"], impact_level: "urgent", ai_summary: "",
    confidence_score: 75,
  });
  assertEquals(result.geography, ["NSW"]);
  assertEquals(result.impact_level, "low");
  assertEquals(result.validation_failures, ["unsupported_geography_removed", "unsupported_impact_replaced", "summary_missing"]);
});

Deno.test("classification removes incompatible audience tags", () => {
  const result = normaliseClassification({
    category: "property",
    segments: ["property", "social", "invalid"],
    audience_tags: ["buyers", "investors", "mortgage_brokers", "policy"],
    confidence_score: 120,
  });
  assertEquals(result.category, "property_market");
  assertEquals(result.segments, ["property", "social"]);
  assertEquals(result.audience_tags, ["investors", "mortgage_brokers"]);
  assertEquals(result.confidence_score, 100);
});

Deno.test("classification preserves a confidence score of exactly one", () => {
  const result = normaliseClassification({
    category: "property",
    segments: ["property"],
    audience_tags: [],
    confidence_score: 1,
  });
  const coercedResult = normaliseClassification({
    category: "property",
    segments: ["property"],
    audience_tags: [],
    confidence_score: "1",
  });

  assertEquals(result.confidence_score, 1);
  assertEquals(coercedResult.confidence_score, 1);
});

Deno.test("classification still normalises unambiguous fractional confidence scores", () => {
  const result = normaliseClassification({
    category: "property",
    segments: ["property"],
    audience_tags: [],
    confidence_score: 0.75,
  });

  assertEquals(result.confidence_score, 75);
});
