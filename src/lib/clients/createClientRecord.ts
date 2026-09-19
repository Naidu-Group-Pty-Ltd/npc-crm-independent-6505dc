import { invokeSecureFunction } from "@/lib/secureInvoke";

/**
 * Create a client in the central register.
 *
 * ── Why this is a shared function ─────────────────────────────────────
 * There was no wrapper for this. `StandardAddClientForm`, `AdvancedClientForm`
 * and the finance portal each called `invokeSecureFunction('manage-client-data',
 * …)` inline with their own hand-built payloads, so "how a client is created"
 * was a shape three files happened to agree on. Adding a fourth caller (the
 * AML activation dialog) by copying that payload again would have made it four.
 *
 * ── One creation path, one permission ─────────────────────────────────
 * This goes through `manage-client-data`, the canonical staff CRM endpoint,
 * exactly as Client Management does. It is NOT a second way to make a client:
 *
 *  • the same op (`operation: 'create', table: 'clients'`),
 *  • the same permission (`client_management.can_edit`) — creating a client is
 *    a client-management action, and holding an AML role is not authority to
 *    create one. A caller without it gets a 403 and can still select an
 *    existing client. Affordance is not authorisation.
 *  • the same server-side column allowlist, `created_by` stamping and address
 *    normalisation.
 *
 * The register (`public.clients`) therefore stays the single source of truth,
 * and a client created from the AML dialog is indistinguishable from one
 * created in Client Management — because it was created the same way.
 */

export interface NewClientInput {
  firstName: string;
  surname: string;
  email?: string;
  mobile?: string;
}

export interface CreatedClientRecord {
  id: string;
  primary_first_name: string | null;
  primary_surname: string | null;
  primary_email: string | null;
  primary_mobile: string | null;
}

/**
 * `primary_first_name` and `primary_surname` are the only NOT NULL columns on
 * `public.clients`, so they are the only two required here.
 *
 * They are also required TOGETHER, which is not obvious. `manage-ci-assessments`
 * accepts "a first name OR a surname" and then writes `null` into a NOT NULL
 * column, turning a friendly 400 into an opaque Postgres 23502 surfaced as a
 * 500. This validates what the column actually demands.
 */
export function validateNewClient(input: NewClientInput): string | null {
  if (!input.firstName.trim()) return "A first name is required.";
  if (!input.surname.trim()) return "A surname is required.";
  if (input.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    return "That email address does not look valid.";
  }
  return null;
}

export async function createClientRecord(
  input: NewClientInput,
): Promise<CreatedClientRecord> {
  const invalid = validateNewClient(input);
  if (invalid) throw new Error(invalid);

  const { data, error } = await invokeSecureFunction<{ data?: CreatedClientRecord }>(
    "manage-client-data",
    {
      operation: "create",
      table: "clients",
      clientId: "",
      data: {
        primary_first_name: input.firstName.trim(),
        primary_surname: input.surname.trim(),
        primary_email: input.email?.trim() || null,
        primary_mobile: input.mobile?.trim() || null,
      },
    },
    { timeoutMs: 20000 },
  );

  if (error) throw new Error(error.message || "The client could not be created.");

  // `manage-client-data` answers `{ success: true, result: <row> }`. Earlier this
  // read `data.data`, which never exists on that envelope — so every creation
  // succeeded server-side and reported "the client was not returned". Accept the
  // canonical `result` first, then the historical shapes, and unwrap arrays
  // (the create branch can answer with a row array).
  const body = data as any;
  if (body && body.success === false) {
    throw new Error(body.error || "The client could not be created.");
  }
  const candidate = body?.result ?? body?.data?.result ?? body?.data ?? body;
  const created = Array.isArray(candidate) ? candidate[0] : candidate;
  if (!created?.id) {
    throw new Error("The client was not returned by the server, so it cannot be activated yet.");
  }
  return created as CreatedClientRecord;

}
