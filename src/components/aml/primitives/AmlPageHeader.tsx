import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared AML page header.
 *
 * Before this existed the module carried four competing header shapes
 * (h1+icon, icon-chip+h2, title-inside-a-Card, and no header at all — see
 * docs/aml/ui-ux-audit.md §2.29). Every Command Center AML page now renders
 * this one shape so the title tier, description tone and action placement
 * read identically across the module.
 *
 * The AML shell (`AmlLayout`) owns the page's single `h1`, so pages default
 * to `h2`. The two admin surfaces that render outside the shell
 * (Integration Health) pass `headingLevel="h1"` to keep the document
 * outline correct.
 */
export interface AmlPageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Right-aligned action cluster — refresh, primary CTAs. */
  actions?: ReactNode;
  /** Optional context row under the title: badges, filters summary, stats. */
  children?: ReactNode;
  headingLevel?: "h1" | "h2";
  className?: string;
}

export function AmlPageHeader({
  title,
  description,
  icon: Icon,
  actions,
  children,
  headingLevel = "h2",
  className,
}: AmlPageHeaderProps) {
  const Heading = headingLevel;
  return (
    <header className={cn("rounded-xl border border-border/60 bg-card/45 p-4 shadow-sm supports-[backdrop-filter]:bg-card/35 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/*
          ── `basis-72` is what makes this row wrap ─────────────────────
          This was `flex-1` alone, which is `flex: 1 1 0%`. A flex line
          wraps when the items' HYPOTHETICAL sizes overflow it, and a basis
          of zero contributes nothing — so the line never overflowed, never
          wrapped, and the title took whatever was left after the action
          cluster had taken its content width. With `min-w-0` beside it,
          "whatever was left" could be eighteen pixels.

          Measured on the AUSTRAC hub, whose actions are Refresh and Start
          AUSTRAC Report: at 430px the heading was 18px wide and 532px TALL
          — one character per line — and it stayed broken at 480, 560 and
          640. It escaped notice at 390 only because the action cluster
          alone overflows there and forces the wrap by itself.

          A real basis states what the title needs. Below it the row wraps
          and the actions drop underneath; above it the title takes the
          remaining width as before. 18rem is the same figure the case
          workspace header already carries for the same reason.
        */}
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          {Icon && (
            <div
              aria-hidden="true"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <Heading className="text-lg font-semibold tracking-tight sm:text-xl">
              {title}
            </Heading>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}
