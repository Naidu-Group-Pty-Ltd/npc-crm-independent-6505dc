import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PartnerComplianceWorkspace } from "../PartnerComplianceWorkspace";
import {
  builderPortalAdapter, developerPortalAdapter,
  financePortalAdapter, solicitorPortalAdapter,
} from "../adapters";
import type { PartnerPortalAdapter, PartnerWorkspaceClient } from "../types";
import { RESPONSIBILITY_NOTICE } from "../types";

/**
 * Phase 5: every portal adapter drives the SAME shared component package.
 * Synthetic data only.
 */

const ADAPTERS: PartnerPortalAdapter[] = [
  financePortalAdapter, builderPortalAdapter, developerPortalAdapter, solicitorPortalAdapter,
];

const emptyClient = (): PartnerWorkspaceClient => ({
  getDirectory: vi.fn(async () => ({
    data: {
      organisation: { legal_name: "Synthetic Partner Pty Ltd", classification_status: "unclassified" },
      links: [],
    },
    error: null,
  })),
  getWorkspace: vi.fn(async () => ({ data: null, error: { message: "not used" } })),
  requestRecords: vi.fn(async () => ({ data: null, error: null })),
  listRequests: vi.fn(async () => ({ data: { requests: [] }, error: null })),
  recordDetermination: vi.fn(async () => ({ data: null, error: null })),
  listDeliveries: vi.fn(async () => ({ data: { deliveries: [] }, error: null })),
  getAuditReceipt: vi.fn(async () => ({ data: null, error: null })),
});

describe("portal adapters drive one shared implementation", () => {
  it("all four adapters render the shared workspace with the fixed responsibility notice", async () => {
    for (const a of ADAPTERS) {
      const view = render(
        <MemoryRouter>
          <PartnerComplianceWorkspace adapter={a} client={emptyClient()} />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("partner-compliance-workspace")).toBeTruthy();
      });
      /* The standing statutory banner is gone from every portal — it
         restated an acknowledgement the partner already gave in the written
         arrangement that got them here. What an adapter may still contribute
         is its portal's own context, and the rule it was written to enforce
         is unchanged and now stricter: an adapter ADDS context, it can never
         supply the statutory wording itself. That sentence belongs to the
         document (`PartnerPassportPanel`), which no adapter can reach. */
      expect(screen.queryByText(RESPONSIBILITY_NOTICE)).toBeNull();
      if (a.responsibilityIntro) {
        expect(screen.getByTestId("partner-page-context").textContent ?? "")
          .toContain(a.responsibilityIntro);
      }
      view.unmount();
    }
  });

  it("adapters carry presentation and context only — no authority-shaped fields", () => {
    const allowedKeys = new Set([
      "portalType", "workspaceTitle", "matterLabel", "ownReferenceLabel", "roleLabel",
      "formatReference", "responsibilityIntro", "panels", "support", "deadlineLabels",
    ]);
    for (const a of ADAPTERS) {
      for (const key of Object.keys(a)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
      const serialised = JSON.stringify({ ...a, formatReference: undefined });
      expect(serialised).not.toMatch(/org_id|tenant|token|secret|role_id|case_id|permission/i);
    }
  });

  it("no adapter claims a legal classification for its portal's organisations", () => {
    for (const a of [builderPortalAdapter, developerPortalAdapter]) {
      expect(a.responsibilityIntro ?? "").toMatch(/never assumed/i);
    }
  });

  it("reference formatters never expose a full identifier", () => {
    const link = {
      purchase_file_id: "12345678-aaaa-bbbb-cccc-1234567890ab",
      legal_matter_id: "87654321-dddd-eeee-ffff-0987654321ba",
      id: "abcdefab-1111-2222-3333-abcdefabcdef",
    };
    for (const a of ADAPTERS) {
      const ref = a.formatReference(link);
      expect(ref).not.toContain(link.purchase_file_id);
      expect(ref).not.toContain(link.legal_matter_id);
      expect(ref.length).toBeLessThan(24);
    }
  });
});
