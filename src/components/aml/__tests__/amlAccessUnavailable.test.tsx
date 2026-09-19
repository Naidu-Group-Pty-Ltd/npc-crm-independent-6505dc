/**
 * "We could not check" is not "you do not have it".
 *
 * A dropped connection, a timeout or a 5xx from `aml-access` used to arrive
 * as `flagEnabled: false` with no roles — the same values the server sends
 * when the answer really is no. Every surface then asserted a reason it did
 * not have: the guard said the module is not switched on for the
 * organisation, about a module that is switched on, and the navigation
 * quietly deleted a statutory workspace.
 *
 * This is the rule the partner surface already carries — a failure is never
 * cached and never reported as "off" — applied where a phone meets it first.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { AmlRole } from "@/hooks/useAmlAccess";

const refresh = vi.fn();
let access: {
  loading: boolean; flagEnabled: boolean; roles: Set<AmlRole>; hasAnyRole: boolean;
  canWrite: boolean; isMlro: boolean; unavailable: boolean; refresh: typeof refresh;
};
vi.mock("@/hooks/useAmlAccess", () => ({ useAmlAccess: () => access }));

import { AmlGuard } from "../AmlGuard";

const mount = () =>
  render(
    <MemoryRouter>
      <AmlGuard capability="aml.view"><div>the module</div></AmlGuard>
    </MemoryRouter>,
  );

beforeEach(() => {
  refresh.mockReset();
  access = {
    loading: false, flagEnabled: true, roles: new Set<AmlRole>(["mlro"]),
    hasAnyRole: true, canWrite: true, isMlro: true, unavailable: false, refresh,
  };
});

describe("the guard tells the truth about why it is refusing", () => {
  it("opens the module for somebody who has it", () => {
    mount();
    expect(screen.getByText("the module")).toBeInTheDocument();
  });

  it("says the read failed, rather than that the module is switched off", () => {
    access = { ...access, unavailable: true, flagEnabled: false, roles: new Set<AmlRole>(), hasAnyRole: false };
    mount();
    expect(screen.getByText(/couldn't check your access/i)).toBeInTheDocument();
    expect(screen.queryByText(/is not enabled/i)).toBeNull();
    expect(screen.queryByText(/don't have access to this area yet/i)).toBeNull();
  });

  it("offers the one thing that helps, and it works", () => {
    access = { ...access, unavailable: true, flagEnabled: false, roles: new Set<AmlRole>(), hasAnyRole: false };
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says nothing about permissions having changed", () => {
    /* The wording matters: this is the state an operator reaches on a train,
       and "contact your administrator" over a lost signal is how a working
       account gets reported as broken. */
    access = { ...access, unavailable: true, flagEnabled: false, roles: new Set<AmlRole>(), hasAnyRole: false };
    mount();
    expect(screen.getByText(/connection problem/i)).toBeInTheDocument();
    expect(screen.queryByText(/administrator/i)).toBeNull();
  });

  it("still says the module is off when the SERVER says so", () => {
    access = { ...access, flagEnabled: false, unavailable: false };
    mount();
    expect(screen.getByText(/AML\/CTF is not enabled/i)).toBeInTheDocument();
  });

  it("still says the access is missing when the SERVER says so", () => {
    access = { ...access, roles: new Set<AmlRole>(), hasAnyRole: false, unavailable: false };
    mount();
    expect(screen.getByText(/don't have access to this area yet/i)).toBeInTheDocument();
  });

  it("keeps the skeleton while the answer is on its way", () => {
    access = { ...access, loading: true };
    const { container } = mount();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText(/couldn't check/i)).toBeNull();
  });

  it("navigation still fails closed — a door that cannot be verified is not drawn", () => {
    /* The guard explains; the sidebar does not guess. `amlNavEntry` has no
       `unavailable` branch at all, which is the point. */
    const src = require("node:fs").readFileSync("src/lib/navigation/amlEntry.ts", "utf8");
    expect(src).not.toContain("unavailable");
  });
});
