import { describe, expect, it } from "vitest";

import { hasCopilotObjectPermission } from "../finance-portal-copilot-auth.ts";

describe("hasCopilotObjectPermission", () => {
  it("denies access when the finance user has no client assignment", () => {
    expect(hasCopilotObjectPermission({}, [], "victim-pf", "view")).toBe(false);
  });

  it("does not apply an assignment scoped to a different purchase file", () => {
    const assignments = [{ purchase_file_id: "assigned-pf", permissions: { purchase_files: { view: true } } }];
    expect(hasCopilotObjectPermission({}, assignments, "victim-pf", "view")).toBe(false);
    expect(hasCopilotObjectPermission({}, assignments, "assigned-pf", "view")).toBe(true);
  });

  it("honours client-wide assignments and edit permissions", () => {
    const assignments = [{ purchase_file_id: null, permissions: { purchase_files: { view: true, edit: false } } }];
    expect(hasCopilotObjectPermission({}, assignments, "assigned-pf", "view")).toBe(true);
    expect(hasCopilotObjectPermission({}, assignments, "assigned-pf", "edit")).toBe(false);
  });

  it("preserves legacy access for an assigned client with no configured matrix", () => {
    expect(hasCopilotObjectPermission({}, [{ purchase_file_id: null, permissions: {} }], "assigned-pf", "edit")).toBe(true);
  });

  it("does not use a deal-scoped assignment for client-only context", () => {
    const assignments = [{ purchase_file_id: "assigned-pf", permissions: { purchase_files: { view: true } } }];
    expect(hasCopilotObjectPermission({}, assignments, null, "view")).toBe(false);
  });
});
