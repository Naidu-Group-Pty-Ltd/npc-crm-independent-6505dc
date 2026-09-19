/**
 * Everything else that is outstanding, in the same ranked order the next
 * action came from — minus the one already shown as the headline.
 *
 * Only actionable or blocking things appear here. This is not a second copy
 * of the compliance summary: a stream that is merely "in progress" is not an
 * outstanding item, it is just work in flight.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlOutstandingItem, AmlWorkspaceSection } from "@/lib/aml/workspaceViewModel";

import { ATTENTION_EDGE, ATTENTION_TEXT } from "./attentionTone";

export function AmlOutstandingItems({
  items,
  onOpenSection,
  className,
}: {
  items: AmlOutstandingItem[];
  onOpenSection: (section: AmlWorkspaceSection) => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Also outstanding
          </p>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">{items.length}</span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing else on this case is waiting on a decision or a chase.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {items.map((item) => (
              <li key={item.key}>
                {/* `flex-col items-start` is load-bearing: the app's button
                    styling makes every <button> a flex row, which laid the
                    label and its explanation side by side in two thin
                    columns on a phone. */}
                <button
                  type="button"
                  onClick={() => onOpenSection(item.section)}
                  className={cn(
                    "flex w-full flex-col items-start rounded-md border-l-2 py-2 pl-3 pr-1 text-left transition-colors hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    ATTENTION_EDGE[item.attention],
                  )}
                >
                  {/* The label wraps rather than truncating: in a half-width
                      column at 1024px a truncated action is unreadable, and
                      these are short enough to run to two lines. */}
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-sm font-medium">{item.label}</span>
                    {item.blocking && (
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-medium uppercase tracking-wide",
                          ATTENTION_TEXT[item.attention],
                        )}
                      >
                        Blocking
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
