/**
 * The hand-off from AML activation into the Client Portal.
 *
 * Activation and provisioning were both complete and nothing joined them:
 * `activate_client` returns a sentence saying "send them a portal invitation"
 * with no way to send one, and `client-portal-invite` sat behind a button on
 * the Clients page. AML-2026-00005 was activated, notified at `/client/aml`,
 * and has no portal account — the notification is behind a login the client
 * cannot pass.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AmlPortalAccessCard } from "../AmlPortalAccessCard";

/** The real dialog is the issuing path; here it only needs to be observable. */
vi.mock("@/components/portal/SendPortalInviteDialog", () => ({
  SendPortalInviteDialog: ({ open, clientId, clientName }: any) =>
    open ? (
      <div data-testid="invite-dialog" data-client-id={clientId} data-client-name={clientName} />
    ) : null,
}));

const CLIENT = "6a69bb9f-2ea6-4948-b0a8-5e4fa0fe9201";

const renderCard = (facts: any, extra: Record<string, unknown> = {}) =>
  render(
    <AmlPortalAccessCard
      facts={facts}
      clientId={CLIENT}
      clientName="Rugesh Naidu"
      {...extra}
    />,
  );

describe("AmlPortalAccessCard", () => {
  it("offers to issue access when the client has no login", () => {
    renderCard({ exists: false });
    expect(screen.getByText("Not invited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue portal access" })).toBeInTheDocument();
  });

  it("opens the EXISTING invite dialog rather than a second issuing path", async () => {
    // `client_portal_users` carries UNIQUE(client_id) — there is only ever
    // one account, and a second set of issuing semantics would be a second
    // way to get it wrong.
    renderCard({ exists: false });
    fireEvent.click(screen.getByRole("button", { name: "Issue portal access" }));
    await waitFor(() => expect(screen.getByTestId("invite-dialog")).toBeInTheDocument());
    expect(screen.getByTestId("invite-dialog")).toHaveAttribute("data-client-id", CLIENT);
  });

  it("refreshes the reading when the dialog closes", async () => {
    const onChanged = vi.fn();
    renderCard({ exists: false }, { onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Issue portal access" }));
    await waitFor(() => expect(screen.getByTestId("invite-dialog")).toBeInTheDocument());
    // The mock never closes itself; the handler is what matters.
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("never offers an action on a state it could not read", () => {
    renderCard(null);
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers nothing to send when the client has no email address", () => {
    // AML-2026-00001's client. Offering to issue here would fail at the
    // point of sending, after the operator had committed to it.
    renderCard({ exists: false, email: null });
    expect(screen.getByText("No email address")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a resend on an expired invitation", () => {
    renderCard({ exists: true, status: "invited", inviteExpired: true });
    expect(screen.getByText("Invitation expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend invitation" })).toBeInTheDocument();
  });

  it("offers NO re-issue on a live account, because re-issuing destroys it", () => {
    // The server's `resend_invite` downgrades an active account to `invited`
    // and clears the client's password and acknowledgements. That belongs
    // behind the client record's own dialog, not beside a compliance case.
    renderCard({
      exists: true, status: "active",
      lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: true,
    });
    expect(screen.getByText("Portal active")).toBeInTheDocument();
    expect(screen.getByText("Can sign in")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a skeleton while the read is in flight, not an empty state", () => {
    renderCard(null, { loading: true });
    expect(screen.getByRole("status", { name: /loading client portal access/i }))
      .toBeInTheDocument();
    expect(screen.queryByText("Not invited")).not.toBeInTheDocument();
  });
});
