import type { AmlRole } from "@/hooks/useAmlAccess";
import { hasAmlCapability } from "./permissions";

/**
 * Phase 2 — Role-adaptive default landing.
 *
 * Derives the workspace a user should land in from their **effective
 * capabilities**, never a client-side role string. Used by the home page
 * to surface a "Jump to your queue" affordance and by the layout to pick
 * a sensible fallback when Compliance Home is uninformative for that role.
 *
 * Precedence mirrors the Version 2 five-workspace hierarchy:
 *   MLRO (report)      → AUSTRAC Hub
 *   Configure          → Configuration
 *   Investigate        → Monitoring queue
 *   View only / auditor → Case register
 */
export interface AmlLandingSuggestion {
  path: string;
  label: string;
  reason: string;
}

export function suggestAmlLanding(roles: Set<AmlRole>): AmlLandingSuggestion | null {
  if (roles.size === 0) return null;
  if (hasAmlCapability(roles, "aml.report")) {
    return {
      path: "/admin/aml/austrac",
      label: "Open AUSTRAC Hub",
      reason: "MLRO reporting queue",
    };
  }
  if (hasAmlCapability(roles, "aml.investigate")) {
    return {
      path: "/admin/aml/monitoring",
      label: "Open Monitoring queue",
      reason: "Alerts and events awaiting triage",
    };
  }
  if (hasAmlCapability(roles, "aml.view")) {
    return {
      path: "/admin/aml/cases",
      label: "Open Case register",
      reason: "Review customer cases",
    };
  }
  return null;
}
