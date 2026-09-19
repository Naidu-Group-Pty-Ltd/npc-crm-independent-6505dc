import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Titled section within an AML page. Gives grouped content (metric groups,
 * queue blocks) a consistent heading tier and a labelled region so screen
 * readers can jump between the groups the layout implies visually.
 */
export interface AmlPageSectionProps {
  title: string;
  description?: string;
  /** Right-aligned inline actions for the section. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AmlPageSection({
  title,
  description,
  actions,
  children,
  className,
}: AmlPageSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold tracking-tight">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
