import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidenceDeliveriesPanel } from "../EvidenceDeliveriesPanel";
import type { PartnerWorkspaceClient } from "../types";

/**
 * Stage B/C: behavioural tests for the shared delivered-records panel.
 * Synthetic data only.
 */

const baseWorkspace = (deliveries: unknown[]) => ({
  link: { id: "link-1" },
  deliveries,
} as never);

const delivered = (over: Record<string, unknown> = {}) => ({
  id: "d-1", record_code: "authority_evidence", safe_label: "Authority to act evidence",
  delivered_at: "2026-08-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z",
  revoked_at: null, available: true, ...over,
});

const clientWith = (getEvidenceAccess?: PartnerWorkspaceClient["getEvidenceAccess"]) =>
  ({ getEvidenceAccess } as unknown as PartnerWorkspaceClient);

describe("EvidenceDeliveriesPanel", () => {
  it("renders nothing when there are no deliveries", () => {
    const view = render(
      <EvidenceDeliveriesPanel workspace={baseWorkspace([])} client={clientWith()} />);
    expect(view.container.textContent).toBe("");
  });

  it("a revoked delivery shows its state in text and NO access control", () => {
    render(
      <EvidenceDeliveriesPanel
        workspace={baseWorkspace([delivered({ revoked_at: "2026-08-02T00:00:00Z", available: false })])}
        client={clientWith(vi.fn())} />);
    expect(screen.getByText("revoked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request temporary access/i })).toBeNull();
    expect(screen.getByText(/withdrawn by the issuing organisation/i)).toBeTruthy();
  });

  it("an expired delivery shows its state in text and NO access control", () => {
    render(
      <EvidenceDeliveriesPanel
        workspace={baseWorkspace([delivered({ available: false })])}
        client={clientWith(vi.fn())} />);
    expect(screen.getByText("expired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request temporary access/i })).toBeNull();
  });

  it("a transport without getEvidenceAccess renders metadata only — fails closed", () => {
    render(
      <EvidenceDeliveriesPanel workspace={baseWorkspace([delivered()])} client={clientWith(undefined)} />);
    expect(screen.getByText("available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request temporary access/i })).toBeNull();
  });

  it("access requires a recorded reason and renders the link once with its expiry announced", async () => {
    const getEvidenceAccess = vi.fn(async () => ({
      data: {
        access: {
          url: "https://synthetic.example/signed-once", filename: "authority.pdf",
          mime_type: "application/pdf", expires_at: new Date(Date.now() + 300_000).toISOString(),
          record_code: "authority_evidence", safe_label: "Authority to act evidence",
        },
      },
      error: null,
    }));
    render(
      <EvidenceDeliveriesPanel workspace={baseWorkspace([delivered()])}
        client={clientWith(getEvidenceAccess as never)} />);

    fireEvent.click(screen.getByRole("button", { name: /request temporary access/i }));
    const submit = screen.getByRole("button", { name: /^request access$/i });
    // Too-short reason: the submit stays disabled and nothing is called.
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/why do you need this document/i), {
      target: { value: "Verifying authority for settlement file review" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /open authority\.pdf/i })).toBeTruthy();
    });
    expect(getEvidenceAccess).toHaveBeenCalledWith({
      linkId: "link-1", deliveryId: "d-1",
      retrievalReason: "Verifying authority for settlement file review",
    });
    const link = screen.getByRole("link", { name: /open authority\.pdf/i }) as HTMLAnchorElement;
    expect(link.rel).toContain("noopener");
    expect(screen.getByText(/access expires at/i)).toBeTruthy();
    // Nothing auto-opened; the URL appears only as this link.
  });

  it("a server denial surfaces as a safe alert, not a broken control", async () => {
    const getEvidenceAccess = vi.fn(async () => ({
      data: null, error: { message: "Access to this record has been withdrawn.", code: "delivery_revoked" },
    }));
    render(
      <EvidenceDeliveriesPanel workspace={baseWorkspace([delivered()])}
        client={clientWith(getEvidenceAccess as never)} />);
    fireEvent.click(screen.getByRole("button", { name: /request temporary access/i }));
    fireEvent.change(screen.getByLabelText(/why do you need this document/i), {
      target: { value: "Reason long enough for the gate" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^request access$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("withdrawn");
    });
    expect(screen.queryByRole("link")).toBeNull();
  });
});
