import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { summary, terminology } = vi.hoisted(() => ({
  summary: vi.fn(),
  terminology: vi.fn(),
}));

vi.mock("./amlTenantApi", () => ({
  amlTenantApi: { summary, terminology },
}));

describe("useAmlTerminology", () => {
  beforeEach(() => {
    sessionStorage.clear();
    summary.mockReset();
    terminology.mockReset();
  });

  it("loads only the terminology projection", async () => {
    terminology.mockResolvedValue({
      terminology_overrides: { "Compliance Home": "AML Home" },
    });

    const { useAmlTerminology } = await import("./useAmlTerminology");
    const { result } = renderHook(() => useAmlTerminology());

    await waitFor(() => expect(result.current.t("Compliance Home")).toBe("AML Home"));
    expect(terminology).toHaveBeenCalledOnce();
    expect(summary).not.toHaveBeenCalled();
  });
});
