/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { PricingMockBanner } from "../PricingMockBanner";
import { PRICING_MOCK_STORAGE_KEY, isPricingMockEnabled } from "@/lib/pricingMock";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PricingMockBanner />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
});

describe("PricingMockBanner", () => {
  it("stays out of the way when the mode is off", () => {
    at("/dashboard");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("arms the mode from the URL and says so", () => {
    at("/dashboard?pricingMock=1");
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/Stripe test catalogue is active/i)).toBeTruthy();
    expect(isPricingMockEnabled()).toBe(true);
  });

  /**
   * The whole point of the banner: a mode that silently rewrites every purchase
   * button has to be visible for as long as it is on, not just on the page that
   * turned it on.
   */
  it("keeps showing on a later page that carries no parameter", () => {
    window.localStorage.setItem(PRICING_MOCK_STORAGE_KEY, "1");
    at("/clients");
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("disarms from the URL", () => {
    window.localStorage.setItem(PRICING_MOCK_STORAGE_KEY, "1");
    at("/dashboard?pricingMock=0");
    expect(screen.queryByRole("status")).toBeNull();
    expect(isPricingMockEnabled()).toBe(false);
  });

  it("offers a way out that actually clears the setting", () => {
    at("/dashboard?pricingMock=1");
    fireEvent.click(screen.getByRole("button", { name: /exit stripe test mode/i }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(isPricingMockEnabled()).toBe(false);
  });

  it("links to the catalogue it is routing purchases at", () => {
    at("/dashboard?pricingMock=1");
    const link = screen.getByRole("link", { name: /open the catalogue/i }) as HTMLAnchorElement;
    expect(link.href).toContain("/pricing-mock");
    expect(link.rel).toContain("noreferrer");
  });
});
