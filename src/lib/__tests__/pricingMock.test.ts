import { beforeEach, describe, expect, it } from "vitest";
import {
  AURIXA_PRICING_MOCK_URL,
  PRICING_MOCK_STORAGE_KEY,
  applyPricingMockRouting,
  intentUsesMockPricing,
  isPricingMockEnabled,
  readPricingMockOverride,
  rewriteToMockPricing,
  setPricingMockEnabled,
} from "@/lib/pricingMock";

beforeEach(() => {
  window.localStorage.clear();
});

describe("rewriteToMockPricing", () => {
  it("swaps the path and keeps the handoff query, so the link stays traceable", () => {
    expect(rewriteToMockPricing("https://www.aurixasystems.com.au/pricing?h=abc123")).toBe(
      "https://www.aurixasystems.com.au/pricing-mock?h=abc123",
    );
  });

  it("accepts the apex host Mission Control may mint against", () => {
    expect(rewriteToMockPricing("https://aurixasystems.com.au/pricing?uid=npc-prime")).toBe(
      "https://aurixasystems.com.au/pricing-mock?uid=npc-prime",
    );
  });

  it("replaces a deep pricing path rather than appending to it", () => {
    expect(rewriteToMockPricing("https://www.aurixasystems.com.au/pricing/success")).toBe(
      "https://www.aurixasystems.com.au/pricing-mock",
    );
  });

  /**
   * The failure direction that matters. An unrecognised URL must not be passed
   * through while the mode is on — passing it through is what would open a
   * live-priced checkout during a test sweep.
   */
  it.each([
    "https://aurixasystems.com.au.evil.example/pricing",
    "https://evil-aurixasystems.com.au/pricing",
    "https://www.aurixasystems.com.au.attacker.test/pricing",
    "http://www.aurixasystems.com.au/pricing",
    "https://user:pass@www.aurixasystems.com.au/pricing",
    "https://www.aurixasystems.com.au:8443/pricing",
    "not a url at all",
    "",
  ])("falls back to the canonical mock URL for %s", (url) => {
    expect(rewriteToMockPricing(url)).toBe(AURIXA_PRICING_MOCK_URL);
  });
});

describe("intentUsesMockPricing", () => {
  it.each(["topup", "seat_plan", "setup_package", "pricing", "catalog"])(
    "routes %s at the mock catalogue",
    (intent) => {
      expect(intentUsesMockPricing(intent)).toBe(true);
    },
  );

  /**
   * Saving a card is a Stripe setup-mode session — no money moves at any price,
   * and the mock page has no card-save flow to land on. Routing it there would
   * break the one billing journey that was already safe to test live.
   */
  it("leaves save_card alone", () => {
    expect(intentUsesMockPricing("save_card")).toBe(false);
  });

  it("leaves an unknown intent alone rather than guessing", () => {
    expect(intentUsesMockPricing("something_new")).toBe(false);
  });
});

describe("readPricingMockOverride", () => {
  it.each(["?pricingMock=1", "?pricingMock=true", "?pricingMock=ON", "?pricingMock="])(
    "reads %s as on",
    (search) => {
      expect(readPricingMockOverride(search)).toBe(true);
    },
  );

  it.each(["?pricingMock=0", "?pricingMock=false", "?pricingMock=off"])(
    "reads %s as off",
    (search) => {
      expect(readPricingMockOverride(search)).toBe(false);
    },
  );

  /**
   * "Not mentioned" has to stay distinct from "turned off", or every navigation
   * without the parameter would silently disarm a mode the tester had set.
   */
  it("returns null when the parameter is absent, so a stored setting survives", () => {
    expect(readPricingMockOverride("")).toBeNull();
    expect(readPricingMockOverride("?tab=billing")).toBeNull();
  });

  it("returns null for a value it does not understand", () => {
    expect(readPricingMockOverride("?pricingMock=maybe")).toBeNull();
  });
});

describe("the toggle", () => {
  it("is off until set, and survives being read back", () => {
    expect(isPricingMockEnabled()).toBe(false);
    setPricingMockEnabled(true);
    expect(window.localStorage.getItem(PRICING_MOCK_STORAGE_KEY)).toBe("1");
    expect(isPricingMockEnabled()).toBe(true);
    setPricingMockEnabled(false);
    expect(isPricingMockEnabled()).toBe(false);
  });
});

describe("applyPricingMockRouting", () => {
  const live = "https://www.aurixasystems.com.au/pricing?h=abc123";

  it("passes the resolved URL straight through while the mode is off", () => {
    expect(applyPricingMockRouting(live, "topup")).toBe(live);
  });

  it("steers a money-moving CTA at the mock catalogue while the mode is on", () => {
    setPricingMockEnabled(true);
    expect(applyPricingMockRouting(live, "topup")).toBe(
      "https://www.aurixasystems.com.au/pricing-mock?h=abc123",
    );
    expect(applyPricingMockRouting(live, "seat_plan")).toContain("/pricing-mock");
  });

  it("still sends save_card to the real flow while the mode is on", () => {
    setPricingMockEnabled(true);
    const saveCard = "https://www.aurixasystems.com.au/pricing?uid=npc-prime&action=save-card";
    expect(applyPricingMockRouting(saveCard, "save_card")).toBe(saveCard);
  });

  it("does not touch a Mission Control URL that is not the storefront when off", () => {
    const mc = "https://mission.example.com/billing";
    expect(applyPricingMockRouting(mc, "topup")).toBe(mc);
  });
});
