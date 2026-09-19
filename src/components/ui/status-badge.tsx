import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status pill for lifecycle / outcome states (passed, failed, open, pending …).
 *
 * Exists because feature code kept hand-rolling the same tinted pill out of raw
 * Tailwind palette utilities (a tinted background, matching text, and a 30%
 * border, all off the same numbered hue). Those bypass the token layer, so they
 * neither follow white-label branding nor flip with light/dark. Tones here map
 * onto the fixed semantic tokens
 * (success / warning / destructive / info — see `src/styles/tokens.css`), which
 * are deliberately brand-independent because they carry meaning, not identity.
 *
 * Prefer <StatusBadge tone="…"> over <Badge variant="outline" className="bg-…">.
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-success/30 bg-success/15 text-success",
        warning: "border-warning/30 bg-warning/15 text-warning",
        danger: "border-destructive/30 bg-destructive/15 text-destructive",
        info: "border-info/30 bg-info/15 text-info",
        // The brand ramp is only declared on :root, so the mid-ramp shade that
        // reads well on a light surface is too dark on the dark theme — fall
        // back to the theme-aware --brand token there.
        brand: "border-brand/30 bg-brand/15 text-brand-700 dark:text-brand",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

export type StatusTone = NonNullable<
  VariantProps<typeof statusBadgeVariants>["tone"]
>

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  /**
   * Renders a leading tone dot so the state is not signalled by hue alone —
   * paired with the always-present text label this keeps the pill readable for
   * colour-blind users and in high-contrast mode.
   */
  dot?: boolean
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, tone, dot = false, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  )
)
StatusBadge.displayName = "StatusBadge"

/**
 * Shared status → tone lookup so every surface grades the same vocabulary the
 * same way. Unknown values fall back to `neutral`, which is the correct
 * treatment for states that carry no judgement (waived, not_run, retired).
 */
const STATUS_TONES: Record<string, StatusTone> = {
  // Outcomes
  passed: "success",
  pass: "success",
  approved: "success",
  completed: "success",
  complete: "success",
  mitigated: "success",
  resolved: "success",
  issued: "success",
  active: "success",
  low: "success",
  failed: "danger",
  fail: "danger",
  blocked: "danger",
  rejected: "danger",
  critical: "danger",
  high: "danger",
  overdue: "danger",
  // Attention
  warn: "warning",
  warning: "warning",
  open: "warning",
  pending: "warning",
  medium: "warning",
  review: "warning",
  // In-flight / informational
  running: "info",
  in_progress: "info",
  accepted: "info",
  scheduled: "info",
  // Brand — a deliberate action the operator took, not a health signal
  executed: "brand",
  // Explicitly neutral
  waived: "neutral",
  not_run: "neutral",
  retired: "neutral",
  draft: "neutral",
  planned: "neutral",
  cancelled: "neutral",
  expired: "neutral",
  revoked: "neutral",
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral"
  return STATUS_TONES[status.toLowerCase()] ?? "neutral"
}

/** `in_progress` → `in progress`, for display alongside the tone. */
export function statusLabel(status: string | null | undefined): string {
  return (status ?? "unknown").replace(/_/g, " ")
}

export { StatusBadge, statusBadgeVariants }
