/**
 * The last few things that happened, drawn from the events the case load
 * already returned. No fetch of its own — the full, hash-chained record
 * lives in Records → Timeline & audit, and nothing is summarised away here
 * that is not still there in full.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { displayRelative } from "@/lib/aml/displayDate";
import { cn } from "@/lib/utils";
import type { AmlCaseEvent } from "@/lib/aml/amlCasesApi";

export function AmlRecentActivity({
  events,
  limit = 5,
  onOpenTimeline,
  className,
}: {
  events: AmlCaseEvent[];
  limit?: number;
  onOpenTimeline: () => void;
  className?: string;
}) {
  const recent = events.slice(0, limit);

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Recent activity
        </p>

        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing recorded on this case yet.</p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {recent.map((event) => (
              <li key={event.id} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                />
                <div className="min-w-0">
                  <p className={cn("text-sm leading-snug", "line-clamp-2")}>{event.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {displayRelative(event.created_at)}
                    {event.actor_label ? ` · ${event.actor_label}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={onOpenTimeline}>
          View the full timeline
        </Button>
      </CardContent>
    </Card>
  );
}
