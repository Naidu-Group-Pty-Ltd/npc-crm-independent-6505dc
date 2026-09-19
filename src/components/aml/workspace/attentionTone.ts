/**
 * The one place attention becomes colour.
 *
 * Colour is scarce on this surface deliberately: only `critical` and
 * `attention` get a tone, `steady` gets a quiet positive, and everything
 * else stays neutral. Hierarchy is carried by type size, weight and
 * whitespace first — a screen where every status is a coloured pill tells
 * an analyst nothing.
 *
 * Status is never colour-only. Every consumer of these classes also renders
 * the status word, and the icons below carry an accessible name.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, CircleDot, HelpCircle, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  AmlAttentionLevel, AmlEvidenceState, AmlReadinessLevel,
} from "@/lib/aml/workspaceViewModel";

/** Foreground tone for a label or icon. */
export const ATTENTION_TEXT: Record<AmlAttentionLevel, string> = {
  critical: "text-destructive",
  attention: "text-warning",
  waiting: "text-muted-foreground",
  steady: "text-success",
  none: "text-muted-foreground",
};

/** Border + wash for a surface that must read as urgent. */
export const ATTENTION_SURFACE: Record<AmlAttentionLevel, string> = {
  critical: "border-destructive/40 bg-destructive/5",
  attention: "border-warning/40 bg-warning/5",
  waiting: "border-border/70",
  steady: "border-success/30 bg-success/5",
  none: "border-border/70",
};

/** A 2px left keyline — used on rows, where a wash would be noise. */
export const ATTENTION_EDGE: Record<AmlAttentionLevel, string> = {
  critical: "border-l-destructive",
  attention: "border-l-warning",
  waiting: "border-l-border",
  steady: "border-l-success/60",
  none: "border-l-transparent",
};

export const EVIDENCE_TEXT: Record<AmlEvidenceState, string> = {
  complete: "text-success",
  in_progress: "text-foreground",
  attention: "text-warning",
  not_started: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/**
 * Service readiness in a table cell. Only the two ends of the scale get a
 * tone — a case that is merely "not yet decided" is the normal state of an
 * open case and must not read as a problem.
 */
export const READINESS_TEXT: Record<AmlReadinessLevel, string> = {
  ready: "text-success",
  ready_with_controls: "text-success",
  conditions_outstanding: "text-warning",
  under_review: "text-muted-foreground",
  not_ready: "text-muted-foreground",
  blocked: "text-destructive",
  ended: "text-muted-foreground",
};

export const EVIDENCE_ICON: Record<AmlEvidenceState, LucideIcon> = {
  complete: CheckCircle2,
  in_progress: CircleDot,
  attention: AlertTriangle,
  not_started: CircleDashed,
  not_applicable: Minus,
  unknown: HelpCircle,
};
