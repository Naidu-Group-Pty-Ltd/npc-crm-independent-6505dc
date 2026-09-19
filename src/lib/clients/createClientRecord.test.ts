/**
 * Creating a client from outside Client Management.
 *
 * The rule this pins: there is ONE creation path. The AML activation dialog
 * does not get its own insert, its own column set or its own permission — it
 * goes through `manage-client-data`, exactly as the CRM form does, so the row
 * it produces is indistinguishable from one created in Client Management and
 * `public.clients` stays the single source of truth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeSecureFunction = vi.fn();
vi.mock("@/lib/secureInvoke", () => ({
  invokeSecureFunction: (...a: unknown[]) => invokeSecureFunction(...a),
}));

import { createClientRecord, validateNewClient } from "./createClientRecord";

const ok = (row: Record<string, unknown>) => ({ data: { data: row }, error: null });

beforeEach(() => invokeSecureFunction.mockReset());

describe("validateNewClient", () => {
  it("requires both names, because both columns are NOT NULL", () => {
    // `manage-ci-assessments` accepts "first name OR surname" and then writes
    // null into a NOT NULL column — a Postgres 23502 surfaced as an opaque
    // 500. This validates what the column actually demands.
    expect(validateNewClient({ firstName: "", surname: "Raman" })).toMatch(/first name/i);
    expect(validateNewClient({ firstName: "Priya", surname: "" })).toMatch(/surname/i);
    expect(validateNewClient({ firstName: "Priya", surname: "Raman" })).toBeNull();
  });

  it("treats whitespace as absent", () => {
    expect(validateNewClient({ firstName: "   ", surname: "Raman" })).toMatch(/first name/i);
  });

  it("rejects a malformed email but allows none at all", () => {
    expect(validateNewClient({ firstName: "P", surname: "R", email: "nope" })).toMatch(/email/i);
    expect(validateNewClient({ firstName: "P", surname: "R", email: "" })).toBeNull();
    expect(validateNewClient({ firstName: "P", surname: "R", email: "p@e.test" })).toBeNull();
  });
});

describe("createClientRecord", () => {
  it("creates through manage-client-data — the same op the CRM form uses", () => {
    invokeSecureFunction.mockResolvedValue(ok({ id: "c1" }));
    return createClientRecord({ firstName: "Priya", surname: "Raman" }).then(() => {
      const [fn, body] = invokeSecureFunction.mock.calls[0] as [string, any];
      expect(fn).toBe("manage-client-data");
      expect(body.operation).toBe("create");
      expect(body.table).toBe("clients");
      // No client-side id, no created_by, no permission claim — the server
      // stamps provenance and checks `client_management.can_edit` itself.
      expect(body.data.created_by).toBeUndefined();
      expect(body.data).toEqual({
        primary_first_name: "Priya",
        primary_surname: "Raman",
        primary_email: null,
        primary_mobile: null,
      });
    });
  });

  it("trims, and sends null rather than empty strings", async () => {
    invokeSecureFunction.mockResolvedValue(ok({ id: "c1" }));
    await createClientRecord({
      firstName: "  Priya ", surname: " Raman ", email: "  ", mobile: " 0400 ",
    });
    const body = invokeSecureFunction.mock.calls[0][1] as any;
    expect(body.data.primary_first_name).toBe("Priya");
    expect(body.data.primary_email).toBeNull();
    expect(body.data.primary_mobile).toBe("0400");
  });

  it("validates before spending a round trip", async () => {
    await expect(createClientRecord({ firstName: "", surname: "" })).rejects.toThrow();
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it("surfaces the server's own message — a 403 must read as a 403", async () => {
    invokeSecureFunction.mockResolvedValue({
      data: null, error: { message: "Insufficient permissions" },
    });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .rejects.toThrow("Insufficient permissions");
  });

  it("refuses a success with no row, because the caller is about to activate it", async () => {
    // A created client with no id cannot be activated, and pretending
    // otherwise would strand the operator on a form that can never submit.
    invokeSecureFunction.mockResolvedValue({ data: { data: {} }, error: null });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .rejects.toThrow(/cannot be activated/i);
  });

  it("reads the envelope manage-client-data actually returns: { success, result }", async () => {
    // This is the shape the live function answers with. Reading `data.data`
    // meant every successful creation reported "the client was not returned",
    // which is what blocked AML activation for a brand-new client.
    invokeSecureFunction.mockResolvedValue({
      data: { success: true, result: { id: "real", primary_first_name: "Priya" } },
      error: null,
    });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .resolves.toMatchObject({ id: "real" });
  });

  it("unwraps a row array from the create branch", async () => {
    invokeSecureFunction.mockResolvedValue({
      data: { success: true, result: [{ id: "arr" }] }, error: null,
    });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .resolves.toMatchObject({ id: "arr" });
  });

  it("surfaces success:false with the server's message", async () => {
    invokeSecureFunction.mockResolvedValue({
      data: { success: false, error: "Insufficient permissions" }, error: null,
    });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .rejects.toThrow("Insufficient permissions");
  });

  it("accepts the row whether or not it is wrapped", async () => {
    invokeSecureFunction.mockResolvedValue({ data: { id: "bare" }, error: null });
    await expect(createClientRecord({ firstName: "P", surname: "R" }))
      .resolves.toMatchObject({ id: "bare" });
  });
});
