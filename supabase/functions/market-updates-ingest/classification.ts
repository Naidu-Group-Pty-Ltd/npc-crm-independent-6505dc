export const MARKET_SEGMENTS = [
  "finance", "property", "construction", "political", "economic", "social",
  "policy_regulation", "rental",
] as const;

export const MARKET_AUDIENCES = [
  "investors", "owner_occupiers", "first_home_buyers", "buyers_agents",
  "mortgage_brokers", "finance_brokers", "developers", "builders",
  "property_managers", "smsf",
] as const;

export const MARKET_GEOGRAPHIES = [
  "Australia", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT", "Multi",
] as const;
export const MARKET_IMPACTS = ["low", "medium", "high", "critical"] as const;

export const SEGMENT_CATEGORY = {
  finance: "finance",
  property: "property_market",
  construction: "construction",
  political: "political",
  economic: "economy",
  social: "other",
  policy_regulation: "policy_regulation",
  rental: "rental_market",
} as const;

export type MarketSegment = keyof typeof SEGMENT_CATEGORY;

export function categoryForSegment(value: unknown): string {
  return SEGMENT_CATEGORY[value as MarketSegment] ?? "other";
}

export function normaliseClassification<T extends Record<string, unknown>>(value: T): T & {
  category: string;
  segments: MarketSegment[];
  audience_tags: string[];
  confidence_score: number;
} {
  const requestedSegments = Array.isArray(value.segments) ? value.segments : [value.category];
  const segments = [...new Set(requestedSegments.filter((item): item is MarketSegment =>
    typeof item === "string" && MARKET_SEGMENTS.includes(item as MarketSegment)
  ))];
  if (!segments.length) segments.push("property");
  const audienceTags = Array.isArray(value.audience_tags)
    ? [...new Set(value.audience_tags.filter((item): item is string =>
      typeof item === "string" && MARKET_AUDIENCES.includes(item as typeof MARKET_AUDIENCES[number])
    ))]
    : [];
  let confidence = Number(value.confidence_score);
  if (!Number.isFinite(confidence)) confidence = 0;
  // Some models return 0-1 fractions instead of the requested 0-100 scale.
  if (confidence > 0 && confidence < 1) confidence = confidence * 100;
  confidence = Math.max(0, Math.min(100, confidence));
  return {
    ...value,
    category: categoryForSegment(segments[0]),
    segments,
    audience_tags: audienceTags,
    confidence_score: confidence,
  };
}

export function validateClassification<T extends Record<string, unknown>>(value: T) {
  const failures: string[] = [];
  const normalized = normaliseClassification(value);
  const requestedSegments = Array.isArray(value.segments) ? value.segments : [value.category];
  if (requestedSegments.some(item => typeof item !== "string" || !MARKET_SEGMENTS.includes(item as MarketSegment))) failures.push("unsupported_segment_removed");
  if (Array.isArray(value.audience_tags) && value.audience_tags.some(item => typeof item !== "string" || !MARKET_AUDIENCES.includes(item as typeof MARKET_AUDIENCES[number]))) failures.push("unsupported_audience_removed");
  const geography = Array.isArray(value.geography)
    ? [...new Set(value.geography.filter((item): item is typeof MARKET_GEOGRAPHIES[number] => typeof item === "string" && MARKET_GEOGRAPHIES.includes(item as typeof MARKET_GEOGRAPHIES[number])))]
    : [];
  if (Array.isArray(value.geography) && geography.length !== value.geography.length) failures.push("unsupported_geography_removed");
  if (!geography.length) geography.push("Australia");
  const impact = typeof value.impact_level === "string" && MARKET_IMPACTS.includes(value.impact_level as typeof MARKET_IMPACTS[number])
    ? value.impact_level : "low";
  if (impact !== value.impact_level) failures.push("unsupported_impact_replaced");
  const stringArray = (candidate: unknown, max = 12) => Array.isArray(candidate)
    ? [...new Set(candidate.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean))].slice(0, max)
    : [];
  const summary = typeof value.ai_summary === "string" ? value.ai_summary.trim().slice(0, 1200) : "";
  if (!summary) failures.push("summary_missing");
  return {
    ...normalized,
    geography,
    impact_level: impact,
    ai_summary: summary || null,
    key_points: stringArray(value.key_points, 8),
    risk_flags: stringArray(value.risk_flags, 12),
    lending_criteria_tags: stringArray(value.lending_criteria_tags, 20),
    legal_topics: stringArray(value.legal_topics, 20),
    economic_topics: stringArray(value.economic_topics, 20),
    validation_failures: failures,
  };
}
