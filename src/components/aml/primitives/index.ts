/**
 * AML Command Center presentation primitives.
 *
 * Purely presentational — no data fetching, no permission decisions, no
 * business rules. Capability gating stays in the pages (render or don't
 * render), and `AmlGuard` remains the enforcement layer.
 */
export { AmlPageHeader } from "./AmlPageHeader";
export { AmlPageSection } from "./AmlPageSection";
export { AmlMetricCard } from "./AmlMetricCard";
export { AmlRefreshButton } from "./AmlRefreshButton";
export {
  AmlLoadingState,
  AmlEmptyState,
  AmlErrorState,
  AmlAccessGate,
  AmlTableLoadingRow,
  AmlTableEmptyRow,
} from "./AmlStates";
export { AmlStageBadge, AmlRiskBadge, AmlGateBadge } from "./AmlCaseBadges";
