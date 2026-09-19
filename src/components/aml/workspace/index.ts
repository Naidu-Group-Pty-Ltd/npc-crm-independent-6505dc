/**
 * AML case workspace presentation components.
 *
 * Every component here is presentational: it fetches nothing, decides
 * nothing, and persists nothing. The readings they render come from the
 * pure helpers in `src/lib/aml/workspaceViewModel.ts`; the data those
 * helpers read comes from `useAmlCaseSummary`, which calls only existing
 * read operations.
 */
export { AmlWorkspaceHeader } from "./AmlWorkspaceHeader";
export { AmlNextActionCard } from "./AmlNextActionCard";
export { AmlServiceReadinessCard } from "./AmlServiceReadinessCard";
export { AmlComplianceSummary } from "./AmlComplianceSummary";
export { AmlOutstandingItems } from "./AmlOutstandingItems";
export { AmlRecentActivity } from "./AmlRecentActivity";
export { AmlConnectedPortals } from "./AmlConnectedPortals";
export { AmlContextActionPanel } from "./AmlContextActionPanel";
/* The ten-stage journey: rail, stage header, live position rail, footer and
   the MLRO dossier. All presentational, all fed by `journeyModel.ts`. */
export { AmlJourneyRail } from "./AmlJourneyRail";
export { AmlJourneyStageHeader } from "./AmlJourneyStageHeader";
export { AmlLivePositionRail } from "./AmlLivePositionRail";
export { AmlJourneyFooter } from "./AmlJourneyFooter";
export { MlroDecisionDossier } from "./MlroDecisionDossier";
export { SECTION_LABELS } from "./workspaceLabels";
export {
  ATTENTION_EDGE, ATTENTION_SURFACE, ATTENTION_TEXT, EVIDENCE_ICON, EVIDENCE_TEXT,
  READINESS_TEXT,
} from "./attentionTone";
