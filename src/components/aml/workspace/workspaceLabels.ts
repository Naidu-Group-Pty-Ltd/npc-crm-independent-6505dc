/**
 * Human labels for the workspace sections.
 *
 * Kept apart from the components so the nav, the action rail and the tests
 * share one vocabulary — and so no surface has to print a raw section key.
 */
import type { AmlWorkspaceSection } from "@/lib/aml/workspaceViewModel";

export const SECTION_LABELS: Record<AmlWorkspaceSection, string> = {
  overview: "Overview",
  identity: "Identity & screening",
  ownership: "Ownership & control",
  counterparty: "Purchase & counterparty",
  finance: "Funding & finance",
  documents: "Documents & evidence",
  "submission-review": "Submission review",
  risk: "Risk & decision",
  requests: "Requests",
  passport: "Compliance Passport",
  monitoring: "Monitoring & reviews",
  timeline: "Timeline & audit",
};
