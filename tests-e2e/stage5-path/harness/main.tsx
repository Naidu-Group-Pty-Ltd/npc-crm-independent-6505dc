/**
 * Mounts the REAL `ScreeningPathCard` so Playwright can measure and see it.
 *
 * The complaint this answers was visual — "the stage is fragmented, there is
 * no clear path" — and jsdom has no layout, so a DOM test can pass on a
 * screen that still reads as a wall. The component is built and rendered in
 * Chromium here, and the assertions are on bounding boxes.
 *
 * `?case=` picks the fixture. `production` is `AML-2026-00005` exactly as the
 * server reports it: reopened, enquiry-only, one party, PEP outstanding.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreeningPathCard } from "@/components/aml/ScreeningPathCard";
import { deriveScreeningPath } from "@/lib/aml/screeningSteps.pure";
import type { AmlScreeningStageSync } from "@/lib/aml/amlCasesApi";
import type { AmlCaseScreeningPosition } from "@/lib/aml/screeningScope";
import "@/index.css";

const scope = (key: string, required: boolean, reason: string, reasonCode = "") => ({
  scope: key, required, optional: !required,
  state: required ? "required" : "not_required", reason_code: reasonCode, reason,
} as never);

const PRODUCTION = {
  enrolled: 1,
  subjects: [],
  policy: {
    summary: "Reduced scope: sanctions and PEP only. Adverse media and internal "
      + "watchlist research are not proportionate for this profile.",
    policyVersion: "2026.08-1", notRequired: [], evidence: {},
  },
  scopes: [
    scope("sanctions", false,
      "This record exists for an enquiry or quotation only. The customer relationship "
      + "was never entered into.", "perimeter:enquiry_only"),
    scope("pep", true,
      "A politically-exposed-person determination must be established for every "
      + "customer.", "pep_determination_required"),
    scope("adverse_media", false, "Not triggered for this profile.", "risk_not_triggered"),
    scope("watchlist", false, "Not triggered for this profile.", "risk_not_triggered"),
  ],
  perimeter: {
    classification: "outside_perimeter", classified: true, reason_code: "enquiry_only",
    scopes_excluded: ["sanctions"], recorded_by_label: "Rugesh Naidu",
    recorded_at: "2026-08-19T12:19:45.727Z",
  },
  policy_version: "2026.08-1",
  provider_ready: false,
  provider_relevant: false,
  next_action: {
    key: "record_pep",
    label: "Record PEP determination",
    headline: "PEP determinations outstanding",
    detail: "The client's declaration supports the low-risk determination route, so the "
      + "sources and rationale are prefilled. A determination is still recorded against "
      + "each party — the declaration is evidence, not the determination.",
    owner: "reviewer",
  },
  decision_recorded: false,
  scope_changed: [],
  case_closed: false,
} as unknown as AmlScreeningStageSync;

/** A case inside the perimeter, mid-screening, with a candidate to adjudicate. */
const ADJUDICATE = {
  ...PRODUCTION,
  scopes: [
    scope("sanctions", true,
      "Targeted financial sanctions screening is required for every designated service.",
      "tfs_obligation"),
    scope("pep", true, "A determination is owed for every party in scope.",
      "pep_determination_required"),
  ],
  perimeter: {
    classification: "designated_service", classified: true, reason_code: null,
    scopes_excluded: [], recorded_by_label: "Mithruban",
    recorded_at: "2026-08-18T15:12:58.302Z",
  },
  provider_ready: true,
  provider_relevant: true,
  next_action: {
    key: "adjudicate_match",
    label: "Adjudicate the candidate",
    headline: "A candidate needs a decision",
    detail: "Inspect the listing and confirm or dismiss it. The party's state is a "
      + "projection of that resolution.",
    owner: "reviewer",
  },
} as unknown as AmlScreeningStageSync;

const POSITION = {
  subjects: [{
    id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: false,
    state: "not_required",
    sanctions: { state: "not_required", resolved: false, detail: "not required" },
    pep: { resolved: false, detail: "outstanding" },
    outstanding: ["pep"],
  }],
  facts: {},
  read: true,
} as unknown as AmlCaseScreeningPosition;

const POSITION_MATCH = {
  ...POSITION,
  subjects: [{
    id: "s1", name: "Rugesh Naidu", partyType: "primary_subject", required: true,
    state: "possible_match",
    sanctions: { state: "possible_match", resolved: false, detail: "1 candidate" },
    pep: { resolved: true, detail: "not a PEP" },
    outstanding: ["sanctions"],
  }],
} as unknown as AmlCaseScreeningPosition;

const which = new URLSearchParams(location.search).get("case") ?? "production";
const sync = which === "adjudicate" ? ADJUDICATE : PRODUCTION;
const position = which === "adjudicate" ? POSITION_MATCH : POSITION;

function Harness() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl">
        <ScreeningPathCard
          path={deriveScreeningPath({ sync, position })}
          caseClosed={false}
          closedAction={null}
          actor={{ canWrite: true, isReviewer: true, isMlro: true }}
          onAct={() => {}}
          onReviewPerimeter={() => {}}
          onOpenDetail={() => {}}
          onContinue={() => {}}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Harness /></StrictMode>,
);
