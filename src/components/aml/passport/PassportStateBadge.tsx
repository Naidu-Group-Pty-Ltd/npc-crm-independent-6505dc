import { Badge } from "@/components/ui/badge";
import type { PassportStateResult, PassportStateTone } from "@/lib/aml/passport";
import { cn } from "@/lib/utils";

/**
 * The derived Passport lifecycle state, rendered the way every AML badge is
 * rendered: label text always present, tone from semantic tokens, never
 * colour-only. The state arrives derived from the server projection — this
 * component never computes one.
 */

const TONE_CLASSES: Record<PassportStateTone, string> = {
  success: "border-success/40 text-success",
  progress: "border-primary/40 text-primary",
  attention: "border-warning/40 text-warning",
  muted: "text-muted-foreground",
  destructive: "border-destructive/40 text-destructive",
};

export function PassportStateBadge({
  state, className,
}: { state: PassportStateResult; className?: string }) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASSES[state.tone], className)}>
      {state.label}
    </Badge>
  );
}
