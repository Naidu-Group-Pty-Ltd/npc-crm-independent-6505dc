/**
 * Who else is connected to this case — compact, and low in the hierarchy.
 *
 * The full Compliance Journey Map is commercially valuable and is kept: it
 * now lives in Records → Compliance sharing alongside the passport controls,
 * where the operator goes to work on sharing. What belongs on the Overview
 * is the one-glance version: five rows, current state, nothing to operate.
 *
 * The legal meaning of partner assessment is untouched. A partner recording
 * itself satisfied with the records we shared is shown as exactly that —
 * "Partner assessment satisfied" — and never as a broader claim about that
 * partner's or this case's own compliance position.
 */
import { Building2, HardHat, Landmark, Scale, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AmlConnectedPortal, AmlConnectedPortalKey } from "@/lib/aml/workspaceViewModel";

const ICONS: Record<AmlConnectedPortalKey, LucideIcon> = {
  client: User,
  finance: Landmark,
  builder: HardHat,
  developer: Building2,
  solicitor_conveyancer: Scale,
};

const TONE_TEXT: Record<AmlConnectedPortal["tone"], string> = {
  connected: "text-success",
  in_progress: "text-foreground",
  idle: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

export function AmlConnectedPortals({
  portals,
  loading,
  onOpenSharing,
  className,
}: {
  portals: AmlConnectedPortal[];
  loading?: boolean;
  onOpenSharing: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Connected parties
          </p>
          <Button variant="ghost" size="sm" className="-mr-2 h-6 px-2 text-xs" onClick={onOpenSharing}>
            Manage sharing
          </Button>
        </div>

        {loading ? (
          <div className="mt-2 space-y-2" role="status">
            <span className="sr-only">Loading connected parties</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} aria-hidden className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <ul className="mt-1 divide-y divide-border/50">
            {portals.map((portal) => {
              const Icon = ICONS[portal.key];
              return (
                <li key={portal.key} className="flex items-center gap-2.5 py-2">
                  <Icon
                    aria-hidden
                    className={cn("h-3.5 w-3.5 shrink-0", TONE_TEXT[portal.tone])}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{portal.label}</span>
                  <span
                    className={cn("shrink-0 text-right text-xs", TONE_TEXT[portal.tone])}
                    title={portal.status}
                  >
                    {portal.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 border-t border-border/50 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          One completed compliance process, reused across portals under the reliance agreements.
          A partner's own assessment remains the partner's.
        </p>
      </CardContent>
    </Card>
  );
}
