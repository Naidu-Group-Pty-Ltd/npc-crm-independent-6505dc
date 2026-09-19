/**
 * `useIsMobile` — the answer on the FIRST render.
 *
 * The state started `undefined` (false) and corrected itself in an effect,
 * so every surface that switches layout on this hook drew its desktop form
 * for one frame on a phone and then swapped: a register flashing from a
 * table into a list, a modal snapping into a sheet. Twenty-three surfaces
 * use it, including the AUSTRAC register.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsMobile } from "../use-mobile";

const width = (px: number) =>
  Object.defineProperty(window, "innerWidth", { configurable: true, value: px });

afterEach(() => { width(1024); vi.restoreAllMocks(); });

const matchMedia = (matches: boolean) =>
  vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({
    matches, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

describe("the first answer is the true one", () => {
  it("reports a phone before any effect has run", () => {
    matchMedia(true);
    width(390);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("reports a desktop on a desktop", () => {
    matchMedia(false);
    width(1440);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("still lets the effect own every answer after the first", () => {
    /* Reading the breakpoint during initialisation must not become a second
       source of truth: the listener is what tracks a rotation or a resize,
       and it did before this change. */
    let handler: (() => void) | null = null;
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: (_: string, h: () => void) => { handler = h; },
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    width(1440);
    const { result, rerender } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(handler).toBeTypeOf("function");

    // The viewport narrows; the listener fires.
    width(390);
    handler!();
    rerender();
    expect(result.current).toBe(true);
  });
});
