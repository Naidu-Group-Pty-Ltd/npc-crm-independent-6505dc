import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * The portal tiles on the Compliance Journey Map.
 *
 * Two reported defects, and they are the same kind of thing: the map showed
 * a door that does not exist, and refused to light the ones that do.
 *
 * **Builder and Developer are ONE portal.** They sign into the same
 * Builder/Developer portal. `partnerOnboarding.pure.ts` removed that split
 * from the onboarding wizard ("two doors into one room") and the map kept
 * it — so a "Developer portal" tile stood there permanently reading "Not
 * yet connected", because there is nothing for it to connect to.
 *
 * **A live Passport reads green.** It was drawn in progress-blue while the
 * Client portal went green for finishing its own part, so a case whose
 * Passport had actually reached three partners looked unfinished on the one
 * map that exists to show it had not been done three times.
 */

const listGrants = vi.fn();
const listAssessments = vi.fn();
const listAttestations = vi.fn();

vi.mock("@/lib/aml/amlRelianceApi", () => ({
  amlRelianceApi: {
    listGrants: (...a: unknown[]) => listGrants(...a),
    listAssessments: (...a: unknown[]) => listAssessments(...a),
    listAttestations: (...a: unknown[]) => listAttestations(...a),
  },
}));

import { ComplianceJourneyMap } from "../ComplianceJourneyMap";

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: "case-1",
  case_reference: "AML-2026-00005",
  status: "cleared",
  case_stage: "cleared",
  service_gate_status: "under_review",
  client_portal_status: "complete",
  finance_portal_status: "not_requested",
  ...over,
}) as never;

const grant = (orgType: string, over: Record<string, unknown> = {}) => ({
  id: `g-${orgType}-${Math.random()}`,
  agreement_id: `a-${orgType}`,
  revoked_at: null,
  reliance_agreements: { partner_org_type: orgType },
  ...over,
});

const mount = (row = caseRow()) => render(<ComplianceJourneyMap caseRow={row} />);

beforeEach(() => {
  vi.clearAllMocks();
  listGrants.mockResolvedValue({ grants: [] });
  listAssessments.mockResolvedValue({ assessments: [] });
  listAttestations.mockResolvedValue({ attestations: [] });
});

describe("Builder and Developer are one portal", () => {
  it("there is one tile, and it is named for the portal that exists", async () => {
    mount();
    expect(await screen.findByText("Builder / Developer portal")).toBeTruthy();
    expect(screen.queryByText("Developer portal")).toBeNull();
    expect(screen.queryByText("Builder portal")).toBeNull();
  });

  it("a BUILDER organisation lights it", async () => {
    listGrants.mockResolvedValue({ grants: [grant("builder")] });
    mount();
    const tile = (await screen.findByText("Builder / Developer portal")).parentElement!;
    await waitFor(() => expect(tile.textContent).toMatch(/Passport live/));
  });

  it("a DEVELOPER organisation lights the same tile, rather than vanishing", async () => {
    /* The AML server's vocabulary still records `developer` — it is written
       to three records — and before this that grant had nowhere on the map
       to appear, because the only tile that matched was a portal nobody can
       sign into. */
    listGrants.mockResolvedValue({ grants: [grant("developer")] });
    mount();
    const tile = (await screen.findByText("Builder / Developer portal")).parentElement!;
    await waitFor(() => expect(tile.textContent).toMatch(/Passport live/));
  });

  it("four tiles, not five", async () => {
    mount();
    await screen.findByText("Client portal");
    for (const label of [
      "Client portal", "Finance portal", "Builder / Developer portal",
      "Solicitors & conveyancers",
    ]) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });
});

describe("a portal that is live reads green", () => {
  const toneOf = (label: string) =>
    screen.getByText(label).parentElement!.className;

  it("a live Passport is `done`, like the Client portal's own completion", async () => {
    listGrants.mockResolvedValue({ grants: [grant("solicitor_conveyancer")] });
    mount();
    await screen.findByText("Solicitors & conveyancers");
    await waitFor(() =>
      expect(toneOf("Solicitors & conveyancers")).toContain("border-success"));
    expect(toneOf("Client portal")).toContain("border-success");
  });

  it("Finance goes green on a live Passport too", async () => {
    listGrants.mockResolvedValue({ grants: [grant("finance")] });
    mount();
    await screen.findByText("Finance portal");
    await waitFor(() => expect(toneOf("Finance portal")).toContain("border-success"));
    expect(screen.getByText("Passport live")).toBeTruthy();
  });

  it("but Finance keeps its own middle state, which the partner tiles have no equivalent of", async () => {
    mount(caseRow({ finance_portal_status: "requested" }));
    await screen.findByText("Finance portal");
    await waitFor(() => expect(toneOf("Finance portal")).toContain("border-primary"));
  });

  it("a WITHDRAWN grant is not live — revoking must take the colour back", async () => {
    listGrants.mockResolvedValue({
      grants: [grant("builder", { revoked_at: "2026-08-28T00:00:00Z" })],
    });
    mount();
    await screen.findByText("Builder / Developer portal");
    await waitFor(() =>
      expect(screen.getByText("Builder / Developer portal").parentElement!.textContent)
        .toMatch(/Not yet connected/));
  });

  it("the status stays a fact about ACCESS, never a claim about the partner", async () => {
    /* A satisfied assessment means the partner recorded ITSELF satisfied
       with what we shared. Green says this portal holds the record; it does
       not say the partner is compliant, and the wording must not either. */
    listGrants.mockResolvedValue({ grants: [grant("builder")] });
    listAssessments.mockResolvedValue({
      assessments: [{ status: "satisfied", agreement_id: "a-builder" }],
    });
    mount();
    const tile = (await screen.findByText("Builder / Developer portal")).parentElement!;
    await waitFor(() => expect(tile.textContent).toMatch(/partner assessed/));
    expect(tile.textContent).toMatch(/Passport live/);
    expect(tile.textContent).not.toMatch(/compliant/i);
  });
});
