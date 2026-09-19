import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivateClientDialog } from "../ActivateClientDialog";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const getClientForActivation = vi.fn();
const listClientsForActivation = vi.fn();
const activateClient = vi.fn();
const clientSummary = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    getClientForActivation: (...a: unknown[]) => getClientForActivation(...a),
    listClientsForActivation: (...a: unknown[]) => listClientsForActivation(...a),
    activateClient: (...a: unknown[]) => activateClient(...a),
    clientSummary: (...a: unknown[]) => clientSummary(...a),
  },
}));

/** A picker page as the server returns it. */
const page = (
  clients: unknown[],
  extra: { total?: number; has_more?: boolean; browsing?: boolean } = {},
) => ({
  clients,
  total: extra.total ?? clients.length,
  has_more: extra.has_more ?? false,
  browsing: extra.browsing ?? true,
});
const createClientRecord = vi.fn();
vi.mock("@/lib/clients/createClientRecord", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createClientRecord: (...a: unknown[]) => createClientRecord(...a),
}));
vi.mock("@/lib/aml/amlTenantApi", () => ({
  amlTenantApi: { getActivationProgram: vi.fn().mockResolvedValue(null) },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

const inactiveClient = {
  id: CLIENT_ID,
  label: "Rugesh Naidu",
  email: "rugesh@example.test",
  mobile: "0400 111 222",
  is_active: false,
  has_open_case: false,
  open_case: null,
};

function setup(props: Partial<Parameters<typeof ActivateClientDialog>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onActivated = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ActivateClientDialog
        open
        onOpenChange={onOpenChange}
        onActivated={onActivated}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onActivated, onOpenChange };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Activation event"), {
    target: { value: "Signed engagement letter" },
  });
  fireEvent.change(screen.getByLabelText(/Reason & evidence/), {
    target: { value: "Executed agency agreement received on file." },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirm activation event" }));
}

beforeEach(() => {
  getClientForActivation.mockReset();
  listClientsForActivation.mockReset();
  // The picker browses on open, so every test needs a default page.
  listClientsForActivation.mockResolvedValue(page([]));
  activateClient.mockReset();
  clientSummary.mockReset();
  clientSummary.mockResolvedValue({ case: null, has_open_case: false });
  createClientRecord.mockReset();
  toast.mockReset();
});

describe("ActivateClientDialog — route/record preselection", () => {
  it("loads the exact client server-side and prefills the subject name from the authoritative record", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID, clientName: "Tampered Browser Name" });

    await waitFor(() => expect(getClientForActivation).toHaveBeenCalledWith(CLIENT_ID));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Rugesh Naidu"));

    // Prefilled from the server record, not the caller-supplied label.
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Rugesh Naidu");
    expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("rugesh@example.test");
    expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("0400 111 222");
  });

  it("shows the inactive status and the activation-on-confirm messages for an inactive client", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText(/Inactive client — this client will be marked active/)).toBeInTheDocument());
    expect(screen.getByText(/This client is currently inactive\. Confirming this form will activate the client and start AML\/CTF compliance\./)).toBeInTheDocument();
    // The old dead-end wording must be gone.
    expect(screen.queryByText(/Mark the client active on their record first/)).not.toBeInTheDocument();
  });

  it("explains the first missing requirement, then submits with the trusted client id", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    activateClient.mockResolvedValue({
      case: { id: "case-1", client_id: CLIENT_ID, case_reference: "AML-2026-00001" },
      client_activation: { was_inactive: true, marked_active: true },
      client_portal: { has_portal_access: true, notified: true, note: "Notified." },
    });
    const { onActivated } = setup({ clientId: CLIENT_ID });

    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());
    const activate = screen.getByRole("button", { name: "Activate client" });
    expect(activate).toBeEnabled();
    fireEvent.click(activate);
    expect(await screen.findByTestId("ac-submit-error")).toHaveTextContent("Enter the activation event");
    expect(activateClient).not.toHaveBeenCalled();

    fillRequiredFields();
    await waitFor(() => expect(activate).toBeEnabled());
    fireEvent.click(activate);

    await waitFor(() => expect(activateClient).toHaveBeenCalledTimes(1));
    expect(activateClient.mock.calls[0][0]).toMatchObject({
      client_id: CLIENT_ID,
      subject_display_name: "Rugesh Naidu",
      human_confirmed: true,
    });
    await waitFor(() => expect(onActivated).toHaveBeenCalled());
  });

  it("reconciles an interrupted response when the authoritative summary contains the committed case", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    activateClient.mockRejectedValue(new Error("Failed to fetch"));
    clientSummary.mockResolvedValue({
      has_open_case: true,
      case: { id: "case-committed", client_id: CLIENT_ID, case_reference: "AML-2026-00077" },
    });
    const { onActivated, onOpenChange } = setup({ clientId: CLIENT_ID });
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Activate client" }));

    await waitFor(() => expect(clientSummary).toHaveBeenCalledWith(CLIENT_ID));
    expect(onActivated).toHaveBeenCalledWith(expect.objectContaining({ id: "case-committed" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Activation failed")).not.toBeInTheDocument();
  });

  it("preserves the completed form and offers retry after a confirmed failure", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    activateClient.mockRejectedValue(new Error("Service temporarily unavailable"));
    const { onOpenChange } = setup({ clientId: CLIENT_ID });
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Activate client" }));

    expect(await screen.findByTestId("ac-submit-error")).toHaveTextContent("Service temporarily unavailable");
    expect(screen.getByLabelText("Activation event")).toHaveValue("Signed engagement letter");
    expect(screen.getByRole("checkbox", { name: "Confirm activation event" })).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Activate client" })).toBeEnabled();
  });

  it("blocks activation and explains when an open AML case already exists", async () => {
    getClientForActivation.mockResolvedValue({
      client: {
        ...inactiveClient,
        is_active: true,
        has_open_case: true,
        open_case: { id: "case-9", case_reference: "AML-2026-00009" },
      },
    });
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText(/An open AML\/CTF case already exists for this client\./)).toBeInTheDocument());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Activate client" }));
    expect(await screen.findByTestId("ac-submit-error")).toHaveTextContent("already has an open AML/CTF case");
  });

  it("shows a clear error and no activation form when the client cannot be loaded", async () => {
    getClientForActivation.mockRejectedValue(new Error("Client not found"));
    setup({ clientId: CLIENT_ID });

    await waitFor(() =>
      expect(screen.getByText("This client could not be loaded")).toBeInTheDocument());
    expect(screen.getByText(/Client not found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate client" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subject display name")).not.toBeInTheDocument();
  });
});

/**
 * The client picker.
 *
 * ── What was wrong ────────────────────────────────────────────────────
 * The picker returned nothing until an operator typed two characters, so
 * opening this dialog showed an empty box and every client the platform
 * already held was invisible until somebody guessed a name and spelled it.
 * On the deployment this was reported against that hid 775 clients — 40
 * active, 735 inactive — and it is why activation felt as though it wanted
 * clients re-entered that the business already had.
 *
 * These pin the browse-first behaviour and, just as importantly, the three
 * different "nothing here" answers: an empty register, an empty filter and
 * an unmatched search are not the same statement, and only one of them
 * means a client needs creating.
 */
describe("ActivateClientDialog — the client picker", () => {
  const alex = {
    id: "a", label: "Alex Naidu", email: "alex@example.test",
    mobile: null, is_active: true, has_open_case: false,
  };

  it("browses the register on open, before anything is typed", async () => {
    listClientsForActivation.mockResolvedValue(page([alex, { ...inactiveClient }], { total: 2 }));
    setup();

    // No typing: the clients are simply there.
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
    expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument();
    expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ query: "", status: "all", offset: 0 }),
    );
  });

  it("shows active and inactive together, and an inactive client is selectable", async () => {
    listClientsForActivation.mockResolvedValue(page([alex, { ...inactiveClient }], { total: 2 }));
    setup();
    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Select Rugesh Naidu/ }));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Rugesh Naidu"));
    expect(screen.getByText(/Inactive client — this client will be marked active/)).toBeInTheDocument();
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Rugesh Naidu");
  });

  it("narrows to a status slice without re-querying the whole register client-side", async () => {
    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Inactive" }));
    // The slice is a server filter, so the count it reports stays true.
    await waitFor(() => expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "inactive", offset: 0 })));
  });

  it("searches through the same op rather than filtering what it already has", async () => {
    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "naidu" } });
    await waitFor(() => expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ query: "naidu" })), { timeout: 2000 });
  });

  it("lists a client that already has an open case, names it, and refuses selection", async () => {
    // Hiding it gives the worst answer a picker can give — "that client does
    // not exist" — when the truth is they are already covered.
    listClientsForActivation.mockResolvedValue(page([{
      ...inactiveClient, has_open_case: true,
      open_case: { case_reference: "AML-2026-00004" },
    }], { total: 1 }));
    setup();

    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());
    expect(screen.getByText("AML-2026-00004")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /already has an open case/ });
    expect(row).toBeDisabled();

    fireEvent.click(row);
    expect(screen.queryByTestId("ac-selected-client")).not.toBeInTheDocument();
  });

  it("reports how many clients exist, not how many it drew", async () => {
    listClientsForActivation.mockResolvedValue(
      page([alex], { total: 775, has_more: true }));
    setup();
    await waitFor(() =>
      expect(screen.getByText("Showing 1 of 775 clients")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Load more/ })).toBeInTheDocument();
  });

  it("appends the next page instead of replacing the current one", async () => {
    listClientsForActivation
      .mockResolvedValueOnce(page([alex], { total: 2, has_more: true }))
      .mockResolvedValueOnce(page([{ ...inactiveClient }], { total: 2, has_more: false }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() => expect(screen.getByText("Rugesh Naidu")).toBeInTheDocument());
    // The first page is still on screen.
    expect(screen.getByText("Alex Naidu")).toBeInTheDocument();
  });

  it("says a search matched nothing without implying the register is empty", async () => {
    listClientsForActivation.mockResolvedValue(page([], { total: 0, browsing: false }));
    setup();
    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "zz" } });

    await waitFor(() =>
      expect(screen.getByText(/No client matches/)).toBeInTheDocument(), { timeout: 2000 });
    // ...and never tells the operator to go and activate them elsewhere.
    expect(screen.queryByText(/not marked active/)).not.toBeInTheDocument();
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();
  });

  it("distinguishes an empty register from an empty filter", async () => {
    listClientsForActivation.mockResolvedValue(page([], { total: 0, browsing: true }));
    const { unmount } = setup();
    // Nothing at all: this is the only case that points at creating a client.
    await waitFor(() => expect(screen.getByText("No clients yet")).toBeInTheDocument());
    // The one empty state that offers creation, and it says the register is
    // shared rather than sending the operator to another screen.
    expect(screen.getByText(/same register either way/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a new client/ })).toBeInTheDocument();
    unmount();

    setup();
    await waitFor(() => expect(screen.getByText("No clients yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    await waitFor(() => expect(screen.getByText("No active clients")).toBeInTheDocument());
    // ...and an empty SLICE does not offer creation: the client is probably
    // sitting in the tab next door.
    expect(screen.queryByRole("button", { name: /Create a new client/ })).not.toBeInTheDocument();
  });

  it("never reports an empty register when the server predates browsing", async () => {
    /*
     * This happened in production. The frontend for browsing shipped and the
     * `aml-cases` deploy was CANCELLED by a burst of merges, so the old
     * function answered `{ clients: [] }` to the empty browse query and the
     * picker said "No clients yet" over a register of 775 clients — the exact
     * lie that sends an operator off to create a duplicate.
     *
     * The SHAPE of the response decides, not the row count: no `total` and no
     * `browsing` means an old server, never an empty register.
     */
    listClientsForActivation.mockResolvedValue({ clients: [] });
    setup();

    await waitFor(() =>
      expect(screen.getByText("Type a name to find a client")).toBeInTheDocument());
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();
    expect(screen.getByText(/Browsing the full register needs the updated server/))
      .toBeInTheDocument();
  });

  it("still searches successfully against a server that predates browsing", async () => {
    // Degraded, not broken: search reaches every client on the old function.
    listClientsForActivation.mockResolvedValue({
      clients: [{
        id: "a", label: "Alex Naidu", email: null, mobile: null,
        is_active: true, has_open_case: false,
      }],
    });
    setup();
    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "naidu" } });

    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument(), { timeout: 2000 });
  });

  it("never renders a failed lookup as an empty register", async () => {
    // "No clients" on a broken read is what sends an operator off to create
    // a duplicate of a client that already exists.
    listClientsForActivation.mockRejectedValue(new Error("network"));
    setup();

    await waitFor(() =>
      expect(screen.getByText("The client register could not be reached")).toBeInTheDocument());
    expect(screen.queryByText("No clients yet")).not.toBeInTheDocument();

    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
  });
});

describe("ActivateClientDialog — responsive layout", () => {
  it("uses a bounded, non-overflowing shell with an independently scrollable body and persistent footer", async () => {
    getClientForActivation.mockResolvedValue({ client: inactiveClient });
    setup({ clientId: CLIENT_ID });
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());

    const shell = screen.getByTestId("activate-client-dialog");
    const cls = shell.className;
    // Viewport-bounded width and height on desktop; flex column shell.
    expect(cls).toContain("sm:max-w-[780px]");
    expect(cls).toMatch(/max-h-\[/);
    expect(cls).toContain("flex-col");
    expect(cls).toContain("overflow-hidden");

    // Body scrolls on its own and clips horizontal overflow.
    const body = shell.querySelector(".overflow-y-auto.overflow-x-hidden, .overflow-y-auto");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("overflow-x-hidden");

    // Footer with Cancel + Activate stays outside the scroll container.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const activate = screen.getByRole("button", { name: "Activate client" });
    expect(body?.contains(cancel)).toBe(false);
    expect(body?.contains(activate)).toBe(false);
  });
});


/**
 * Creating a brand-new client without leaving the dialog.
 *
 * ── The rule this must not break ──────────────────────────────────────
 * A case may only be opened after a HUMAN-CONFIRMED activation event
 * (AGENTS.md §2). "Create and activate in one click" would mean the frontend
 * manufacturing a compliance outcome, so creating a client selects them and
 * hands them to the same activation form — which is what removes the round
 * trip — while the event, the reason and the confirmation stay a person's act.
 */
describe("ActivateClientDialog — create a new client", () => {
  const openCreate = async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: /New client/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /New client/ }));
    await waitFor(() => expect(screen.getByTestId("ac-create-client")).toBeInTheDocument());
  };

  const fillNewClient = (first = "Priya", surname = "Raman") => {
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: first } });
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: surname } });
  };

  it("reaches the create form from the register without leaving the dialog", async () => {
    await openCreate();
    // Still the same dialog, still on step 1.
    expect(screen.getByTestId("activate-client-dialog")).toBeInTheDocument();
    expect(screen.getByText("1 · Selected client")).toBeInTheDocument();
  });

  it("requires both names, because both columns are NOT NULL", async () => {
    await openCreate();
    const submit = screen.getByTestId("ac-create-client-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Priya" } });
    // A first name alone is not enough — writing null into primary_surname is
    // a Postgres 23502 surfaced as an opaque 500.
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Raman" } });
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("rejects a malformed email before it reaches the server", async () => {
    await openCreate();
    fillNewClient();
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "not-an-email" } });
    await waitFor(() =>
      expect(screen.getByTestId("ac-create-client-submit")).toBeDisabled());
    expect(createClientRecord).not.toHaveBeenCalled();
  });

  it("creates through the central register and selects the new client", async () => {
    createClientRecord.mockResolvedValue({
      id: "new-1", primary_first_name: "Priya", primary_surname: "Raman",
      primary_email: null, primary_mobile: null,
    });
    await openCreate();
    fillNewClient();
    fireEvent.click(screen.getByTestId("ac-create-client-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Priya Raman"));
    expect(createClientRecord).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Priya", surname: "Raman" }));
    // The subject name is carried across so nothing is retyped.
    expect(screen.getByLabelText("Subject display name")).toHaveValue("Priya Raman");
  });

  it("does NOT open a case on creation — the activation event is still a person's act", async () => {
    createClientRecord.mockResolvedValue({
      id: "new-1", primary_first_name: "Priya", primary_surname: "Raman",
      primary_email: null, primary_mobile: null,
    });
    await openCreate();
    fillNewClient();
    fireEvent.click(screen.getByTestId("ac-create-client-submit"));
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());

    // Creating a client is not activating one.
    expect(activateClient).not.toHaveBeenCalled();
    const activate = screen.getByRole("button", { name: "Activate client" });
    expect(activate).toBeEnabled();
    fireEvent.click(activate);
    expect(await screen.findByTestId("ac-submit-error")).toHaveTextContent("Enter the activation event");
    expect(activateClient).not.toHaveBeenCalled();
  });

  it("activates the newly created client once the event is confirmed", async () => {
    createClientRecord.mockResolvedValue({
      id: "new-1", primary_first_name: "Priya", primary_surname: "Raman",
      primary_email: null, primary_mobile: null,
    });
    activateClient.mockResolvedValue({
      case: { id: "c1", client_id: "new-1", case_reference: "AML-2026-00005" },
    });
    await openCreate();
    fillNewClient();
    fireEvent.click(screen.getByTestId("ac-create-client-submit"));
    await waitFor(() => expect(screen.getByTestId("ac-selected-client")).toBeInTheDocument());

    fillRequiredFields();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate client" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Activate client" }));

    await waitFor(() => expect(activateClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "new-1", human_confirmed: true })));
  });

  it("warns about an existing client before a duplicate is created", async () => {
    // Detection happens BEFORE the insert — the point is to stop the
    // duplicate existing, not to report it afterwards.
    listClientsForActivation.mockResolvedValue(page([{
      id: "dup-1", label: "Priya Raman", email: "priya@example.test",
      mobile: null, is_active: true, has_open_case: false,
    }], { total: 1 }));
    await openCreate();
    fillNewClient();

    await waitFor(() =>
      expect(screen.getByText("A similar client already exists")).toBeInTheDocument(),
      { timeout: 2000 });

    // ...and the existing record can be adopted instead of duplicated.
    fireEvent.click(screen.getByRole("button", { name: /Priya Raman/ }));
    await waitFor(() =>
      expect(screen.getByTestId("ac-selected-client")).toHaveTextContent("Priya Raman"));
    expect(createClientRecord).not.toHaveBeenCalled();
  });

  it("checks for duplicates by email as well as by name", async () => {
    // A name check cannot match "Rob Smith" to an existing "Robert Smith";
    // the shared email address will.
    listClientsForActivation.mockResolvedValue(page([]));
    await openCreate();
    fillNewClient("Rob", "Smith");
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "robert@example.test" } });

    await waitFor(() => expect(listClientsForActivation).toHaveBeenCalledWith(
      expect.objectContaining({ query: "robert@example.test" })), { timeout: 2000 });
  });

  it("keeps a creation failure on the form instead of losing what was typed", async () => {
    createClientRecord.mockRejectedValue(new Error("Insufficient permissions"));
    await openCreate();
    fillNewClient();
    fireEvent.click(screen.getByTestId("ac-create-client-submit"));

    await waitFor(() =>
      expect(screen.getByText("The client was not created")).toBeInTheDocument());
    expect(screen.getByText("Insufficient permissions")).toBeInTheDocument();
    // The typed values survive so the operator can fix and retry.
    expect(screen.getByLabelText("First name")).toHaveValue("Priya");
    expect(screen.queryByTestId("ac-selected-client")).not.toBeInTheDocument();
  });

  it("returns to the register without creating anything", async () => {
    await openCreate();
    fireEvent.click(screen.getByRole("button", { name: /Back to register/ }));
    await waitFor(() =>
      expect(screen.queryByTestId("ac-create-client")).not.toBeInTheDocument());
    expect(createClientRecord).not.toHaveBeenCalled();
  });
});


/**
 * Why the button would not work, said on screen.
 *
 * The Activate button was styled as the primary action and simply disabled
 * — no reason, pointing at nothing. Somebody who had just created a client
 * pressed it, nothing happened, and concluded "I cannot create a client and
 * it shows inactive". The register gained FOUR identical Rugesh Naidu
 * records in 45 minutes from exactly that loop.
 *
 * The requirements are unchanged (AGENTS.md §2 still governs). They are said.
 */
describe("ActivateClientDialog — the button explains itself", () => {
  const alex = {
    id: "a", label: "Alex Naidu", email: "alex@example.test",
    mobile: null, is_active: false, has_open_case: false,
  };

  it("names every outstanding step before a client is chosen", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/Select or create a client/)).toBeInTheDocument());
  });

  it("counts down as the form is completed, then says it is ready", async () => {
    listClientsForActivation.mockResolvedValue(page([alex], { total: 1 }));
    setup();
    await waitFor(() => expect(screen.getByText("Alex Naidu")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Select Alex Naidu/ }));

    // The client is chosen; the activation event and reason are not.
    await waitFor(() =>
      expect(screen.getByText(/Name the activation event/)).toBeInTheDocument());
    expect(screen.getByText(/3 steps left/)).toBeInTheDocument();

    fillRequiredFields();
    await waitFor(() => expect(screen.getByText("Ready to activate")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Activate client" })).toBeEnabled();
  });

  it("ties the explanation to the button for a screen reader", async () => {
    setup();
    await waitFor(() => expect(screen.getByText(/Select or create a client/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Activate client" }))
      .toHaveAttribute("aria-describedby", "ac-outstanding");
  });

  it("says an open case is what is blocking, rather than staying silent", async () => {
    getClientForActivation.mockResolvedValue({
      client: { ...inactiveClient, has_open_case: true,
        open_case: { id: "x", case_reference: "AML-2026-00001" } },
    });
    setup({ clientId: CLIENT_ID });
    await waitFor(() =>
      expect(screen.getByText(/already has an open case/)).toBeInTheDocument());
  });
});

/**
 * Duplicate creation, actually prevented.
 *
 * The first version only warned. In 45 minutes of real use it was clicked
 * past four times and the register gained four identical
 * "Rugesh Naidu / naidu.rugesh@gmail.com" records. A warning that can be
 * dismissed is a note about duplicates, not a safeguard against them.
 */
describe("ActivateClientDialog — duplicate creation is blocked, not just flagged", () => {
  const openCreate = async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: /New client/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /New client/ }));
    await waitFor(() => expect(screen.getByTestId("ac-create-client")).toBeInTheDocument());
  };

  const existing = {
    id: "dup-1", label: "Rugesh Naidu", email: "naidu.rugesh@gmail.com",
    mobile: null, is_active: false, has_open_case: false,
  };

  it("refuses to create a second client on the same email", async () => {
    listClientsForActivation.mockResolvedValue(page([existing], { total: 1 }));
    await openCreate();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rugesh" } });
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Naidu" } });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "naidu.rugesh@gmail.com" },
    });

    await waitFor(() =>
      expect(screen.getByText("That email already belongs to a client")).toBeInTheDocument(),
      { timeout: 2000 });
    expect(screen.getByTestId("ac-create-client-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("ac-create-client-submit"));
    expect(createClientRecord).not.toHaveBeenCalled();
  });

  it("matches the email case-insensitively", async () => {
    listClientsForActivation.mockResolvedValue(page([existing], { total: 1 }));
    await openCreate();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rugesh" } });
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Naidu" } });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "  NAIDU.RUGESH@GMAIL.COM  " },
    });
    await waitFor(() =>
      expect(screen.getByTestId("ac-create-client-submit")).toBeDisabled(), { timeout: 2000 });
  });

  it("still allows a genuine namesake — a name is not an identifier", async () => {
    // Two different people are called Rugesh Naidu; two different people do
    // not share an inbox. Refusing on name would make namesakes uncreatable.
    listClientsForActivation.mockResolvedValue(page([existing], { total: 1 }));
    await openCreate();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rugesh" } });
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Naidu" } });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "different.person@example.test" },
    });

    await waitFor(() =>
      expect(screen.getByText(/similar client/i)).toBeInTheDocument(), { timeout: 2000 });
    // Warned, not blocked.
    await waitFor(() =>
      expect(screen.getByTestId("ac-create-client-submit")).toBeEnabled());
  });

  it("tells otherwise-identical duplicates apart", async () => {
    // Four rows read "Rugesh Naidu / naidu.rugesh@gmail.com" in production.
    // Identical rows are unchoosable.
    listClientsForActivation.mockResolvedValue(page([
      { ...existing, id: "10e2e305-cef6-42e3-9203-fb8b2d1dd14e" },
      { ...existing, id: "67a78519-aa48-46bb-a6db-7fe26b8d0eda" },
    ], { total: 2 }));
    await openCreate();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rugesh" } });
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Naidu" } });

    await waitFor(() => expect(screen.getByText("10e2e305")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText("67a78519")).toBeInTheDocument();
  });
});
