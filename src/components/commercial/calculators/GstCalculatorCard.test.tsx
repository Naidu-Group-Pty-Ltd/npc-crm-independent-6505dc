/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GstCalculatorCard } from "./GstCalculatorCard";

const pushBack = vi.fn();
const updateGlobal = vi.fn();
const setSourceMode = vi.fn();
let property: Record<string, unknown>;
/*
 * The prefill is a fixture in its own right, not a constant.
 *
 * The card reads the purchase price from `prefill.purchasePrice` — the
 * projection `CalculatorPrefillContext` builds at `purchasePrice:
 * p.purchase_price ?? null` — and never off the raw property row. Pinning the
 * prefill to a literal with no price while putting `purchase_price` on
 * `property` therefore left `hasAnySaveValue` false, so "Save Back to Property"
 * rendered disabled, the click did nothing, and the confirmation dialog holding
 * "Save and refresh GST" was never mounted for the second test to find.
 */
let prefill: Record<string, unknown>;

vi.mock("@/contexts/CalculatorPrefillContext", () => ({
  useCalculatorPrefill: () => ({ prefill, property, pushBack }),
}));

vi.mock("@/utils/commercial/commercialDealState", () => ({
  useCommercialDealState: (selector: (state: unknown) => unknown) =>
    selector({ updateGlobal, setSourceMode }),
}));

describe("GstCalculatorCard save back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    property = { id: "property-1" };
    prefill = { propertyId: "property-1", address: "1 Test Street" };
  });

  it("does not enable property save when only non-persisted assumptions are set", () => {
    property = { ...property, purchaser_gst_registered: true };

    render(<GstCalculatorCard />);

    expect(
      screen.getByRole("button", { name: "Save Back to Property" }),
    ).toBeDisabled();
  });

  it("does not refresh downstream state when the property save fails", async () => {
    property = { ...property, purchase_price: 1_000_000 };
    prefill = { ...prefill, purchasePrice: 1_000_000 };
    pushBack.mockResolvedValue({ ok: false, error: "database failure" });

    render(<GstCalculatorCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Save Back to Property" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and refresh GST" }));

    await waitFor(() => expect(pushBack).toHaveBeenCalled());
    expect(updateGlobal).not.toHaveBeenCalled();
    expect(setSourceMode).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/saved to the property profile/i),
    ).not.toBeInTheDocument();
  });
});
