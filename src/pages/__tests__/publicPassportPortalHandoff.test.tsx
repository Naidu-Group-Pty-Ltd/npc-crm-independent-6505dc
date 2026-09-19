import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "View in your portal", RENDERED on the emailed Passport link.
 *
 * ── What was reported ─────────────────────────────────────────────────
 * The AML/CTF Compliance page could not be found anywhere in the Builder
 * Portal, and the emailed link offered no route to it. A source test can see
 * that a button exists; only a render can see that it appears exactly when
 * the server says the door will open, and never otherwise.
 */

const redeem = vi.fn();
const requestNewLink = vi.fn();
const recordIndependentAssessment = vi.fn();

vi.mock("@/lib/aml/partnerAcknowledgementPublic", () => ({
  passportPublicApi: {
    redeem: (...a: unknown[]) => redeem(...a),
    requestNewLink: (...a: unknown[]) => requestNewLink(...a),
    recordIndependentAssessment: (...a: unknown[]) => recordIndependentAssessment(...a),
  },
}));

vi.mock("@/components/branding/BrandAssets", () => ({
  BrandLockup: () => null,
  BrandLogo: () => null,
}));

import PublicPassport from "../PublicPassport";

const TOKEN = "d258ccb98160488cb3db83be33a2126b51bbbe336ee9476887f82175e0a5dcdc";

const redemption = (over: Record<string, unknown> = {}) => ({
  attestation: { customer_identification: {} },
  attestation_sha256: "abcdef1234567890",
  issued_at: "2026-08-27T00:00:00.000Z",
  attestation_version: 1,
  agreement: {
    partner_org_name: "Rugesh Builder Pty Ltd",
    agreement_reference: "Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement",
    scope: ["customer_identification"],
  },
  notice: "You may rely on the customer identification procedures described here.",
  ...over,
});

const mount = () =>
  render(
    <MemoryRouter initialEntries={[`/passport/${TOKEN}`]}>
      <Routes>
        <Route path="/passport/:token" element={<PublicPassport />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a partner who also holds a portal account is shown the way there", () => {
  it("offers the portal, names it, and links to the matter", async () => {
    redeem.mockResolvedValue(redemption({
      portal_handoff: {
        available: true,
        portalType: "builder",
        label: "Builder / Developer Portal",
        path: "/builder/compliance?matter=link-0001",
        url: "https://command-centre.npcservices.com.au/builder/compliance?matter=link-0001",
        reason: null,
      },
    }));
    mount();

    const link = await screen.findByRole("link", { name: /View in your portal/i });
    expect(link).toHaveAttribute(
      "href",
      "https://command-centre.npcservices.com.au/builder/compliance?matter=link-0001",
    );
    expect(screen.getByText(/Builder \/ Developer Portal account/i)).toBeInTheDocument();
    /* It names the page in the same words the portal's own nav uses, so a
       partner following the instruction finds what they were told to find.
       Scoped to the handoff card — the booklet names the instrument too. */
    expect(link.closest("div")?.parentElement?.textContent ?? "")
      .toMatch(/AML\/CTF Compliance/);
  });

  it("the destination carries the matter and never the token", async () => {
    redeem.mockResolvedValue(redemption({
      portal_handoff: {
        available: true, portalType: "builder", label: "Builder / Developer Portal",
        path: "/builder/compliance?matter=link-0001",
        url: "https://x.example/builder/compliance?matter=link-0001",
        reason: null,
      },
    }));
    mount();
    const link = await screen.findByRole("link", { name: /View in your portal/i });
    /* A bearer token in a browser address bar survives in history, referrers
       and screenshots. The portal session is what decides access there. */
    expect(link.getAttribute("href")).not.toContain(TOKEN);
  });
});

describe("a door that would refuse is never offered", () => {
  it("says nothing when the partner is not enrolled", async () => {
    redeem.mockResolvedValue(redemption({
      portal_handoff: {
        available: false, portalType: "builder", label: "Builder / Developer Portal",
        path: null, url: null, reason: "not_enrolled",
      },
    }));
    mount();
    await screen.findByText(/Compliance Passport for Rugesh Builder Pty Ltd/i);
    expect(screen.queryByRole("link", { name: /View in your portal/i })).toBeNull();
    /* And it does not explain our configuration to somebody outside our
       organisation — "your organisation has no enrolled portal account" is
       our business, not theirs. */
    expect(screen.queryByText(/enrolled/i)).toBeNull();
  });

  it("says nothing when the surface is switched off on this deployment", async () => {
    redeem.mockResolvedValue(redemption({
      portal_handoff: {
        available: false, portalType: "builder", label: "Builder / Developer Portal",
        path: null, url: null, reason: "surface_disabled",
      },
    }));
    mount();
    await screen.findByText(/Compliance Passport for Rugesh Builder Pty Ltd/i);
    expect(screen.queryByRole("link", { name: /View in your portal/i })).toBeNull();
  });

  it("says nothing for a partner outside every portal — the link IS their route", async () => {
    redeem.mockResolvedValue(redemption({
      portal_handoff: {
        available: false, portalType: null, label: null,
        path: null, url: null, reason: "no_portal",
      },
    }));
    mount();
    await screen.findByText(/Compliance Passport for Rugesh Builder Pty Ltd/i);
    expect(screen.queryByRole("link", { name: /View in your portal/i })).toBeNull();
  });

  it("an older server that sends no handoff at all renders exactly as before", async () => {
    redeem.mockResolvedValue(redemption());
    mount();
    await screen.findByText(/Compliance Passport for Rugesh Builder Pty Ltd/i);
    expect(screen.queryByRole("link", { name: /View in your portal/i })).toBeNull();
    // The document is still there — the handoff is additive, never a gate.
    await waitFor(() => {
      expect(screen.getAllByText(/AML\/CTF Compliance Passport/i).length).toBeGreaterThan(0);
    });
  });
});
