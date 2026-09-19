import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Shared loading / empty / error states for the AML Command Center.
 *
 * The audit (docs/aml/ui-ux-audit.md §2.32-34) found the module using bare
 * unlabeled spinners, tables that render their empty row while loading
 * ("No alerts" flashing as a false empty), toast-only errors with no retry,
 * and five different no-access treatments. These primitives give every page
 * the same three honest states:
 *
 *  - loading  — labelled, announced via role="status";
 *  - empty    — says why it's empty and what to do next;
 *  - error    — says what happened and offers a retry.
 */

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export interface AmlLoadingStateProps {
  /** Announced to assistive tech and shown for spinner variant. */
  label?: string;
  /** `list` = skeleton rows; `block` = one tall skeleton; `spinner` = labelled spinner. */
  variant?: "list" | "block" | "spinner";
  /** Number of skeleton rows for the list variant. */
  lines?: number;
  className?: string;
}

export function AmlLoadingState({
  label = "Loading…",
  variant = "list",
  lines = 3,
  className,
}: AmlLoadingStateProps) {
  if (variant === "spinner") {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
        {label}
      </div>
    );
  }
  return (
    <div role="status" className={cn("space-y-2", className)}>
      <span className="sr-only">{label}</span>
      {variant === "block" ? (
        <Skeleton className="h-40 w-full" aria-hidden="true" />
      ) : (
        Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" aria-hidden="true" />
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty                                                               */
/* ------------------------------------------------------------------ */

export interface AmlEmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  /** Why it's empty and what fills it — never just "No data". */
  body: ReactNode;
  /** Optional next action (a Button or Link). */
  action?: ReactNode;
  className?: string;
}

export function AmlEmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: AmlEmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border/60 p-6 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
      )}
      {title && <p className="text-sm font-medium">{title}</p>}
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Error                                                               */
/* ------------------------------------------------------------------ */

export interface AmlErrorStateProps {
  title?: string;
  /** What happened, in plain language. Do not print internal identifiers. */
  message: string;
  /** Whether in-progress work was preserved, when that's worth saying. */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function AmlErrorState({
  title = "Something went wrong",
  message,
  detail,
  onRetry,
  retryLabel = "Try again",
  className,
}: AmlErrorStateProps) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        {detail && <p className="text-xs">{detail}</p>}
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
            {retryLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/* Access gate                                                         */
/* ------------------------------------------------------------------ */

export interface AmlAccessGateProps {
  title: string;
  body: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Centred no-access state. One shape for "module not enabled", "no AML
 * role yet" and "this area is restricted" — the copy carries the
 * difference, not the layout. Never names roles, flags or capabilities
 * (disclosure rules, amlUiDisclosure.source.test.ts).
 */
export function AmlAccessGate({ title, body, action, className }: AmlAccessGateProps) {
  return (
    <div className={cn("mx-auto max-w-xl p-8 text-center", className)}>
      <ShieldAlert aria-hidden="true" className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table rows                                                          */
/* ------------------------------------------------------------------ */

/**
 * Loading row for tables — distinct from the empty row so "No records"
 * never flashes while the query is still in flight.
 */
export function AmlTableLoadingRow({
  colSpan,
  label = "Loading…",
}: { colSpan: number; label?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        <span role="status" className="inline-flex items-center gap-2">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {label}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function AmlTableEmptyRow({
  colSpan,
  children,
}: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}
