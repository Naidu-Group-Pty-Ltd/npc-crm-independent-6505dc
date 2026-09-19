import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStepUpToken, setStepUpToken } from "./stepUpTokenStore";

describe("AML step-up token store", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("keeps bearer tokens in memory and out of sessionStorage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { setItem });

    setStepUpToken("aml.report", {
      session_token: "short-lived-secret",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(getStepUpToken("aml.report")).toBe("short-lived-secret");
    expect(setItem).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("removes expired bearer tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    setStepUpToken("aml.configure", {
      session_token: "expired-secret",
      expires_at: "2025-12-31T23:59:59.000Z",
    });

    expect(getStepUpToken("aml.configure")).toBeNull();
  });
});
